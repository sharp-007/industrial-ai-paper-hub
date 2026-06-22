(function () {
  "use strict";

  var cfg = window.IAIPH_COMMUNITY || {};
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return;
  }

  var SUPABASE_CDNS = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
    "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  ];
  var STORAGE_RETURN = "iaiph_auth_return";
  var STORAGE_SUBSCRIBED = "iaiph_subscribed_email";
  var statsMap = Object.create(null);
  var userReactions = Object.create(null);
  var client = null;
  var session = null;
  var hotSortOn = false;
  var ready = false;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    var el = document.querySelector(".community-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "community-toast";
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
      s.onload = function () {
        resolve();
      };
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

  function showBar() {
    var bar = $("community-bar");
    if (!bar || bar.getAttribute("data-portal") !== "true") return;
    bar.hidden = false;
    bar.classList.remove("community-bar--hidden");
  }

  function setBarStatus(text, isError) {
    var el = $("community-bar-status");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("is-error", !!isError);
  }

  function setLoginModalMsg(text, isError) {
    var el = $("community-login-modal-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("is-error", !!isError);
  }

  function setSubscribeMsg(text, isError) {
    var el = $("email-subscribe-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("is-error", !!isError);
  }

  function openLoginModal() {
    var modal = $("community-login-modal");
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
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
    var subscribeModal = $("community-subscribe-modal");
    if (!subscribeModal || subscribeModal.hidden) {
      document.body.classList.remove("modal-open");
    }
    setLoginModalMsg("");
  }

  function userDisplayName(user) {
    var meta = (user && user.user_metadata) || {};
    return meta.user_name || meta.full_name || meta.name || meta.preferred_username || (user && user.email) || "用户";
  }

  function userAvatarUrl(user) {
    var meta = (user && user.user_metadata) || {};
    if (meta.avatar_url) return meta.avatar_url;
    if (meta.picture) return meta.picture;
    var identities = (user && user.identities) || [];
    for (var i = 0; i < identities.length; i++) {
      var data = identities[i].identity_data || {};
      if (data.avatar_url) return data.avatar_url;
      if (data.picture) return data.picture;
    }
    return "";
  }

  function userInitials(name) {
    var text = String(name || "用户").trim();
    if (!text) return "U";
    if (text.indexOf("@") > 0) return text.charAt(0).toUpperCase();
    return text.charAt(0).toUpperCase();
  }

  function showAvatarFallback(name) {
    var avatar = $("community-avatar");
    var fallback = $("community-avatar-fallback");
    if (avatar) {
      avatar.hidden = true;
      avatar.removeAttribute("src");
      avatar.onerror = null;
    }
    if (fallback) {
      fallback.textContent = userInitials(name);
      fallback.hidden = false;
    }
  }

  function updateUserAvatar(user, name) {
    var avatar = $("community-avatar");
    var fallback = $("community-avatar-fallback");
    var url = userAvatarUrl(user);
    if (!avatar && !fallback) return;
    if (url && avatar) {
      avatar.onerror = function () {
        avatar.onerror = null;
        showAvatarFallback(name);
      };
      avatar.hidden = false;
      avatar.alt = name;
      avatar.src = url;
      if (fallback) fallback.hidden = true;
      return;
    }
    showAvatarFallback(name);
  }

  function syncAuthBarState(loggedIn) {
    var bar = $("community-bar");
    var loginActions = $("community-login-actions");
    if (bar) {
      bar.classList.toggle("community-bar--logged-in", !!loggedIn);
      bar.classList.toggle("community-bar--logged-out", !loggedIn);
    }
    if (loginActions) loginActions.hidden = !!loggedIn;
  }

  function setLoggedIn(user) {
    var nameEl = $("community-login-name");
    var name = userDisplayName(user);
    syncAuthBarState(true);
    if (nameEl) nameEl.textContent = name;
    updateUserAvatar(user, name);
    setBarStatus("");
    closeLoginModal();
    linkEmailSubscription(user);
    refreshSubscriptionUi();
  }

  function setLoggedOut(options) {
    options = options || {};
    var avatar = $("community-avatar");
    var fallback = $("community-avatar-fallback");
    syncAuthBarState(false);
    if (avatar) {
      avatar.hidden = true;
      avatar.removeAttribute("src");
      avatar.onerror = null;
    }
    if (fallback) {
      fallback.hidden = true;
      fallback.textContent = "";
    }
    userReactions = Object.create(null);
    updateReactionButtons();
    if (options.resetSubscription) {
      clearSubscribedLocal();
      setSubscribeUiInactive();
      var input = $("email-subscribe-input");
      if (input) input.value = "";
    } else {
      refreshSubscriptionUi();
    }
  }

  function prefillSubscribeEmail(email) {
    var input = $("email-subscribe-input");
    if (input && email && !input.value) input.value = email;
  }

  function markSubscribedLocal(email) {
    try {
      sessionStorage.setItem(STORAGE_SUBSCRIBED, normalizeEmail(email));
    } catch (e) {}
  }

  function clearSubscribedLocal() {
    try {
      sessionStorage.removeItem(STORAGE_SUBSCRIBED);
    } catch (e) {}
  }

  function getSubscribedLocal() {
    try {
      return sessionStorage.getItem(STORAGE_SUBSCRIBED) || "";
    } catch (e) {
      return "";
    }
  }

  function setSubscribeUiActive(email) {
    var modal = $("community-subscribe-modal");
    var form = $("email-subscribe-form");
    var status = $("email-subscribe-status");
    var statusEmail = $("email-subscribe-status-email");
    var desc = document.querySelector(".community-subscribe-modal-desc");
    if (form) form.hidden = true;
    setSubscribeMsg("");
    if (status) status.hidden = false;
    if (statusEmail) statusEmail.textContent = email || "";
    if (modal) modal.classList.add("community-subscribe-modal--active");
    if (desc) desc.hidden = true;
    updateSubscribeTrigger(true);
  }

  function setSubscribeUiInactive() {
    var modal = $("community-subscribe-modal");
    var form = $("email-subscribe-form");
    var status = $("email-subscribe-status");
    var desc = document.querySelector(".community-subscribe-modal-desc");
    if (form) form.hidden = false;
    if (status) status.hidden = true;
    if (modal) modal.classList.remove("community-subscribe-modal--active");
    if (desc) desc.hidden = false;
    updateSubscribeTrigger(false);
    if (session && session.user) prefillSubscribeEmail(session.user.email);
  }

  function updateSubscribeTrigger(subscribed) {
    var btn = $("community-subscribe-open");
    if (!btn) return;
    btn.classList.toggle("is-subscribed", !!subscribed);
    btn.setAttribute("aria-pressed", subscribed ? "true" : "false");
    btn.setAttribute("title", subscribed ? "已订阅 · 点击查看" : "订阅更新");
    btn.setAttribute("aria-label", subscribed ? "查看邮件订阅状态" : "订阅文献更新");
    var label = btn.querySelector(".community-subscribe-label");
    if (label) label.textContent = subscribed ? "已订阅" : "订阅";
  }

  function openSubscribeModal() {
    var modal = $("community-subscribe-modal");
    if (!modal) return;
    closeLoginModal();
    modal.hidden = false;
    document.body.classList.add("modal-open");
    setSubscribeMsg("");
    var subscribed = modal.classList.contains("community-subscribe-modal--active");
    var input = $("email-subscribe-input");
    if (!subscribed && input) {
      if (session && session.user && session.user.email && !input.value) {
        input.value = session.user.email;
      }
      input.focus();
    }
  }

  function closeSubscribeModal() {
    var modal = $("community-subscribe-modal");
    if (!modal) return;
    modal.hidden = true;
    if (!$("community-login-modal") || $("community-login-modal").hidden) {
      document.body.classList.remove("modal-open");
    }
    setSubscribeMsg("");
  }

  function bindSubscribeModal() {
    var openBtn = $("community-subscribe-open");
    var modal = $("community-subscribe-modal");

    if (openBtn) {
      openBtn.addEventListener("click", openSubscribeModal);
    }

    if (modal) {
      modal.querySelectorAll("[data-subscribe-close]").forEach(function (el) {
        el.addEventListener("click", closeSubscribeModal);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && modal && !modal.hidden) closeSubscribeModal();
      });
    }
  }

  function fetchSubscriptionStatus(user) {
    if (!client || !user) return Promise.resolve(null);
    function byUserId() {
      if (!user.id) return Promise.resolve(null);
      return client
        .from("email_subscriptions")
        .select("email, active")
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle()
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
    }
    function byEmail() {
      var email = user.email ? normalizeEmail(user.email) : "";
      if (!email) return Promise.resolve(null);
      return client
        .from("email_subscriptions")
        .select("email, active")
        .eq("email", email)
        .eq("active", true)
        .limit(1)
        .maybeSingle()
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
    }
    return byUserId().then(function (row) {
      if (row && row.email) return row;
      return byEmail();
    });
  }

  function refreshSubscriptionUi() {
    if (!client) {
      var localOnly = getSubscribedLocal();
      if (localOnly) setSubscribeUiActive(localOnly);
      return Promise.resolve();
    }
    if (session && session.user) {
      return fetchSubscriptionStatus(session.user)
        .then(function (row) {
          if (row && row.email) {
            markSubscribedLocal(row.email);
            setSubscribeUiActive(row.email);
            return;
          }
          var local = getSubscribedLocal();
          var userEmail = session.user.email ? normalizeEmail(session.user.email) : "";
          if (local && userEmail && local === userEmail) {
            setSubscribeUiActive(local);
            return;
          }
          setSubscribeUiInactive();
        })
        .catch(function () {
          var fallback = getSubscribedLocal();
          if (fallback) setSubscribeUiActive(fallback);
        });
    }
    var local = getSubscribedLocal();
    if (local) setSubscribeUiActive(local);
    else setSubscribeUiInactive();
    return Promise.resolve();
  }

  function linkEmailSubscription(user) {
    if (!client || !user || !user.email) return;
    client
      .from("email_subscriptions")
      .update({ user_id: user.id, active: true })
      .eq("email", normalizeEmail(user.email))
      .then(function () {});
  }

  function subscribeEmail(rawEmail) {
    if (!client) return Promise.reject(new Error("社区服务未就绪"));
    var email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) return Promise.reject(new Error("请输入有效邮箱"));
    var row = { email: email, source: "portal", active: true };
    if (session && session.user) row.user_id = session.user.id;
    return client.from("email_subscriptions").insert(row).then(function (res) {
      if (!res.error) return;
      var code = res.error.code || "";
      var msg = res.error.message || "";
      if (code === "23505" || /duplicate|unique/i.test(msg)) {
        throw new Error("该邮箱已订阅，感谢关注");
      }
      throw res.error;
    });
  }

  function trackEvent(name, meta) {
    if (!client || !session) return;
    client
      .from("events")
      .insert({
        event_name: name,
        paper_folder: meta && meta.paper_folder ? meta.paper_folder : null,
        section_file: meta && meta.section_file ? meta.section_file : null,
        meta: meta || {},
        user_id: session.user.id,
      })
      .then(function () {});
  }

  function trackShare(paperFolder) {
    if (!client || !paperFolder) return Promise.resolve();
    var row = {
      event_name: "share",
      paper_folder: paperFolder,
      meta: {},
    };
    if (session && session.user) row.user_id = session.user.id;
    return client.from("events").insert(row).then(function (res) {
      if (res.error) return;
      statsMap[paperFolder] = statsMap[paperFolder] || {};
      statsMap[paperFolder].share_count = (statsMap[paperFolder].share_count || 0) + 1;
      applyStatsToDom();
    });
  }

  function trackView(paperFolder) {
    if (!client || !paperFolder) return Promise.resolve();
    var row = {
      event_name: "view",
      paper_folder: paperFolder,
      meta: {},
    };
    if (session && session.user) row.user_id = session.user.id;
    return client.from("events").insert(row).then(function (res) {
      if (res.error) return;
      statsMap[paperFolder] = statsMap[paperFolder] || {};
      statsMap[paperFolder].view_count = (statsMap[paperFolder].view_count || 0) + 1;
      applyStatsToDom();
    });
  }

  window.IAIPH = window.IAIPH || {};
  window.IAIPH.trackShare = trackShare;
  window.IAIPH.trackView = trackView;

  function paperFolderFromContext() {
    var bar = $("community-bar");
    if (bar) {
      var folder = bar.getAttribute("data-paper-folder");
      if (folder) return folder;
    }
    var m = location.pathname.match(/\/papers\/([^/]+)\/page-renders\//);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function isReadingPage() {
    return !!paperFolderFromContext() && !($("community-bar") && $("community-bar").getAttribute("data-portal") === "true");
  }

  function viewStorageKey(folder) {
    return "iaiph_view_v2_" + folder;
  }

  function markViewTracked(folder) {
    try {
      sessionStorage.setItem(viewStorageKey(folder), "1");
    } catch (e) {}
  }

  function maybeTrackReadingView() {
    if (!isReadingPage()) return;
    var folder = paperFolderFromContext();
    if (!folder) return;
    try {
      if (sessionStorage.getItem(viewStorageKey(folder))) return;
    } catch (e) {}
    trackView(folder).then(function () {
      markViewTracked(folder);
    });
  }

  function formatCount(value) {
    var n = Number(value) || 0;
    if (n < 10000) return String(n);
    if (n < 100000000) {
      var wan = n / 10000;
      var wanText = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "");
      return wanText + "万";
    }
    var yi = n / 100000000;
    var yiText = yi >= 100 ? String(Math.round(yi)) : yi.toFixed(1).replace(/\.0$/, "");
    return yiText + "亿";
  }

  function setCountNode(node, value) {
    var n = Number(value) || 0;
    var text = formatCount(n);
    node.textContent = text;
    if (text !== String(n)) node.setAttribute("title", String(n));
    else node.removeAttribute("title");
  }

  function paperHotScore(stat) {
    if (!stat) return 0;
    return (stat.like_count || 0) + (stat.favorite_count || 0);
  }

  function fetchStats() {
    return client
      .from("paper_stats")
      .select("paper_folder,view_count,like_count,favorite_count,share_count")
      .then(function (res) {
        if (res.error) throw res.error;
        statsMap = Object.create(null);
        (res.data || []).forEach(function (row) {
          statsMap[row.paper_folder] = row;
        });
        applyStatsToDom();
      });
  }

  function applyStatsToDom() {
    document.querySelectorAll(".paper-engagement[data-paper-folder]").forEach(function (el) {
      var folder = el.getAttribute("data-paper-folder");
      var stat = statsMap[folder] || {};
      el.querySelectorAll("[data-stat]").forEach(function (node) {
        var key = node.getAttribute("data-stat");
        var val = stat[key];
        setCountNode(node, val != null ? val : 0);
      });
    });

    document.querySelectorAll(".paper-card[data-paper-folder]").forEach(function (card) {
      var folder = card.getAttribute("data-paper-folder");
      var stat = statsMap[folder];
      card.dataset.hotScore = String(paperHotScore(stat));
    });

    if (hotSortOn) applyHotSort();
  }

  function fetchUserReactions() {
    if (!session) return Promise.resolve();
    return client
      .from("paper_reactions")
      .select("paper_folder,kind")
      .eq("user_id", session.user.id)
      .then(function (res) {
        if (res.error) throw res.error;
        userReactions = Object.create(null);
        (res.data || []).forEach(function (row) {
          if (!userReactions[row.paper_folder]) userReactions[row.paper_folder] = {};
          userReactions[row.paper_folder][row.kind] = true;
        });
        updateReactionButtons();
      });
  }

  function updateReactionButtons() {
    document.querySelectorAll(".paper-engagement[data-paper-folder]").forEach(function (el) {
      var folder = el.getAttribute("data-paper-folder");
      var mine = userReactions[folder] || {};
      el.querySelectorAll(".community-like, .community-favorite").forEach(function (btn) {
        var kind = btn.getAttribute("data-kind");
        btn.setAttribute("aria-pressed", mine[kind] ? "true" : "false");
      });
    });
  }

  function promptLogin() {
    toast("请先登录（GitHub 或邮箱）");
    openLoginModal();
    var btn = $("community-login-open");
    if (btn) {
      btn.classList.add("community-btn--pulse");
      setTimeout(function () {
        btn.classList.remove("community-btn--pulse");
      }, 1200);
    }
  }

  function toggleReaction(folder, kind) {
    if (!ready || !client) {
      toast("社区功能加载中，请稍候…");
      return Promise.resolve();
    }
    if (!session) {
      promptLogin();
      return Promise.resolve();
    }
    var mine = (userReactions[folder] && userReactions[folder][kind]) || false;
    if (mine) {
      return client
        .from("paper_reactions")
        .delete()
        .eq("user_id", session.user.id)
        .eq("paper_folder", folder)
        .eq("kind", kind)
        .then(function (res) {
          if (res.error) throw res.error;
          if (!userReactions[folder]) userReactions[folder] = {};
          userReactions[folder][kind] = false;
          updateReactionButtons();
          return fetchStats();
        })
        .then(function () {
          trackEvent(kind === "like" ? "unlike" : "unfavorite", { paper_folder: folder });
        });
    }
    return client
      .from("paper_reactions")
      .insert({
        user_id: session.user.id,
        paper_folder: folder,
        kind: kind,
      })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!userReactions[folder]) userReactions[folder] = {};
        userReactions[folder][kind] = true;
        updateReactionButtons();
        return fetchStats();
      })
      .then(function () {
        trackEvent(kind === "like" ? "like" : "favorite", { paper_folder: folder });
      });
  }

  function applyHotSort() {
    var list = document.querySelector(".paper-list");
    if (!list) return;
    var cards = Array.prototype.slice.call(list.querySelectorAll(".paper-card"));
    cards.sort(function (a, b) {
      return parseFloat(b.dataset.hotScore || "0") - parseFloat(a.dataset.hotScore || "0");
    });
    cards.forEach(function (card, i) {
      card.style.order = String(i);
      list.appendChild(card);
    });
    list.classList.add("is-sorted-hot");
  }

  function clearHotSort() {
    var list = document.querySelector(".paper-list");
    if (!list) return;
    list.classList.remove("is-sorted-hot");
    Array.prototype.forEach.call(list.querySelectorAll(".paper-card"), function (card) {
      card.style.order = "";
    });
  }

  function signInWithGithub() {
    if (!client) {
      toast("正在连接 Supabase…");
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
    if (!client) return Promise.reject(new Error("社区服务未就绪"));
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
    var openBtn = $("community-login-open");
    var modal = $("community-login-modal");
    var githubBtn = $("community-login-github");
    var emailForm = $("community-login-email-form");

    if (openBtn) {
      openBtn.addEventListener("click", openLoginModal);
    }

    if (modal) {
      modal.querySelectorAll("[data-login-close]").forEach(function (el) {
        el.addEventListener("click", closeLoginModal);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && modal && !modal.hidden) closeLoginModal();
      });
    }

    if (githubBtn) {
      githubBtn.addEventListener("click", signInWithGithub);
    }

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
            var msg = (err && err.message) || "发送失败，请稍后重试";
            setLoginModalMsg(msg, true);
          })
          .finally(function () {
            submitBtn.disabled = false;
          });
      });
    }
  }

  function bindSubscribeForm() {
    var form = $("email-subscribe-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("email-subscribe-input");
      var btn = $("email-subscribe-btn");
      if (!input || !btn) return;
      btn.disabled = true;
      setSubscribeMsg("");
      subscribeEmail(input.value)
        .then(function () {
          var email = normalizeEmail(input.value);
          markSubscribedLocal(email);
          setSubscribeUiActive(email);
          toast("订阅成功");
          if (client) {
            var row = { event_name: "subscribe", meta: { email: email } };
            if (session && session.user) row.user_id = session.user.id;
            client.from("events").insert(row);
          }
        })
        .catch(function (err) {
          var msg = (err && err.message) || "订阅失败，请稍后重试";
          var email = normalizeEmail(input.value);
          if (/已订阅/.test(msg)) {
            markSubscribedLocal(email);
            setSubscribeUiActive(email);
            toast(msg);
            return;
          }
          setSubscribeMsg(msg, true);
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  function bindUi() {
    var logoutBtn = $("community-logout");
    var sortBtn = $("community-sort-hot");

    bindLoginModal();
    bindSubscribeModal();
    bindSubscribeForm();

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        client.auth.signOut().then(function () {
          toast("已退出登录");
        });
      });
    }

    if (sortBtn) {
      sortBtn.addEventListener("click", function () {
        hotSortOn = !hotSortOn;
        sortBtn.classList.toggle("is-active", hotSortOn);
        if (hotSortOn) {
          applyHotSort();
          toast("已按点赞与收藏排序");
        } else {
          clearHotSort();
          toast("已恢复默认顺序");
        }
      });
    }

    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".community-like, .community-favorite");
      if (!btn) return;
      e.preventDefault();
      var wrap = btn.closest(".paper-engagement[data-paper-folder]");
      if (!wrap) return;
      var folder = wrap.getAttribute("data-paper-folder");
      var kind = btn.getAttribute("data-kind");
      btn.disabled = true;
      toggleReaction(folder, kind)
        .catch(function (err) {
          var msg = (err && err.message) || "操作失败";
          if (/jwt|session|auth/i.test(msg)) promptLogin();
          else toast(msg);
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  function initSession() {
    return client.auth.getSession().then(function (res) {
      if (res.error) throw res.error;
      session = res.data.session;
      if (session && session.user) setLoggedIn(session.user);
      else setLoggedOut({ resetSubscription: false });
      return fetchUserReactions();
    });
  }

  function boot() {
    showBar();
    setBarStatus("正在连接社区服务…", false);

    loadSupabaseSdk()
      .then(function () {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        client.auth.onAuthStateChange(function (event, newSession) {
          session = newSession;
          if (newSession && newSession.user) {
            setLoggedIn(newSession.user);
            fetchUserReactions();
            if (event === "SIGNED_IN") trackEvent("login", {});
          } else if (event === "SIGNED_OUT") {
            setLoggedOut({ resetSubscription: true });
          } else {
            setLoggedOut({ resetSubscription: false });
          }
        });
        bindUi();
        return initSession();
      })
      .then(function () {
        return fetchStats();
      })
      .then(function () {
        ready = true;
        setBarStatus("");
        maybeTrackReadingView();
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible" && ready && client) fetchStats();
        });
        window.addEventListener("pageshow", function () {
          if (ready && client) fetchStats();
        });
      })
      .catch(function (err) {
        console.warn("[IAIPH community]", err);
        ready = false;
        setBarStatus("社区服务连接失败，点赞需稍后重试", true);
        bindUi();
        toast("Supabase 连接失败，请检查网络或控制台配置");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
