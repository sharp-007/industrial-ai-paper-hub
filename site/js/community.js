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

  function setLoggedIn(user) {
    var loginBtn = $("community-login");
    var userBox = $("community-user");
    var avatar = $("community-avatar");
    var nameEl = $("community-login-name");
    if (loginBtn) loginBtn.hidden = true;
    if (userBox) userBox.hidden = false;
    var meta = user.user_metadata || {};
    var name = meta.user_name || meta.full_name || user.email || "用户";
    if (nameEl) nameEl.textContent = name;
    if (avatar) {
      avatar.src = meta.avatar_url || "";
      avatar.hidden = !meta.avatar_url;
    }
    setBarStatus("");
  }

  function setLoggedOut() {
    var loginBtn = $("community-login");
    var userBox = $("community-user");
    if (loginBtn) loginBtn.hidden = false;
    if (userBox) userBox.hidden = true;
    userReactions = Object.create(null);
    updateReactionButtons();
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
    toast("请先点击上方 GitHub 登录");
    var loginBtn = $("community-login");
    if (loginBtn) {
      loginBtn.focus();
      loginBtn.classList.add("community-btn--pulse");
      setTimeout(function () {
        loginBtn.classList.remove("community-btn--pulse");
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

  function bindUi() {
    var loginBtn = $("community-login");
    var logoutBtn = $("community-logout");
    var sortBtn = $("community-sort-hot");

    if (loginBtn) {
      loginBtn.addEventListener("click", function () {
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
            if (res.error) toast(res.error.message);
          });
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        client.auth.signOut().then(function () {
          setLoggedOut();
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
      else setLoggedOut();
      return fetchUserReactions();
    });
  }

  function boot() {
    showBar();
    setBarStatus("正在连接社区服务…", false);

    loadSupabaseSdk()
      .then(function () {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        client.auth.onAuthStateChange(function (_event, newSession) {
          session = newSession;
          if (newSession && newSession.user) {
            setLoggedIn(newSession.user);
            fetchUserReactions();
            trackEvent("login", {});
          } else {
            setLoggedOut();
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
