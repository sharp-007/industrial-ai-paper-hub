(function () {
  "use strict";

  var cfg = window.IAIPH_SITE || {};
  var modal = document.getElementById("share-modal");
  if (!modal) return;

  var backdrop = modal.querySelector(".share-modal-backdrop");
  var closeBtn = modal.querySelector(".share-modal-close");
  var titleEl = document.getElementById("share-card-title");
  var titleEnEl = document.getElementById("share-card-title-en");
  var descEl = document.getElementById("share-card-desc");
  var translationUrlEl = document.getElementById("share-card-url-translation");
  var originalUrlEl = document.getElementById("share-card-url-original");
  var originalRowEl = document.getElementById("share-card-original-row");
  var qrcodeEl = document.getElementById("share-qrcode");
  var copyLinkBtn = document.getElementById("share-copy-link");
  var copyCardBtn = document.getElementById("share-copy-card");
  var toastEl = document.querySelector(".share-toast");
  var qrcodeInstance = null;

  var current = { title: "", titleEn: "", desc: "", url: "", originalUrl: "" };

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "share-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      toastEl.classList.remove("is-visible");
    }, 2600);
  }

  function siteBasePath() {
    var base = cfg.githubPagesBase || "/industrial-ai-paper-hub/";
    if (location.hostname.endsWith("github.io")) {
      return base.charAt(0) === "/" ? base : "/" + base;
    }
    if (location.pathname.indexOf("/industrial-ai-paper-hub/") === 0) {
      return "/industrial-ai-paper-hub/";
    }
    return "/";
  }

  function resolveShareUrl(btn) {
    var rel = btn.getAttribute("data-share-path") || "";
    var canonical = (btn.getAttribute("data-share-url") || "").trim();
    var host = (cfg.primaryHost || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (canonical && /^https?:\/\//i.test(canonical)) {
      return canonical;
    }

    if (host) {
      return "https://" + host + "/" + rel.replace(/^\//, "");
    }

    if (location.hostname.endsWith("github.io")) {
      var base = siteBasePath();
      return location.origin + base.replace(/\/?$/, "/") + rel.replace(/^\//, "");
    }

    try {
      return new URL(rel, location.href).href;
    } catch (e) {
      return canonical || location.href;
    }
  }

  function setLinkEl(el, url) {
    if (!el) return;
    el.textContent = url;
    el.href = url;
  }

  function renderQrcode(url) {
    if (!qrcodeEl || typeof QRCode !== "function") return;
    qrcodeEl.innerHTML = "";
    qrcodeInstance = null;
    try {
      qrcodeInstance = new QRCode(qrcodeEl, {
        text: url,
        width: 168,
        height: 168,
        colorDark: "#0f2230",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) {
      qrcodeEl.textContent = "二维码生成失败";
    }
  }

  function cardText() {
    var siteName = cfg.siteName || "Industrial AI Paper Hub";
    var lines = ["【" + siteName + "】" + current.title];
    if (current.titleEn) lines.push(current.titleEn);
    if (current.desc) lines.push("", current.desc);
    lines.push("");
    lines.push("中译阅读：" + current.url);
    if (current.originalUrl) {
      lines.push("英文原文：" + current.originalUrl);
    }
    return lines.join("\n");
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        toast(okMsg);
      }).catch(function () {
        fallbackCopy(text, okMsg);
      });
    }
    fallbackCopy(text, okMsg);
    return Promise.resolve();
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(okMsg);
    } catch (e) {
      toast("复制失败，请手动选择链接");
    }
    document.body.removeChild(ta);
  }

  var shareSourceBtn = null;

  function recordShare() {
    if (!shareSourceBtn) return;
    var eng = shareSourceBtn.closest(".paper-engagement[data-paper-folder]");
    var folder = eng && eng.getAttribute("data-paper-folder");
    if (folder && window.IAIPH && window.IAIPH.trackShare) {
      window.IAIPH.trackShare(folder);
    }
  }

  function openModal(btn) {
    shareSourceBtn = btn;
    current.title = btn.getAttribute("data-share-title") || "";
    current.titleEn = btn.getAttribute("data-share-title-en") || "";
    current.desc = btn.getAttribute("data-share-desc") || "";
    current.url = resolveShareUrl(btn);
    current.originalUrl = (btn.getAttribute("data-share-original-url") || "").trim();

    if (titleEl) titleEl.textContent = current.title;
    if (titleEnEl) {
      titleEnEl.textContent = current.titleEn;
      titleEnEl.hidden = !current.titleEn;
    }
    if (descEl) descEl.textContent = current.desc;
    setLinkEl(translationUrlEl, current.url);
    setLinkEl(originalUrlEl, current.originalUrl);
    if (originalRowEl) originalRowEl.hidden = !current.originalUrl;
    renderQrcode(current.url);

    var kickerEl = modal.querySelector(".share-card-kicker");
    if (kickerEl) kickerEl.textContent = cfg.siteName || "Industrial AI Paper Hub";

    modal.hidden = false;
    document.body.classList.add("modal-open");
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".paper-share-btn");
    if (!btn) return;
    e.preventDefault();
    openModal(btn);
  });

  if (backdrop) backdrop.addEventListener("click", closeModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.querySelectorAll("[data-share-close]").forEach(function (el) {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", function () {
      copyText(current.url, "译文链接已复制");
      recordShare();
    });
  }

  if (copyCardBtn) {
    copyCardBtn.addEventListener("click", function () {
      copyText(cardText(), "分享卡片已复制");
      recordShare();
    });
  }
})();
