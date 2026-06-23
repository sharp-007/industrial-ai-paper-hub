(function () {
  "use strict";

  var cfg = window.IAIPH_COMMUNITY || {};
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  var pathMatch = location.pathname.match(/\/papers\/([^/]+)\/page-renders\/(.*)$/);
  if (!pathMatch) return;

  var PAPER_FOLDER = decodeURIComponent(pathMatch[1]);
  var SECTION_FILE = normalizeSectionFile(pathMatch[2].split("?")[0] || "index.html");
  var UNDERLINE_COLOR = "underline";
  var COLORS = ["yellow", "green", "blue", "pink"];
  var SUPABASE_CDNS = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
    "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  ];
  var STORAGE_RETURN = "iaiph_auth_return";

  var client = null;
  var session = null;
  var highlights = [];
  var notes = [];
  var pendingAction = null;
  var savedRange = null;

  var articleEl = null;
  var toolbarEl = null;
  var hlPopoverEl = null;
  var notePopoverEl = null;
  var notesPanelEl = null;
  var notesListEl = null;
  var noteEditorEl = null;
  var noteEditorTextarea = null;
  var noteEditorQuoteEl = null;
  var noteEditorContext = null;

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeSectionFile(path) {
    if (!path) return "";
    var value = decodeURIComponent(String(path)).split("?")[0].replace(/\\/g, "/").replace(/^\/+/, "");
    var match = value.match(/page-renders\/(.+)$/i);
    if (match) value = match[1];
    value = value.replace(/^(\.\/)+/, "");
    return value || "";
  }

  function isPaperHomePage() {
    var section = SECTION_FILE || "";
    return section === "index.html" || /(^|\/)index\.html$/i.test(section);
  }

  function notesScopeNoun() {
    return isPaperHomePage() ? "本页" : "本章";
  }

  function resolveArticleRoot() {
    return (
      document.querySelector(".content-pane.article") ||
      document.querySelector("main .article") ||
      document.querySelector(".content-pane .welcome") ||
      document.querySelector(".welcome")
    );
  }

  function sectionBasename(path) {
    var normalized = normalizeSectionFile(path);
    if (!normalized) return "";
    var parts = normalized.split("/");
    return parts[parts.length - 1] || normalized;
  }

  function sectionFileMatches(stored, current) {
    if (!stored || !current) return false;
    var a = normalizeSectionFile(stored);
    var b = normalizeSectionFile(current);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.replace(/^sections\//, "") === b.replace(/^sections\//, "")) return true;
    if (sectionBasename(a) === sectionBasename(b)) return true;
    return false;
  }

  function highlightById(rows, id) {
    if (!id || !rows) return null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i];
    }
    return null;
  }

  function partitionAnnotations(allHighlights, allNotes) {
    var sectionHighlights = [];
    var sectionNotes = [];
    var highlightIds = {};
    var i;

    for (i = 0; i < (allHighlights || []).length; i++) {
      var h = allHighlights[i];
      if (sectionFileMatches(h.section_file, SECTION_FILE)) {
        sectionHighlights.push(h);
        highlightIds[h.id] = true;
      }
    }

    for (i = 0; i < (allNotes || []).length; i++) {
      var n = allNotes[i];
      if (sectionFileMatches(n.section_file, SECTION_FILE)) {
        sectionNotes.push(n);
        continue;
      }
      if (n.highlight_id) {
        var linked = highlightById(allHighlights, n.highlight_id);
        if (linked && sectionFileMatches(linked.section_file, SECTION_FILE)) {
          sectionNotes.push(n);
        }
      }
    }

    for (i = 0; i < sectionNotes.length; i++) {
      var note = sectionNotes[i];
      if (note.highlight_id && !highlightIds[note.highlight_id]) {
        var hl = highlightById(allHighlights, note.highlight_id);
        if (hl) {
          sectionHighlights.push(hl);
          highlightIds[hl.id] = true;
        }
      }
    }

    return { highlights: sectionHighlights, notes: sectionNotes };
  }

  function findQuoteOffsets(quote, hintStart) {
    if (!quote || !articleEl) return null;
    var text = articleEl.textContent;
    var hint = Math.max(0, (hintStart || 0) - 300);
    var candidates = [quote, quote.replace(/\s+/g, " ").trim()];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var q = candidates[i];
      if (!q || q.length < 2) continue;
      var idx = text.indexOf(q, hint);
      if (idx < 0) idx = text.indexOf(q);
      if (idx >= 0) return { start: idx, end: idx + q.length };
    }
    if (quote.length > 10) {
      var head = quote.slice(0, Math.min(28, quote.length));
      var headIdx = text.indexOf(head, hint);
      if (headIdx < 0) headIdx = text.indexOf(head);
      if (headIdx >= 0) {
        var end = headIdx + quote.length;
        if (end <= text.length) return { start: headIdx, end: end };
      }
    }
    return null;
  }

  function toast(msg) {
    var el = document.querySelector(".iaiph-reader-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "iaiph-reader-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove("is-visible");
    }, 2800);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeEmail(email) {
    return String(email || "")
      .trim()
      .toLowerCase();
  }

  function siteBasePath() {
    if (
      cfg.githubPagesBase &&
      location.hostname.endsWith("github.io") &&
      location.pathname.indexOf(cfg.githubPagesBase) === 0
    ) {
      var base = cfg.githubPagesBase;
      return base.charAt(base.length - 1) === "/" ? base : base + "/";
    }
    if (location.pathname.indexOf("/industrial-ai-paper-hub/") === 0) {
      return "/industrial-ai-paper-hub/";
    }
    return "/";
  }

  function authCallbackUrl() {
    var base = siteBasePath();
    if (base.charAt(0) !== "/") base = "/" + base;
    return location.origin + base + "auth/callback.html";
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (window.supabase) resolve();
        else existing.addEventListener("load", resolve);
        existing.addEventListener("error", reject);
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("脚本加载失败"));
      };
      document.head.appendChild(s);
    });
  }

  function loadSupabaseSdk() {
    var chain = Promise.reject();
    SUPABASE_CDNS.forEach(function (url) {
      chain = chain.catch(function () {
        return loadScript(url);
      });
    });
    return chain.then(function () {
      if (!window.supabase) throw new Error("Supabase SDK 未就绪");
    });
  }

  function ensureLoginModal() {
    if ($("community-login-modal")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="community-login-modal" id="community-login-modal" hidden role="dialog" aria-modal="true" aria-labelledby="community-login-modal-title">' +
      '  <div class="community-login-modal-backdrop" data-login-close="true"></div>' +
      '  <div class="community-login-modal-panel">' +
      '    <button type="button" class="community-login-modal-close" data-login-close="true" aria-label="关闭">&times;</button>' +
      '    <h2 class="community-login-modal-title" id="community-login-modal-title">登录</h2>' +
      '    <p class="community-login-modal-desc">登录后可标亮段落、记录笔记、点赞、收藏。</p>' +
      '    <button type="button" class="community-btn community-btn--github community-btn--block" id="community-login-github">' +
      '      <svg class="community-github-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"/></svg>' +
      "      <span>使用 GitHub 登录</span>" +
      "    </button>" +
      '    <div class="community-login-divider" aria-hidden="true"><span>或</span></div>' +
      '    <form class="community-login-email-form" id="community-login-email-form" novalidate>' +
      '      <label class="visually-hidden" for="community-login-email-input">邮箱</label>' +
      '      <input type="email" class="community-login-email-input" id="community-login-email-input" placeholder="your@email.com" autocomplete="email" required>' +
      '      <button type="submit" class="community-btn community-btn--primary community-btn--block" id="community-login-email-submit">发送邮箱登录链接</button>' +
      "    </form>" +
      '    <p class="community-login-modal-msg" id="community-login-modal-msg" hidden role="status"></p>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(wrap.firstChild);
  }

  function setLoginModalMsg(text, isError) {
    var el = $("community-login-modal-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("is-error", !!isError);
  }

  function openLoginModal() {
    ensureLoginModal();
    var modal = $("community-login-modal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("iaiph-modal-open");
    setLoginModalMsg("");
    var input = $("community-login-email-input");
    if (input) {
      if (session && session.user && session.user.email) input.value = session.user.email;
      input.focus();
    }
  }

  function closeLoginModal() {
    var modal = $("community-login-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("iaiph-modal-open");
    setLoginModalMsg("");
  }

  function promptLogin(reason) {
    toast(reason || "请先登录（GitHub 或邮箱）");
    openLoginModal();
  }

  function requireSession(action) {
    if (session && session.user) return true;
    pendingAction = action;
    promptLogin("标亮与笔记需登录后使用");
    return false;
  }

  function signInWithGithub() {
    if (!client) {
      toast("正在连接…");
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_RETURN, location.href);
    } catch (e) {}
    client.auth
      .signInWithOAuth({
        provider: "github",
        options: { redirectTo: authCallbackUrl() },
      })
      .then(function (res) {
        if (res.error) setLoginModalMsg(res.error.message, true);
      });
  }

  function signInWithEmail(rawEmail) {
    if (!client) return Promise.reject(new Error("服务未就绪"));
    var email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) return Promise.reject(new Error("请输入有效邮箱"));
    try {
      sessionStorage.setItem(STORAGE_RETURN, location.href);
    } catch (e) {}
    return client.auth
      .signInWithOtp({
        email: email,
        options: { emailRedirectTo: authCallbackUrl() },
      })
      .then(function (res) {
        if (res.error) throw res.error;
      });
  }

  function bindLoginModal() {
    ensureLoginModal();
    var modal = $("community-login-modal");
    var githubBtn = $("community-login-github");
    var emailForm = $("community-login-email-form");

    if (modal) {
      modal.querySelectorAll("[data-login-close]").forEach(function (el) {
        el.addEventListener("click", closeLoginModal);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && modal && !modal.hidden) closeLoginModal();
      });
    }

    if (githubBtn) githubBtn.addEventListener("click", signInWithGithub);

    if (emailForm) {
      emailForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = $("community-login-email-input");
        var submitBtn = $("community-login-email-submit");
        if (!input || !submitBtn) return;
        submitBtn.disabled = true;
        signInWithEmail(input.value)
          .then(function () {
            setLoginModalMsg("登录链接已发送，请查收邮件并点击链接完成登录。", false);
            toast("请查收邮件中的登录链接");
          })
          .catch(function (err) {
            setLoginModalMsg((err && err.message) || "发送失败，请稍后重试", true);
          })
          .finally(function () {
            submitBtn.disabled = false;
          });
      });
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function findNote(id) {
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].id === id) return notes[i];
    }
    return null;
  }

  function findHighlight(id) {
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].id === id) return highlights[i];
    }
    return null;
  }

  function isNoteLinkedHighlight(h) {
    if (!h) return false;
    return notes.some(function (n) {
      return n.highlight_id === h.id;
    });
  }

  function isUnderlineHighlight(h) {
    if (!h) return false;
    if (h.color === UNDERLINE_COLOR) return true;
    return isNoteLinkedHighlight(h);
  }

  function isColoredHighlight(h) {
    if (!h) return false;
    if (h.color === UNDERLINE_COLOR) return false;
    if (isNoteLinkedHighlight(h)) return false;
    return COLORS.indexOf(h.color) >= 0;
  }

  function getSelectionRange() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    if (!articleEl || !articleEl.contains(range.commonAncestorContainer)) return null;
    var text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) return null;
    return range.cloneRange();
  }

  function rangeTextOffset(container, range) {
    var pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function rangeFromOffsets(container, start, end) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var node;
    var pos = 0;
    var startNode = null;
    var startOff = 0;
    var endNode = null;
    var endOff = 0;

    while ((node = walker.nextNode())) {
      var len = node.length;
      if (!startNode && pos + len >= start) {
        startNode = node;
        startOff = start - pos;
      }
      if (pos + len >= end) {
        endNode = node;
        endOff = end - pos;
        break;
      }
      pos += len;
    }

    if (!startNode || !endNode) return null;
    var r = document.createRange();
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
    return r;
  }

  function rangeFromHighlight(h) {
    if (!articleEl || !h) return null;
    var offsets = resolveOffsets(articleEl, h.start_offset, h.end_offset, h.quote);
    if (!offsets) return null;
    return rangeFromOffsets(articleEl, offsets.start, offsets.end);
  }

  function getAnnotationElements(id) {
    if (!articleEl || !id) return [];
    var idStr = String(id);
    var found = [];
    articleEl.querySelectorAll("mark.iaiph-hl, span.iaiph-ul").forEach(function (el) {
      if (el.getAttribute("data-highlight-id") === idStr || el.getAttribute("data-iaiph-group") === idStr) {
        found.push(el);
      }
    });
    return found;
  }

  function rangeEndOffset(container, range) {
    var pre = document.createRange();
    pre.selectNodeContents(container);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  function selectionMetrics(range, container) {
    var start = rangeTextOffset(container, range);
    var end = rangeEndOffset(container, range);
    var slice = container.textContent.substring(start, end);
    return {
      start: start,
      end: end,
      quote: slice.replace(/\s+/g, " ").trim(),
      raw: slice,
    };
  }

  function wrapRangeWithElement(range, el) {
    if (!range || range.collapsed) return null;
    var fragment = range.extractContents();
    el.appendChild(fragment);
    range.insertNode(el);
    return el;
  }

  function rangesForTextSegments(range) {
    if (!range || range.collapsed) return [];
    var segments = [];
    var root = articleEl || range.commonAncestorContainer;
    if (root && root.nodeType === 3) root = root.parentNode;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        try {
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } catch (e) {
          return NodeFilter.FILTER_REJECT;
        }
      },
    });
    var node;
    while ((node = walker.nextNode())) {
      var seg = document.createRange();
      if (node === range.startContainer && node === range.endContainer) {
        seg.setStart(node, range.startOffset);
        seg.setEnd(node, range.endOffset);
      } else if (node === range.startContainer) {
        seg.setStart(node, range.startOffset);
        seg.setEnd(node, node.length);
      } else if (node === range.endContainer) {
        seg.setStart(node, 0);
        seg.setEnd(node, range.endOffset);
      } else {
        seg.setStart(node, 0);
        seg.setEnd(node, node.length);
      }
      if (!seg.collapsed && seg.toString()) segments.push(seg);
    }
    return segments;
  }

  function createAnnotationEl(id, color, isUnderline) {
    if (isUnderline) {
      var span = document.createElement("span");
      span.className = "iaiph-ul";
      span.setAttribute("data-highlight-id", id);
      span.setAttribute("data-iaiph-group", id);
      return span;
    }
    var mark = document.createElement("mark");
    mark.className = "iaiph-hl iaiph-hl--" + (color || "yellow");
    mark.setAttribute("data-highlight-id", id);
    mark.setAttribute("data-iaiph-group", id);
    return mark;
  }

  function markParagraphAnnotated(el) {
    var p = el && el.closest && el.closest("p");
    if (p) p.classList.add("iaiph-has-annotation");
  }

  function refreshParagraphAnnotationClasses() {
    if (!articleEl) return;
    articleEl.querySelectorAll("p.iaiph-has-annotation").forEach(function (p) {
      p.classList.remove("iaiph-has-annotation");
    });
    articleEl.querySelectorAll("p").forEach(function (p) {
      if (p.querySelector(".iaiph-hl, .iaiph-ul")) {
        p.classList.add("iaiph-has-annotation");
      }
    });
  }

  function wrapAnnotationRange(range, id, color, isUnderline) {
    var segments = rangesForTextSegments(range);
    if (!segments.length) {
      var el = createAnnotationEl(id, color, isUnderline);
      var single = wrapRangeWithElement(range, el);
      if (single) markParagraphAnnotated(single);
      return single;
    }
    var first = null;
    for (var i = segments.length - 1; i >= 0; i--) {
      var wrapped = wrapRangeWithElement(segments[i], createAnnotationEl(id, color, isUnderline));
      if (wrapped) {
        markParagraphAnnotated(wrapped);
        if (!first) first = wrapped;
      }
    }
    return first;
  }

  function wrapUnderline(range, id) {
    return wrapAnnotationRange(range, id, null, true);
  }

  function wrapColoredHighlight(range, id, color) {
    return wrapAnnotationRange(range, id, color, false);
  }

  function unwrapAnnotationEl(el) {
    if (!el || !el.parentNode) return;
    var parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function resolveOffsets(container, start, end, quote) {
    var text = container.textContent;
    if (start >= 0 && end > start && end <= text.length) {
      var slice = text.substring(start, end);
      if (!quote || slice.replace(/\s+/g, " ").trim() === quote.replace(/\s+/g, " ").trim()) {
        return { start: start, end: end };
      }
    }
    if (quote) {
      var found = findQuoteOffsets(quote, start);
      if (found) return found;
    }
    return null;
  }

  function applyHighlightRecord(record, liveRange) {
    if (!articleEl || !record) return false;
    getAnnotationElements(record.id).forEach(unwrapAnnotationEl);
    var range = liveRange;
    if (!range || range.collapsed) {
      var offsets = resolveOffsets(articleEl, record.start_offset, record.end_offset, record.quote);
      if (!offsets && record.quote) {
        offsets = findQuoteOffsets(record.quote, record.start_offset);
      }
      if (!offsets) return false;
      range = rangeFromOffsets(articleEl, offsets.start, offsets.end);
    }
    if (!range || range.collapsed) return false;
    if (isUnderlineHighlight(record)) {
      wrapUnderline(range, record.id);
    } else {
      wrapColoredHighlight(range, record.id, record.color);
    }
    return true;
  }

  function removeAnnotationFromDom(id) {
    if (!articleEl || !id) return 0;
    var removed = 0;
    var nodes;
    while ((nodes = getAnnotationElements(id)).length) {
      nodes.forEach(function (node) {
        unwrapAnnotationEl(node);
        removed++;
      });
    }
    refreshParagraphAnnotationClasses();
    return removed;
  }

  function renderAllAnnotations() {
    if (!articleEl) return;
    articleEl.querySelectorAll("span.iaiph-ul, mark.iaiph-hl").forEach(unwrapAnnotationEl);
    articleEl.querySelectorAll("p.iaiph-has-annotation").forEach(function (p) {
      p.classList.remove("iaiph-has-annotation");
    });
    var failed = 0;
    highlights
      .slice()
      .sort(function (a, b) {
        return (b.start_offset || 0) - (a.start_offset || 0);
      })
      .forEach(function (h) {
        if (!applyHighlightRecord(h)) failed++;
      });
    if (failed > 0 && highlights.length) {
      console.warn(
        "[IAIPH reader-annotations] " +
          failed +
          "/" +
          highlights.length +
          " 条标亮未能渲染（正文可能已更新），章节=" +
          SECTION_FILE
      );
    }
    refreshParagraphAnnotationClasses();
  }

  function hideToolbar() {
    if (toolbarEl) toolbarEl.hidden = true;
  }

  function clearActiveAnnotations() {
    if (!articleEl) return;
    articleEl.querySelectorAll("span.iaiph-ul.is-active, mark.iaiph-hl.is-active").forEach(function (el) {
      el.classList.remove("is-active");
    });
  }

  function hideHlPopover() {
    if (hlPopoverEl) hlPopoverEl.hidden = true;
    if (articleEl) {
      articleEl.querySelectorAll("mark.iaiph-hl.is-active").forEach(function (m) {
        m.classList.remove("is-active");
      });
    }
  }

  function hideNotePopover() {
    if (notePopoverEl) notePopoverEl.hidden = true;
    if (articleEl) {
      articleEl.querySelectorAll("span.iaiph-ul.is-active").forEach(function (m) {
        m.classList.remove("is-active");
      });
    }
  }

  function hideAllPopovers() {
    hideHlPopover();
    hideNotePopover();
  }

  function positionFloating(el, rect) {
    if (!el || !rect) return;
    var pad = 8;
    var top = rect.top - el.offsetHeight - pad;
    var left = rect.left + rect.width / 2 - el.offsetWidth / 2;
    if (top < pad) top = rect.bottom + pad;
    left = Math.max(pad, Math.min(left, window.innerWidth - el.offsetWidth - pad));
    el.style.top = top + "px";
    el.style.left = left + "px";
  }

  function showToolbar(range) {
    if (!toolbarEl || !range) return;
    var rect = range.getBoundingClientRect();
    toolbarEl.hidden = false;
    positionFloating(toolbarEl, rect);
    savedRange = range.cloneRange();
  }

  function onSelectionChange() {
    var range = getSelectionRange();
    if (range) {
      hideAllPopovers();
      showToolbar(range);
      return;
    }
    hideToolbar();
    savedRange = null;
  }

  function fetchAnnotations() {
    if (!client || !session) return Promise.resolve();
    return Promise.all([
      client
        .from("highlights")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("paper_folder", PAPER_FOLDER)
        .order("created_at", { ascending: true }),
      client
        .from("notes")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("paper_folder", PAPER_FOLDER)
        .order("updated_at", { ascending: false }),
    ]).then(function (results) {
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      var allHighlights = results[0].data || [];
      var allNotes = results[1].data || [];
      var partitioned = partitionAnnotations(allHighlights, allNotes);
      highlights = partitioned.highlights;
      notes = partitioned.notes;
      renderAllAnnotations();
      renderNotesList();
    });
  }

  function insertHighlightRecord(range, color) {
    if (!range || !articleEl) return Promise.resolve(null);
    var metrics = selectionMetrics(range, articleEl);
    if (!metrics.quote || metrics.quote.length < 2) {
      return Promise.resolve(null);
    }

    return client
      .from("highlights")
      .insert({
        user_id: session.user.id,
        paper_folder: PAPER_FOLDER,
        section_file: SECTION_FILE,
        quote: metrics.quote,
        color: color,
        start_offset: metrics.start,
        end_offset: metrics.end,
      })
      .select("*")
      .single()
      .then(function (res) {
        if (res.error) throw res.error;
        highlights.push(res.data);
        applyHighlightRecord(res.data, range);
        return res.data;
      });
  }

  function createUnderline(range) {
    range = range || savedRange;
    return insertHighlightRecord(range, UNDERLINE_COLOR);
  }

  function createColoredHighlight(color, range) {
    range = range || savedRange;
    if (!range || !articleEl) return Promise.resolve(null);
    return insertHighlightRecord(range, color || "yellow").then(function (record) {
      window.getSelection().removeAllRanges();
      hideToolbar();
      savedRange = null;
      toast("已标亮");
      return record;
    });
  }

  function deleteHighlightById(id) {
    return client
      .from("highlights")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id)
      .select("id");
  }

  function deleteColoredHighlight(id) {
    var h = findHighlight(id);
    if (h && isUnderlineHighlight(h)) {
      return Promise.reject(new Error("下划线由笔记管理，请删除笔记"));
    }
    return deleteHighlightById(id).then(function (res) {
      if (res.error) throw res.error;
      highlights = highlights.filter(function (item) {
        return item.id !== id;
      });
      notes = notes.map(function (n) {
        if (n.highlight_id === id) return Object.assign({}, n, { highlight_id: null });
        return n;
      });
      renderAllAnnotations();
      hideHlPopover();
      toast("已删除标亮");
    });
  }

  function deleteUnderlineForNote(note) {
    if (!note || !note.highlight_id) return Promise.resolve();
    var hlId = note.highlight_id;
    return deleteHighlightById(hlId).then(function (res) {
      if (res.error) throw res.error;
      highlights = highlights.filter(function (item) {
        return item.id !== hlId;
      });
      renderAllAnnotations();
    });
  }

  function saveNote(body, highlightId, noteId, range) {
    body = String(body || "").trim();
    if (!body) return Promise.reject(new Error("笔记内容不能为空"));

    if (noteId) {
      return client
        .from("notes")
        .update({ body: body, updated_at: new Date().toISOString() })
        .eq("id", noteId)
        .eq("user_id", session.user.id)
        .select("*")
        .single()
        .then(function (res) {
          if (res.error) throw res.error;
          notes = notes.map(function (n) {
            return n.id === noteId ? res.data : n;
          });
          renderNotesList();
          toast("笔记已更新");
          return res.data;
        });
    }

    function insertNote(linkId) {
      return client
        .from("notes")
        .insert({
          user_id: session.user.id,
          paper_folder: PAPER_FOLDER,
          section_file: SECTION_FILE,
          highlight_id: linkId || null,
          body: body,
        })
        .select("*")
        .single()
        .then(function (res) {
          if (res.error) throw res.error;
          notes.unshift(res.data);
          renderAllAnnotations();
          renderNotesList();
          window.getSelection().removeAllRanges();
          hideToolbar();
          savedRange = null;
          toast("笔记已保存");
          return res.data;
        });
    }

    if (highlightId) return insertNote(highlightId);

    if (range) {
      return createUnderline(range).then(function (ul) {
        if (!ul) throw new Error("无法添加下划线");
        return insertNote(ul.id);
      });
    }

    return insertNote(null);
  }

  function deleteNote(id) {
    var note = findNote(id);
    return client
      .from("notes")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id)
      .then(function (res) {
        if (res.error) throw res.error;
        notes = notes.filter(function (n) {
          return n.id !== id;
        });
        return deleteUnderlineForNote(note);
      })
      .then(function () {
        hideNotePopover();
        renderNotesList();
        toast("笔记已删除");
      });
  }

  function openNoteEditor(opts) {
    opts = opts || {};
    noteEditorContext = opts;
    if (noteEditorQuoteEl) {
      if (opts.quote) {
        noteEditorQuoteEl.textContent = opts.quote;
        noteEditorQuoteEl.hidden = false;
      } else {
        noteEditorQuoteEl.hidden = true;
      }
    }
    if (noteEditorTextarea) {
      noteEditorTextarea.value = opts.body || "";
    }
    if (noteEditorEl) {
      noteEditorEl.hidden = false;
      document.body.classList.add("iaiph-modal-open");
      noteEditorTextarea && noteEditorTextarea.focus();
    }
  }

  function closeNoteEditor() {
    if (noteEditorEl) noteEditorEl.hidden = true;
    if (!$("community-login-modal") || $("community-login-modal").hidden) {
      document.body.classList.remove("iaiph-modal-open");
    }
    noteEditorContext = null;
  }

  function getScrollContainer() {
    if (!articleEl) return null;
    return articleEl.closest(".content");
  }

  function flashAnnotationJump(highlightId) {
    if (!highlightId) return;
    getAnnotationElements(highlightId).forEach(function (el) {
      el.classList.remove("is-jump-target");
      void el.offsetWidth;
      el.classList.add("is-jump-target");
      setTimeout(function () {
        el.classList.remove("is-jump-target");
      }, 1400);
    });
  }

  function scrollToHighlight(highlightId, noteId) {
    if (!highlightId || !articleEl) return false;

    var elements = getAnnotationElements(highlightId);
    if (!elements.length) {
      var record = findHighlight(highlightId);
      if (record) {
        applyHighlightRecord(record);
        elements = getAnnotationElements(highlightId);
      }
    }
    if (!elements.length) {
      toast("无法定位到正文位置");
      return false;
    }

    hideToolbar();
    hideAllPopovers();
    window.getSelection().removeAllRanges();
    clearActiveAnnotations();
    setAnnotationGroupActive(highlightId, true);
    if (noteId) focusNoteInPanel(noteId);

    var target = elements[0];
    var container = getScrollContainer();
    var topOffset = 72;

    if (container) {
      var containerRect = container.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      var nextTop = targetRect.top - containerRect.top + container.scrollTop - topOffset;
      container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    } else {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    flashAnnotationJump(highlightId);
    return true;
  }

  function scrollToNoteAnchor(note) {
    if (!note || !note.highlight_id) {
      toast("该笔记未关联正文位置");
      return;
    }
    scrollToHighlight(note.highlight_id, note.id);
  }

  function renderNotesList() {
    if (!notesListEl) return;
    notesListEl.innerHTML = "";
    if (!notes.length) {
      var empty = document.createElement("p");
      empty.className = "iaiph-notes-empty";
      if (!session) {
        empty.textContent = "登录后可在此查看" + notesScopeNoun() + "笔记。";
      } else {
        empty.textContent = notesScopeNoun() + "暂无笔记，选中文字后可添加。";
      }
      notesListEl.appendChild(empty);
      return;
    }

    notes.forEach(function (note) {
      var card = document.createElement("article");
      card.className = "iaiph-note-card";
      if (note.highlight_id) card.classList.add("iaiph-note-card--linked");
      card.setAttribute("data-note-id", note.id);
      if (note.highlight_id) {
        card.setAttribute("title", "点击跳转到正文");
        card.addEventListener("click", function (e) {
          if (e.target.closest(".iaiph-note-actions")) return;
          scrollToNoteAnchor(note);
        });
      }

      var hl = note.highlight_id ? findHighlight(note.highlight_id) : null;
      if (hl && hl.quote) {
        var quoteEl = document.createElement("p");
        quoteEl.className = "iaiph-note-quote";
        quoteEl.textContent = hl.quote.length > 120 ? hl.quote.slice(0, 120) + "…" : hl.quote;
        card.appendChild(quoteEl);
      }

      var bodyEl = document.createElement("p");
      bodyEl.className = "iaiph-note-body";
      bodyEl.textContent = note.body;
      card.appendChild(bodyEl);

      var meta = document.createElement("div");
      meta.className = "iaiph-note-meta";

      var timeEl = document.createElement("span");
      timeEl.className = "iaiph-note-time";
      timeEl.textContent = formatTime(note.updated_at || note.created_at);
      meta.appendChild(timeEl);

      var actions = document.createElement("div");
      actions.className = "iaiph-note-actions";

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!requireSession()) return;
        openNoteEditor({
          noteId: note.id,
          body: note.body,
          highlightId: note.highlight_id,
          quote: hl ? hl.quote : "",
        });
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "iaiph-note-delete";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!requireSession()) return;
        deleteNote(note.id).catch(function (err) {
          toast((err && err.message) || "删除失败");
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      meta.appendChild(actions);
      card.appendChild(meta);
      notesListEl.appendChild(card);
    });
  }

  function focusNoteInPanel(noteId) {
    if (!notesListEl || !noteId) return;
    notesListEl.querySelectorAll(".iaiph-note-card.is-focused").forEach(function (card) {
      card.classList.remove("is-focused");
    });
    var card = notesListEl.querySelector('[data-note-id="' + noteId + '"]');
    if (!card) return;
    card.classList.add("is-focused");
    requestAnimationFrame(function () {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function openNotesPanel(focusNoteId) {
    if (!requireSession()) return;
    if (notesPanelEl) notesPanelEl.hidden = false;
    renderNotesList();
    if (focusNoteId) focusNoteInPanel(focusNoteId);
  }

  function closeNotesPanel() {
    if (notesPanelEl) notesPanelEl.hidden = true;
    clearActiveAnnotations();
    if (notesListEl) {
      notesListEl.querySelectorAll(".iaiph-note-card.is-focused").forEach(function (card) {
        card.classList.remove("is-focused");
      });
    }
  }

  function openNoteFromUnderline(ul) {
    if (!ul) return;
    hideToolbar();
    hideHlPopover();
    hideNotePopover();
    window.getSelection().removeAllRanges();
    clearActiveAnnotations();

    var hlId = ul.getAttribute("data-highlight-id") || "";
    setAnnotationGroupActive(hlId, true);

    if (!session) {
      pendingAction = { type: "panel" };
      promptLogin("登录后可查看笔记");
      return;
    }

    var note = notes.filter(function (n) {
      return n.highlight_id === hlId;
    })[0];

    openNotesPanel(note ? note.id : null);
  }

  function handleHighlightAction(color) {
    if (!requireSession({ type: "highlight", color: color })) return;
    createColoredHighlight(color, savedRange).catch(function (err) {
      var msg = (err && err.message) || "标亮失败";
      if (/jwt|session|auth/i.test(msg)) promptLogin();
      else toast(msg);
    });
  }

  function handleNoteAction() {
    if (!requireSession({ type: "note" })) return;
    var range = savedRange;
    var quote = "";
    if (range) {
      quote = range.toString().replace(/\s+/g, " ").trim();
    }
    openNoteEditor({
      quote: quote,
      range: range ? range.cloneRange() : null,
    });
    hideToolbar();
  }

  function unionElementRect(elements) {
    if (!elements.length) return null;
    var top = Infinity;
    var left = Infinity;
    var bottom = -Infinity;
    var right = -Infinity;
    elements.forEach(function (el) {
      var r = el.getBoundingClientRect();
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      bottom = Math.max(bottom, r.bottom);
      right = Math.max(right, r.right);
    });
    return {
      top: top,
      left: left,
      bottom: bottom,
      right: right,
      width: right - left,
      height: bottom - top,
    };
  }

  function setAnnotationGroupActive(id, active) {
    if (!articleEl || !id) return;
    getAnnotationElements(id).forEach(function (el) {
      el.classList.toggle("is-active", !!active);
    });
  }

  function showHlPopover(mark) {
    if (!hlPopoverEl || !mark) return;
    hideToolbar();
    hideNotePopover();
    window.getSelection().removeAllRanges();
    clearActiveAnnotations();
    var id = mark.getAttribute("data-highlight-id") || "";
    setAnnotationGroupActive(id, true);
    hlPopoverEl.hidden = false;
    hlPopoverEl.dataset.highlightId = id;
    requestAnimationFrame(function () {
      var group = getAnnotationElements(id);
      var rect = unionElementRect(group.length ? group : [mark]);
      positionFloating(hlPopoverEl, rect || mark.getBoundingClientRect());
    });
  }

  function showNotePopover(ul) {
    if (!notePopoverEl || !ul) return;
    hideToolbar();
    hideHlPopover();
    window.getSelection().removeAllRanges();
    clearActiveAnnotations();
    var hlId = ul.getAttribute("data-highlight-id") || "";
    setAnnotationGroupActive(hlId, true);
    var note = notes.filter(function (n) {
      return n.highlight_id === hlId;
    })[0];
    notePopoverEl.hidden = false;
    notePopoverEl.dataset.highlightId = hlId;
    notePopoverEl.dataset.noteId = note ? note.id : "";
    requestAnimationFrame(function () {
      var group = getAnnotationElements(hlId);
      var rect = unionElementRect(group.length ? group : [ul]);
      positionFloating(notePopoverEl, rect || ul.getBoundingClientRect());
    });
  }

  function runPendingAction() {
    if (!pendingAction || !session) return;
    var action = pendingAction;
    pendingAction = null;
    if (action.type === "highlight") {
      handleHighlightAction(action.color);
    } else if (action.type === "note") {
      handleNoteAction();
    } else if (action.type === "panel") {
      openNotesPanel();
    }
  }

  function buildUi() {
    toolbarEl = document.createElement("div");
    toolbarEl.className = "iaiph-sel-toolbar";
    toolbarEl.hidden = true;
    toolbarEl.innerHTML =
      '<span class="iaiph-sel-toolbar-label">标亮</span>' +
      COLORS.map(function (c) {
        return (
          '<button type="button" class="iaiph-sel-color iaiph-sel-color--' +
          c +
          '" data-color="' +
          c +
          '" aria-label="' +
          c +
          '"></button>'
        );
      }).join("") +
      '<span class="iaiph-sel-divider" aria-hidden="true"></span>' +
      '<button type="button" class="iaiph-sel-action" data-action="note">笔记</button>';

    toolbarEl.querySelectorAll("[data-color]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
      });
      btn.addEventListener("click", function () {
        handleHighlightAction(btn.getAttribute("data-color"));
      });
    });
    toolbarEl.querySelector("[data-action=note]").addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
    toolbarEl.querySelector("[data-action=note]").addEventListener("click", handleNoteAction);

    hlPopoverEl = document.createElement("div");
    hlPopoverEl.className = "iaiph-hl-popover";
    hlPopoverEl.hidden = true;
    hlPopoverEl.innerHTML =
      '<button type="button" data-pop="note">笔记</button>' +
      '<button type="button" class="iaiph-hl-popover-delete" data-pop="delete">删除标亮</button>';
    hlPopoverEl.querySelector("[data-pop=note]").addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    hlPopoverEl.querySelector("[data-pop=note]").addEventListener("click", function (e) {
      e.stopPropagation();
      var id = hlPopoverEl.dataset.highlightId;
      if (!requireSession()) return;
      var hl = findHighlight(id);
      openNoteEditor({
        quote: hl ? hl.quote : "",
        range: hl ? rangeFromHighlight(hl) : null,
      });
      hideHlPopover();
    });
    hlPopoverEl.querySelector("[data-pop=delete]").addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    hlPopoverEl.querySelector("[data-pop=delete]").addEventListener("click", function (e) {
      e.stopPropagation();
      var id = hlPopoverEl.dataset.highlightId;
      if (!id) return;
      if (!requireSession()) return;
      deleteColoredHighlight(id).catch(function (err) {
        toast((err && err.message) || "删除失败");
      });
    });
    hlPopoverEl.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    notePopoverEl = document.createElement("div");
    notePopoverEl.className = "iaiph-note-popover";
    notePopoverEl.hidden = true;
    notePopoverEl.innerHTML =
      '<button type="button" data-note-pop="edit">编辑笔记</button>' +
      '<button type="button" class="iaiph-note-popover-delete" data-note-pop="delete">删除笔记</button>';
    notePopoverEl.querySelector("[data-note-pop=edit]").addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    notePopoverEl.querySelector("[data-note-pop=edit]").addEventListener("click", function (e) {
      e.stopPropagation();
      var noteId = notePopoverEl.dataset.noteId;
      var hlId = notePopoverEl.dataset.highlightId;
      if (!requireSession()) return;
      var note = findNote(noteId);
      var hl = findHighlight(hlId);
      if (note) {
        openNoteEditor({
          noteId: note.id,
          body: note.body,
          highlightId: note.highlight_id,
          quote: hl ? hl.quote : "",
        });
      } else {
        openNoteEditor({ highlightId: hlId, quote: hl ? hl.quote : "" });
      }
      hideNotePopover();
    });
    notePopoverEl.querySelector("[data-note-pop=delete]").addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    notePopoverEl.querySelector("[data-note-pop=delete]").addEventListener("click", function (e) {
      e.stopPropagation();
      var noteId = notePopoverEl.dataset.noteId;
      if (!noteId) return;
      if (!requireSession()) return;
      deleteNote(noteId).catch(function (err) {
        toast((err && err.message) || "删除失败");
      });
    });
    notePopoverEl.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "iaiph-notes-toggle";
    toggleBtn.textContent = "笔记";
    toggleBtn.addEventListener("click", function () {
      if (!session) {
        pendingAction = { type: "panel" };
        promptLogin("登录后可查看与编辑笔记");
        return;
      }
      if (notesPanelEl && notesPanelEl.hidden) openNotesPanel();
      else closeNotesPanel();
    });

    notesPanelEl = document.createElement("aside");
    notesPanelEl.className = "iaiph-notes-panel";
    notesPanelEl.hidden = true;
    notesPanelEl.innerHTML =
      '<div class="iaiph-notes-panel-header">' +
      '  <h2 class="iaiph-notes-panel-title">' + notesScopeNoun() + "笔记</h2>" +
      '  <button type="button" class="iaiph-notes-panel-close" aria-label="关闭">&times;</button>' +
      "</div>" +
      '<div class="iaiph-notes-list"></div>' +
      '<div class="iaiph-notes-panel-footer">' +
      '  <button type="button" class="iaiph-notes-add-btn">添加' + notesScopeNoun() + "笔记</button>" +
      "</div>";
    notesListEl = notesPanelEl.querySelector(".iaiph-notes-list");
    notesPanelEl.querySelector(".iaiph-notes-panel-close").addEventListener("click", closeNotesPanel);
    notesPanelEl.querySelector(".iaiph-notes-add-btn").addEventListener("click", function () {
      if (!requireSession()) return;
      openNoteEditor({});
    });

    noteEditorEl = document.createElement("div");
    noteEditorEl.className = "iaiph-note-editor";
    noteEditorEl.hidden = true;
    noteEditorEl.innerHTML =
      '<div class="iaiph-note-editor-backdrop" data-note-close="true"></div>' +
      '<div class="iaiph-note-editor-panel">' +
      '  <h3 class="iaiph-note-editor-title">编辑笔记</h3>' +
      '  <p class="iaiph-note-editor-quote" hidden></p>' +
      '  <textarea class="iaiph-note-editor-textarea" placeholder="写下你的想法…"></textarea>' +
      '  <div class="iaiph-note-editor-actions">' +
      '    <button type="button" data-note-close="true">取消</button>' +
      '    <button type="button" class="iaiph-note-editor-save">保存</button>' +
      "  </div>" +
      "</div>";
    noteEditorQuoteEl = noteEditorEl.querySelector(".iaiph-note-editor-quote");
    noteEditorTextarea = noteEditorEl.querySelector(".iaiph-note-editor-textarea");
    noteEditorEl.querySelectorAll("[data-note-close]").forEach(function (el) {
      el.addEventListener("click", closeNoteEditor);
    });
    noteEditorEl.querySelector(".iaiph-note-editor-save").addEventListener("click", function () {
      if (!requireSession() || !noteEditorContext) return;
      saveNote(
        noteEditorTextarea.value,
        noteEditorContext.highlightId,
        noteEditorContext.noteId,
        noteEditorContext.range
      )
        .then(function () {
          closeNoteEditor();
        })
        .catch(function (err) {
          toast((err && err.message) || "保存失败");
        });
    });

    document.body.appendChild(toolbarEl);
    document.body.appendChild(hlPopoverEl);
    document.body.appendChild(notePopoverEl);
    document.body.appendChild(toggleBtn);
    document.body.appendChild(notesPanelEl);
    document.body.appendChild(noteEditorEl);
  }

  function isPopoverTarget(el) {
    return (
      (hlPopoverEl && hlPopoverEl.contains(el)) ||
      (notePopoverEl && notePopoverEl.contains(el))
    );
  }

  function bindEvents() {
    document.addEventListener("mouseup", function (e) {
      if (isPopoverTarget(e.target)) return;
      setTimeout(onSelectionChange, 10);
    });

    document.addEventListener("mousedown", function (e) {
      if (isPopoverTarget(e.target)) return;

      var ul = e.target.closest && e.target.closest("span.iaiph-ul");
      if (ul && articleEl && articleEl.contains(ul)) {
        e.preventDefault();
        openNoteFromUnderline(ul);
        return;
      }

      var mark = e.target.closest && e.target.closest("mark.iaiph-hl");
      if (mark && articleEl && articleEl.contains(mark)) {
        e.preventDefault();
        showHlPopover(mark);
        return;
      }

      if (toolbarEl && !toolbarEl.hidden && !toolbarEl.contains(e.target)) {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed) hideToolbar();
      }
      if ((hlPopoverEl && !hlPopoverEl.hidden) || (notePopoverEl && !notePopoverEl.hidden)) {
        hideAllPopovers();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        hideToolbar();
        hideAllPopovers();
        closeNoteEditor();
        closeNotesPanel();
      }
    });

    window.addEventListener(
      "scroll",
      function () {
        hideToolbar();
        hideAllPopovers();
      },
      true
    );
  }

  function boot() {
    articleEl = resolveArticleRoot();
    if (!articleEl) return;

    buildUi();
    bindEvents();
    bindLoginModal();
    renderNotesList();

    loadSupabaseSdk()
      .then(function () {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        client.auth.onAuthStateChange(function (event, newSession) {
          session = newSession;
          if (newSession && newSession.user) {
            closeLoginModal();
            fetchAnnotations().then(function () {
              runPendingAction();
            });
          } else if (event === "SIGNED_OUT") {
            highlights = [];
            notes = [];
            renderAllAnnotations();
            renderNotesList();
          }
        });
        return client.auth.getSession();
      })
      .then(function (res) {
        if (res.error) throw res.error;
        session = res.data.session;
        if (session && session.user) return fetchAnnotations();
      })
      .catch(function (err) {
        console.warn("[IAIPH reader-annotations]", err);
        if (session) toast("笔记与标亮加载失败，请确认已登录并刷新页面");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
