(function () {
  "use strict";

  var cfg = window.IAIPH_COMMUNITY || {};
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  var pathMatch = location.pathname.match(/\/papers\/([^/]+)\/page-renders\//);
  if (!pathMatch) return;

  var PAPER_FOLDER = decodeURIComponent(pathMatch[1]);
  var SUPABASE_CDNS = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
    "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  ];

  var client = null;
  var session = null;
  var ready = false;
  var userReactions = Object.create(null);
  var readCompleted = false;
  var stats = {};

  var ICON_LIKE_OUTLINE =
    '<svg class="community-action-icon community-action-icon--outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
  var ICON_LIKE_FILLED =
    '<svg class="community-action-icon community-action-icon--filled" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88L15 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22Z"/></svg>';
  var ICON_FAV_OUTLINE =
    '<svg class="community-action-icon community-action-icon--outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var ICON_FAV_FILLED =
    '<svg class="community-action-icon community-action-icon--filled" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  var ICON_SHARE =
    '<svg class="community-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="M15.41 6.51l-6.82 3.98"/></svg>';

  function toast(msg) {
    var el = document.querySelector(".sidebar-reader-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "sidebar-reader-toast";
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

  function formatCount(value) {
    var n = Number(value) || 0;
    if (n < 10000) return String(n);
    if (n < 100000000) {
      var wan = n / 10000;
      return (wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "")) + "万";
    }
    var yi = n / 100000000;
    return (yi >= 100 ? String(Math.round(yi)) : yi.toFixed(1).replace(/\.0$/, "")) + "亿";
  }

  function setCountNode(node, value) {
    if (!node) return;
    var n = Number(value) || 0;
    node.textContent = formatCount(n);
    if (formatCount(n) !== String(n)) node.setAttribute("title", String(n));
    else node.removeAttribute("title");
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

  function paperShareMeta() {
    var header = document.querySelector(".sidebar-header");
    var titleEl = header && header.querySelector(".sidebar-title-link");
    var subtitleEl = header && header.querySelector(".subtitle");
    var title = titleEl ? titleEl.textContent.trim() : "";
    var titleEn = subtitleEl ? subtitleEl.textContent.trim() : "";
    var relPath = "papers/" + PAPER_FOLDER + "/page-renders/index.html";
    var host = (cfg.primaryHost || (window.IAIPH_SITE && window.IAIPH_SITE.primaryHost) || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    var url = host ? "https://" + host + "/" + relPath : location.origin + siteBasePath() + relPath;
    return { title: title, titleEn: titleEn, desc: "", path: relPath, url: url };
  }

  function promptLogin() {
    toast("请先登录后再操作");
    var modal = document.getElementById("community-login-modal");
    if (modal) {
      modal.hidden = false;
      document.body.classList.add("iaiph-modal-open");
    }
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

  function ensureShareModal() {
    if (document.getElementById("share-modal")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="share-modal" id="share-modal" hidden role="dialog" aria-modal="true" aria-labelledby="share-modal-title">' +
      '  <div class="share-modal-backdrop" data-share-close="true"></div>' +
      '  <div class="share-modal-panel">' +
      '    <button class="share-modal-close" type="button" data-share-close="true" aria-label="关闭">&times;</button>' +
      '    <h2 class="share-modal-title" id="share-modal-title">分享文献</h2>' +
      '    <p class="share-modal-hint">复制卡片文案，或生成二维码供他人扫码阅读</p>' +
      '    <article class="share-card-preview" id="share-card-preview">' +
      '      <p class="share-card-kicker">Industrial AI Paper Hub</p>' +
      '      <h3 class="share-card-title" id="share-card-title"></h3>' +
      '      <p class="share-card-title-en" id="share-card-title-en" hidden></p>' +
      '      <p class="share-card-desc" id="share-card-desc"></p>' +
      '      <dl class="share-card-links">' +
      '        <div class="share-card-link-row">' +
      "          <dt>中译阅读</dt>" +
      '          <dd><a class="share-card-link-url" id="share-card-url-translation" href="#" target="_blank" rel="noopener noreferrer"></a></dd>' +
      "        </div>" +
      '        <div class="share-card-link-row" id="share-card-original-row" hidden>' +
      "          <dt>英文原文</dt>" +
      '          <dd><a class="share-card-link-url" id="share-card-url-original" href="#" target="_blank" rel="noopener noreferrer"></a></dd>' +
      "        </div>" +
      "      </dl>" +
      "    </article>" +
      '    <div class="share-modal-actions">' +
      '      <button type="button" class="share-action-btn share-action-btn--primary" id="share-copy-card">复制分享卡片</button>' +
      '      <button type="button" class="share-action-btn" id="share-copy-link">复制译文链接</button>' +
      "    </div>" +
      '    <div class="share-qrcode-section">' +
      '      <button type="button" class="share-action-btn" id="share-show-qrcode">分享二维码</button>' +
      '      <div class="share-qrcode-wrap" id="share-qrcode-wrap" hidden>' +
      '        <div class="share-qrcode" id="share-qrcode" aria-label="扫码打开中译"></div>' +
      '        <p class="share-qrcode-hint">微信扫一扫 · 打开中译阅读</p>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>";
    document.body.appendChild(wrap.firstChild);
  }

  function engagementButton(kind, label, icons) {
    return (
      '<button type="button" class="community-action community-' +
      kind +
      '" data-kind="' +
      kind +
      '" aria-pressed="false" aria-label="' +
      label +
      '">' +
      '<span class="community-action-icon-wrap" aria-hidden="true">' +
      icons +
      "</span>" +
      '<span class="community-count" data-stat="' +
      kind +
      '_count">0</span>' +
      '<span class="community-action-tip">' +
      label +
      "</span></button>"
    );
  }

  function buildSidebarPanel(sidebar) {
    if (sidebar.querySelector(".sidebar-read-panel")) return sidebar.querySelector(".sidebar-read-panel");
    var meta = paperShareMeta();
    var panel = document.createElement("div");
    panel.className = "sidebar-read-panel";
    panel.innerHTML =
      '<button type="button" class="sidebar-read-complete-btn" id="sidebar-read-complete-btn" aria-pressed="false">' +
      '<svg class="sidebar-read-complete-icon sidebar-read-complete-icon--outline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>' +
      '<svg class="sidebar-read-complete-icon sidebar-read-complete-icon--filled" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-2 14.5-3.5-3.5 1.41-1.41L10 13.67l5.59-5.59L17 9.5l-7 7Z"/></svg>' +
      '<span class="sidebar-read-complete-label">确认已读完</span>' +
      "</button>" +
      '<div class="paper-engagement sidebar-engagement" data-paper-folder="' +
      PAPER_FOLDER +
      '">' +
      engagementButton("like", "点赞", ICON_LIKE_OUTLINE + ICON_LIKE_FILLED) +
      engagementButton("favorite", "收藏", ICON_FAV_OUTLINE + ICON_FAV_FILLED) +
      '<button type="button" class="community-action paper-share-btn" aria-label="分享"' +
      ' data-share-title="' +
      meta.title.replace(/"/g, "&quot;") +
      '"' +
      ' data-share-title-en="' +
      meta.titleEn.replace(/"/g, "&quot;") +
      '"' +
      ' data-share-desc=""' +
      ' data-share-path="' +
      meta.path +
      '"' +
      ' data-share-url="' +
      meta.url +
      '">' +
      '<span class="community-action-icon-wrap" aria-hidden="true">' +
      ICON_SHARE +
      "</span>" +
      '<span class="community-count" data-stat="share_count">0</span>' +
      '<span class="community-action-tip">分享</span></button>' +
      "</div>";
    sidebar.appendChild(panel);
    return panel;
  }

  function ensureReadBadge() {
    var header = document.querySelector(".sidebar-header h1");
    if (!header || header.querySelector(".sidebar-read-badge")) return header && header.querySelector(".sidebar-read-badge");
    var badge = document.createElement("span");
    badge.className = "sidebar-read-badge";
    badge.hidden = true;
    badge.textContent = "已读";
    header.appendChild(badge);
    return badge;
  }

  function updateReadUi() {
    var btn = document.getElementById("sidebar-read-complete-btn");
    var badge = ensureReadBadge();
    var label = btn && btn.querySelector(".sidebar-read-complete-label");
    if (btn) {
      btn.setAttribute("aria-pressed", readCompleted ? "true" : "false");
      if (label) label.textContent = readCompleted ? "已读完（点击取消）" : "确认已读完";
    }
    if (badge) badge.hidden = !readCompleted;
  }

  function updateReactionButtons() {
    var panel = document.querySelector('.sidebar-engagement[data-paper-folder="' + PAPER_FOLDER + '"]');
    if (!panel) return;
    var mine = userReactions[PAPER_FOLDER] || {};
    panel.querySelectorAll(".community-like, .community-favorite").forEach(function (btn) {
      var kind = btn.getAttribute("data-kind");
      btn.setAttribute("aria-pressed", mine[kind] ? "true" : "false");
    });
  }

  function updateStatsUi() {
    var panel = document.querySelector('.sidebar-engagement[data-paper-folder="' + PAPER_FOLDER + '"]');
    if (!panel) return;
    panel.querySelectorAll("[data-stat]").forEach(function (node) {
      var key = node.getAttribute("data-stat");
      setCountNode(node, stats[key] != null ? stats[key] : 0);
    });
  }

  function fetchStats() {
    if (!client) return Promise.resolve();
    return client
      .from("paper_stats")
      .select("view_count,like_count,favorite_count,share_count")
      .eq("paper_folder", PAPER_FOLDER)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        stats = res.data || {};
        updateStatsUi();
      });
  }

  function fetchUserReactions() {
    if (!client || !session) return Promise.resolve();
    return client
      .from("paper_reactions")
      .select("paper_folder,kind")
      .eq("user_id", session.user.id)
      .eq("paper_folder", PAPER_FOLDER)
      .then(function (res) {
        if (res.error) throw res.error;
        userReactions[PAPER_FOLDER] = {};
        (res.data || []).forEach(function (row) {
          userReactions[PAPER_FOLDER][row.kind] = true;
        });
        updateReactionButtons();
      });
  }

  function fetchReadCompletion() {
    if (!client || !session) {
      readCompleted = false;
      updateReadUi();
      return Promise.resolve();
    }
    return client
      .from("paper_read_completions")
      .select("paper_folder")
      .eq("user_id", session.user.id)
      .eq("paper_folder", PAPER_FOLDER)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        readCompleted = !!res.data;
        updateReadUi();
      })
      .catch(function () {
        readCompleted = false;
        updateReadUi();
      });
  }

  function trackShare() {
    if (!client || !PAPER_FOLDER) return Promise.resolve();
    var row = { event_name: "share", paper_folder: PAPER_FOLDER, meta: { source: "reader-sidebar" } };
    if (session && session.user) row.user_id = session.user.id;
    return client.from("events").insert(row).then(function (res) {
      if (res.error) return;
      return fetchStats();
    });
  }

  window.IAIPH = window.IAIPH || {};
  window.IAIPH.trackShare = trackShare;

  function toggleReaction(kind) {
    if (!ready || !client) {
      toast("社区功能加载中…");
      return Promise.resolve();
    }
    if (!session) {
      promptLogin();
      return Promise.resolve();
    }
    var mine = (userReactions[PAPER_FOLDER] && userReactions[PAPER_FOLDER][kind]) || false;
    if (mine) {
      return client
        .from("paper_reactions")
        .delete()
        .eq("user_id", session.user.id)
        .eq("paper_folder", PAPER_FOLDER)
        .eq("kind", kind)
        .then(function (res) {
          if (res.error) throw res.error;
          if (!userReactions[PAPER_FOLDER]) userReactions[PAPER_FOLDER] = {};
          userReactions[PAPER_FOLDER][kind] = false;
          updateReactionButtons();
          return fetchStats();
        })
        .catch(function (err) {
          toast((err && err.message) || "操作失败");
        });
    }
    return client
      .from("paper_reactions")
      .insert({ user_id: session.user.id, paper_folder: PAPER_FOLDER, kind: kind })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!userReactions[PAPER_FOLDER]) userReactions[PAPER_FOLDER] = {};
        userReactions[PAPER_FOLDER][kind] = true;
        updateReactionButtons();
        return fetchStats();
      })
      .catch(function (err) {
        toast((err && err.message) || "操作失败");
      });
  }

  function toggleReadComplete() {
    if (!ready || !client) {
      toast("社区功能加载中…");
      return;
    }
    if (!session) {
      promptLogin();
      return;
    }
    if (readCompleted) {
      client
        .from("paper_read_completions")
        .delete()
        .eq("user_id", session.user.id)
        .eq("paper_folder", PAPER_FOLDER)
        .then(function (res) {
          if (res.error) throw res.error;
          readCompleted = false;
          updateReadUi();
          toast("已取消读完标记");
        })
        .catch(function (err) {
          toast((err && err.message) || "操作失败");
        });
      return;
    }
    client
      .from("paper_read_completions")
      .upsert({
        user_id: session.user.id,
        paper_folder: PAPER_FOLDER,
        completed_at: new Date().toISOString(),
      })
      .then(function (res) {
        if (res.error) throw res.error;
        readCompleted = true;
        updateReadUi();
        toast("已标记读完本篇文献");
      })
      .catch(function (err) {
        toast((err && err.message) || "标记失败，请确认已在 Supabase 执行 migrate_read_completions.sql");
      });
  }

  function bindPanelEvents(panel) {
    var readBtn = panel.querySelector("#sidebar-read-complete-btn");
    if (readBtn) {
      readBtn.addEventListener("click", toggleReadComplete);
    }
    panel.querySelectorAll(".community-like, .community-favorite").forEach(function (btn) {
      btn.addEventListener("click", function () {
        toggleReaction(btn.getAttribute("data-kind"));
      });
    });
  }

  function refreshUserState() {
    return Promise.all([fetchUserReactions(), fetchReadCompletion()]);
  }

  function boot() {
    var sidebar = document.getElementById("sidebar-nav");
    if (!sidebar) return;

    ensureShareModal();
    var panel = buildSidebarPanel(sidebar);
    ensureReadBadge();
    bindPanelEvents(panel);
    updateReadUi();

    loadSupabaseSdk()
      .then(function () {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        client.auth.onAuthStateChange(function (_event, newSession) {
          session = newSession;
          refreshUserState();
        });
        return client.auth.getSession();
      })
      .then(function (res) {
        if (res.error) throw res.error;
        session = res.data.session;
        ready = true;
        return Promise.all([fetchStats(), refreshUserState()]);
      })
      .catch(function (err) {
        console.warn("[IAIPH reader-sidebar]", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
