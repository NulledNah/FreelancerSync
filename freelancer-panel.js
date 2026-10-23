/*
 * Freelancer Sync - injected rail button for the OpenCode desktop UI.
 *
 * Loaded by patching resources/app.asar (see apply.js). No dependencies.
 *
 * Behaviour: the button sits in the bottom-left rail, right after the DeepSeek
 * button when present. Clicking it:
 *   - if no token is stored yet, opens a one-time modal to paste a Freelancer
 *     Personal Access Token (validated and stored by the main process),
 *   - then runs a sync, showing the Freelancer icon swapped for spinning arrows
 *     while it works and a toast with the result when it finishes.
 *
 * Style: flat, follows the OpenCode theme (currentColor), Freelancer mark only.
 */
(function () {
  "use strict";

  if (window.__freelancerPanelLoaded) return;
  window.__freelancerPanelLoaded = true;

  // Replaced at patch time by apply.js with the content of the VERSION file.
  var PANEL_VERSION = "__FREELANCER_PANEL_VERSION__";
  var TOKEN_URL = "https://accounts.freelancer.com/settings/develop";

  // Official Freelancer mark (Simple Icons), monochrome so it follows the theme.
  var MARK_PATH = "M14.096 3.076l1.634 2.292L24 3.076M5.503 20.924l4.474-4.374-2.692-2.89m6.133-10.584L11.027 5.23l4.022.15M4.124 3.077l.857 1.76 4.734.294m-3.058 7.072l3.497-6.522L0 5.13m7.064 7.485l3.303 3.548 3.643-3.57 1.13-6.652-4.439-.228Z";

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        var value = props[key];
        if (value == null) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "on" && typeof value === "object") { for (var evt in value) node.addEventListener(evt, value[evt]); }
        else node.setAttribute(key, value);
      }
    }
    if (children) for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function svg(path, cls) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    p.setAttribute("fill", "currentColor");
    s.appendChild(p);
    return s;
  }

  // ---- bridge (added to preload by apply.js) ------------------------------
  function bridge() { return window.api || {}; }
  function apiStatus() { var b = bridge(); return b.freelancerStatus ? b.freelancerStatus() : Promise.resolve({ ok: false, valid: false }); }
  function apiLogin(t) { var b = bridge(); return b.freelancerLogin ? b.freelancerLogin(t) : Promise.resolve({ ok: false, error: "bridge mancante" }); }
  function apiSync() { var b = bridge(); return b.freelancerSync ? b.freelancerSync() : Promise.resolve({ ok: false, error: "bridge mancante" }); }
  function openExternal(url) {
    if (window.api && typeof window.api.openLink === "function") window.api.openLink(url);
    else window.open(url, "_blank");
  }

  // ---- CSS ----------------------------------------------------------------
  var CSS = [
    ".fln-rail-btn{position:relative;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:9px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-weak,#8f8f8f);transition:background .14s ease,color .14s ease}",
    ".fln-rail-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.07));color:var(--text-strong,#e8e8e8)}",
    ".fln-rail-btn:disabled,.fln-slot-btn:disabled,.fln-float-btn:disabled{cursor:default}",
    ".fln-slot-btn{position:relative;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--v2-icon-icon-muted,var(--text-weak,#9a9a9a));flex:none;transition:background .14s ease,color .14s ease}",
    ".fln-slot-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.07));color:var(--text-strong,#e8e8e8)}",
    ".fln-rail-btn .fln-ico,.fln-float-btn .fln-ico{width:18px;height:18px;display:block;flex:none}",
    ".fln-slot-btn .fln-ico{width:16px;height:16px;display:block;flex:none}",
    ".fln-spin{display:none}",
    ".fln-loading{color:var(--text-strong,#e8e8e8)}",
    ".fln-loading .fln-mark{display:none}",
    ".fln-loading .fln-spin{display:block;animation:fln-rotate .8s linear infinite}",
    "@keyframes fln-rotate{to{transform:rotate(360deg)}}",
    ".fln-float-btn{position:fixed;left:10px;bottom:10px;z-index:2147483600;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;border:1px solid var(--border-base,rgba(255,255,255,.14));background:var(--background-strong,#1b1b1b);cursor:pointer;color:var(--text-strong,#e8e8e8);box-shadow:0 1px 2px rgba(0,0,0,.25)}",
    ".fln-plugin-slot{margin-left:auto;margin-right:auto;display:flex;align-items:center;gap:4px;flex:none}",
    ".fln-toast-wrap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483646;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}",
    ".fln-toast{pointer-events:auto;max-width:min(560px,92vw);border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:10px;background:var(--background-strong,#1b1b1b);color:var(--text-strong,#e8e8e8);box-shadow:0 12px 32px -10px rgba(0,0,0,.6);padding:10px 12px;font-family:var(--font-sans,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);font-size:13px;line-height:1.45;display:flex;gap:9px;align-items:flex-start;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}",
    ".fln-toast.fln-show{opacity:1;transform:translateY(0)}",
    ".fln-toast .fln-tdot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none;background:#4fd23f}",
    ".fln-toast.fln-err{border-color:rgba(252,83,58,.5)}",
    ".fln-toast.fln-err .fln-tdot{background:#fc8676}",
    ".fln-toast .fln-tmsg{min-width:0}",
    ".fln-overlay{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}",
    ".fln-overlay.fln-open{display:flex}",
    ".fln-modal{width:min(440px,92vw);border:1px solid var(--border-base,rgba(255,255,255,.16));border-radius:12px;background:var(--background-strong,#1b1b1b);color:var(--text-strong,#e8e8e8);box-shadow:0 16px 40px -16px rgba(0,0,0,.6);padding:16px;font-family:var(--font-sans,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);font-size:13px}",
    ".fln-modal h2{margin:0 0 6px;font-size:15px;font-weight:600}",
    ".fln-modal p{margin:0 0 10px;color:var(--text-weak,#9a9a9a);font-size:12px;line-height:1.5}",
    ".fln-input{width:100%;height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--border-base,rgba(255,255,255,.18));background:var(--surface-base,rgba(255,255,255,.03));color:inherit;font:inherit;box-sizing:border-box}",
    ".fln-input:focus{outline:none;border-color:var(--fln-accent,#21A9FF)}",
    ".fln-error{color:#fc8676;font-size:12px;margin:6px 0 0;min-height:16px}",
    ".fln-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}",
    ".fln-btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--border-base,rgba(255,255,255,.16));background:transparent;color:inherit;cursor:pointer;font:inherit}",
    ".fln-btn:hover{background:var(--surface-base-hover,rgba(255,255,255,.07))}",
    ".fln-btn.fln-primary{border-color:var(--fln-accent,#21A9FF);background:var(--fln-accent,#21A9FF);color:#fff;font-weight:600}",
    ".fln-btn.fln-primary:hover{background:#1899ec;border-color:#1899ec}",
    ".fln-btn:disabled{opacity:.6;cursor:default}",
    ".fln-link{color:var(--fln-accent,#21A9FF);cursor:pointer;text-decoration:none}",
    ".fln-link:hover{text-decoration:underline}"
  ].join("");

  function injectStyles() {
    if (document.getElementById("freelancer-panel-style")) return;
    var style = document.createElement("style");
    style.id = "freelancer-panel-style";
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- DOM ----------------------------------------------------------------
  var btn = el("button", { class: "fln-rail-btn", type: "button", title: "Freelancer - sincronizza cartelle", "aria-label": "Freelancer sync", "data-freelancer-panel": "1" });
  btn.appendChild(svg(MARK_PATH, "fln-ico fln-mark"));
  btn.appendChild(svg("M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z", "fln-ico fln-spin"));

  var toastWrap = el("div", { class: "fln-toast-wrap" });

  var input = el("input", { class: "fln-input", type: "password", placeholder: "Personal Access Token", autocomplete: "off", spellcheck: "false" });
  var errorEl = el("p", { class: "fln-error" });
  var connectBtn = el("button", { class: "fln-btn fln-primary", type: "button", text: "Connetti" });
  var cancelBtn = el("button", { class: "fln-btn", type: "button", text: "Annulla" });
  var linkEl = el("a", { class: "fln-link", href: "#", text: "Crea un token su accounts.freelancer.com" });
  var overlay = el("div", { class: "fln-overlay" }, [
    el("div", { class: "fln-modal" }, [
      el("h2", { text: "Token Freelancer" }),
      el("p", { text: "Incolla una volta il tuo Personal Access Token: viene salvato in locale e non ti verra' piu' chiesto." }),
      input,
      el("p", {}, [linkEl]),
      errorEl,
      el("div", { class: "fln-actions" }, [cancelBtn, connectBtn])
    ])
  ]);

  function toast(message, isError) {
    var node = el("div", { class: "fln-toast" + (isError ? " fln-err" : "") }, [
      el("span", { class: "fln-tdot" }),
      el("span", { class: "fln-tmsg", text: message })
    ]);
    toastWrap.appendChild(node);
    requestAnimationFrame(function () { node.classList.add("fln-show"); });
    setTimeout(function () {
      node.classList.remove("fln-show");
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }, 4500);
  }

  function openModal() { errorEl.textContent = ""; input.value = ""; overlay.classList.add("fln-open"); setTimeout(function () { input.focus(); }, 30); }
  function closeModal() { overlay.classList.remove("fln-open"); }

  function summarize(s) {
    return "Freelancer: " + s.pending + " pending, " + s.awarded + " awarded - " +
      s.moved + " spostate, " + s.created + " create, " + s.deleted + " cancellate.";
  }

  function runSync() {
    if (btn.classList.contains("fln-loading")) return;
    btn.disabled = true;
    btn.classList.add("fln-loading");
    apiSync().then(function (res) {
      if (res && res.ok) toast(summarize(res.summary), false);
      else if (res && res.error === "not_authenticated") openModal();
      else toast("Sync fallito: " + ((res && res.error) || "errore"), true);
    }).catch(function (e) {
      toast("Sync fallito: " + e, true);
    }).then(function () {
      btn.disabled = false;
      btn.classList.remove("fln-loading");
    });
  }

  function onConnect() {
    var value = input.value.trim();
    if (value.length < 8) { errorEl.textContent = "Incolla il token."; return; }
    connectBtn.disabled = true;
    errorEl.textContent = "Verifica...";
    apiLogin(value).then(function (res) {
      if (res && res.ok) { closeModal(); runSync(); }
      else errorEl.textContent = "Token non valido: " + ((res && res.error) || "errore");
    }).catch(function (e) {
      errorEl.textContent = "Errore: " + e;
    }).then(function () { connectBtn.disabled = false; });
  }

  function onClick() {
    if (btn.classList.contains("fln-loading")) return;
    apiStatus().then(function (st) {
      if (st && st.valid) runSync();
      else openModal();
    });
  }

  // ---- launcher mount -----------------------------------------------------
  function findRail() {
    var divs = document.querySelectorAll("div");
    var classed = null, classedH = 0, any = null, anyH = 0;
    for (var i = 0; i < divs.length; i++) {
      var r = divs[i].getBoundingClientRect();
      if (!(r.left < 10 && r.width >= 44 && r.width <= 96 && r.height > 220 && r.top < 140)) continue;
      if (r.height > anyH) { anyH = r.height; any = divs[i]; }
      var cls = "" + (divs[i].className || "");
      if (cls.indexOf("bg-background-base") >= 0 && r.height > classedH) { classedH = r.height; classed = divs[i]; }
    }
    return classed || any;
  }
  function bottomCluster(rail) {
    var marked = rail.querySelector('[class*="pb-6"]');
    if (marked) return marked;
    var kids = rail.children, fallback = null;
    for (var i = kids.length - 1; i >= 0; i--) {
      var k = kids[i];
      if (k === btn || k.tagName !== "DIV") continue;
      if (!fallback) fallback = k;
      if (k.querySelector("button") && k.getBoundingClientRect().height < 220) return k;
    }
    for (var j = kids.length - 1; j >= 0; j--) {
      if (kids[j] !== btn && kids[j].tagName === "DIV" && kids[j].querySelector("button")) return kids[j];
    }
    return fallback;
  }
  // Composer slot: the new prompt bar has a controls row; plugin buttons are
  // appended after the model/effort controls. The periodic re-mount puts the
  // button back if a re-render drops it.
  function composerRow() {
    var forms = document.querySelectorAll("form");
    for (var i = forms.length - 1; i >= 0; i--) {
      if (String(forms[i].className).indexOf("prompt-input") < 0) continue;
      var rows = forms[i].querySelectorAll("div.flex.h-11");
      for (var j = rows.length - 1; j >= 0; j--) {
        if (rows[j].querySelector("button")) return rows[j];
      }
    }
    return null;
  }
  function pluginSlot(group) {
    // Prefer the slot created by the DeepSeek addon so both buttons sit in the
    // same centered group, Freelancer right after DeepSeek.
    var slot = document.getElementById("dsp-plugin-slot") || document.getElementById("fln-plugin-slot");
    if (!slot) slot = el("div", { id: "fln-plugin-slot", class: "fln-plugin-slot" });
    if (slot.parentNode !== group) group.appendChild(slot);
    // Drop our now-empty own slot if the shared one showed up later.
    var own = document.getElementById("fln-plugin-slot");
    if (own && own !== slot && !own.firstChild && own.parentNode) own.parentNode.removeChild(own);
    return slot;
  }
  function mountComposer() {
    var row = composerRow();
    if (!row) return false;
    // Plugin buttons go after the model/effort controls, centered in the free
    // space before the send button (the green slot).
    var group = null, kids = row.children;
    for (var i = 0; i < kids.length; i++) {
      if (/flex-1/.test(kids[i].className) && kids[i].querySelector("button")) { group = kids[i]; break; }
    }
    if (!group) group = row;
    btn.classList.remove("fln-rail-btn", "fln-float-btn");
    btn.classList.add("fln-slot-btn");
    var slot = pluginSlot(group);
    var dsp = slot.querySelector('[data-deepseek-panel].dsp-slot-btn');
    if (dsp && dsp.parentNode === slot) {
      if (btn.previousElementSibling !== dsp) slot.insertBefore(btn, dsp.nextSibling);
    } else if (btn.parentNode !== slot) {
      slot.appendChild(btn);
    }
    return true;
  }
  function inRail() {
    var p = btn.parentNode;
    if (!p || p === document.body) return false;
    var r = p.getBoundingClientRect();
    return r.left < 12 && r.width <= 92 && r.height > 200;
  }
  function mountLauncher() {
    if (mountComposer()) return true;
    btn.classList.remove("fln-slot-btn");
    if (inRail()) { btn.classList.remove("fln-float-btn"); btn.classList.add("fln-rail-btn"); return true; }
    var rail = findRail();
    if (rail) {
      btn.classList.remove("fln-float-btn");
      btn.classList.add("fln-rail-btn");
      var cluster = bottomCluster(rail);
      if (cluster) {
        // Sit right after the DeepSeek button when present, else first.
        var dsp = cluster.querySelector('[data-deepseek-panel].dsp-rail-btn');
        if (dsp && dsp.parentNode === cluster) {
          if (btn.previousElementSibling !== dsp) cluster.insertBefore(btn, dsp.nextSibling);
        } else if (btn.parentNode !== cluster || cluster.firstChild !== btn) {
          cluster.insertBefore(btn, cluster.firstChild);
        }
      } else if (btn.parentNode !== rail || rail.lastElementChild !== btn) {
        rail.appendChild(btn);
      }
      return true;
    }
    btn.classList.remove("fln-rail-btn");
    if (btn.parentNode !== document.body) { btn.classList.add("fln-float-btn"); document.body.appendChild(btn); }
    return false;
  }

  function boot() {
    if (document.getElementById("freelancer-panel-style")) return;
    injectStyles();
    document.body.appendChild(toastWrap);
    document.body.appendChild(overlay);
    btn.addEventListener("click", onClick);
    connectBtn.addEventListener("click", onConnect);
    cancelBtn.addEventListener("click", closeModal);
    input.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") onConnect(); if (e.key === "Escape") closeModal(); });
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) closeModal(); });
    linkEl.addEventListener("click", function (e) { e.preventDefault(); openExternal(TOKEN_URL); });
    mountLauncher();
    setInterval(mountLauncher, 1500);
  }

  window.__freelancerPanel = { sync: runSync, version: PANEL_VERSION };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
