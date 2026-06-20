(function () {
  "use strict";

  var cfg = window.IAIPH_COMMUNITY || {};
  if (!cfg.enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  var match = location.pathname.match(/\/papers\/([^/]+)\/page-renders\//);
  if (!match) return;

  var folder = decodeURIComponent(match[1]);
  var storageKey = "iaiph_view_v2_" + folder;
  var sent = false;

  function alreadySent() {
    try {
      return sessionStorage.getItem(storageKey) === "1";
    } catch (e) {
      return false;
    }
  }

  function markSent() {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch (e) {}
  }

  function readSessionFromStorage() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf("-auth-token") === -1) continue;
        var raw = localStorage.getItem(key);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (!data) continue;
        var userId = data.user && data.user.id ? data.user.id : null;
        var accessToken = data.access_token || null;
        if (accessToken) return { userId: userId, accessToken: accessToken };
      }
    } catch (e) {}
    return null;
  }

  function sendViewEvent(force) {
    if (sent && !force) return;
    if (!force && alreadySent()) return;

    var session = readSessionFromStorage();
    var payload = {
      event_name: "view",
      paper_folder: folder,
      meta: {},
    };
    if (session && session.userId) payload.user_id = session.userId;

    var authHeader =
      session && session.accessToken
        ? "Bearer " + session.accessToken
        : "Bearer " + cfg.supabaseAnonKey;

    sent = true;
    fetch(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/events", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseAnonKey,
        Authorization: authHeader,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (res.ok) {
          markSent();
          return;
        }
        sent = false;
        console.warn("[IAIPH view-track] insert failed:", res.status);
      })
      .catch(function (err) {
        sent = false;
        console.warn("[IAIPH view-track]", err);
      });
  }

  if (alreadySent()) return;

  sendViewEvent(false);

  window.addEventListener("pagehide", function () {
    if (!alreadySent()) sendViewEvent(true);
  });
})();
