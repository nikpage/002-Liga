/**
 * Liga Vozíčářů – Embeddable Chat Widget (iframe modal)
 *
 * All chat UI (including TTS, session persistence, suggestions) lives in
 * embed.html on the server. This script only renders a floating launcher
 * button and opens embed.html in a modal iframe when clicked.
 *
 * Any feature added to embed.html is automatically available in the widget
 * with zero extra work.
 *
 * Usage:
 *   <script src="https://YOUR-SERVER/widget/liga-widget.js"
 *           data-server="https://YOUR-SERVER"
 *           data-title="Otázky a Odpovědi"
 *           data-primary-color="#007bff"
 *           data-position="right"
 *           data-open="false">
 *   </script>
 */
(function () {
  "use strict";

  if (window.__ligaWidgetLoaded) return;
  window.__ligaWidgetLoaded = true;

  var scriptTag = document.currentScript;

  function attr(name, fallback) {
    return scriptTag && scriptTag.getAttribute("data-" + name) || fallback;
  }

  var CFG = {
    server:       attr("server", location.origin),
    title:        attr("title", "Otázky a Odpovědi"),
    primaryColor: attr("primary-color", "#007bff"),
    position:     attr("position", "right"),
    startOpen:    attr("open", "false") === "true",
    zIndex:       parseInt(attr("z-index", "9999"), 10),
  };

  var isOpen = false;
  var host, shadow, launcher, overlay, modal, iframe;

  function chatIconSVG() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  }

  function closeIconSVG() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  }

  function getStyles() {
    var pc = CFG.primaryColor;
    var pos = CFG.position === "left" ? "left:20px;right:auto;" : "right:20px;left:auto;";

    return '\
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\
\
.liga-launcher {\
  position: fixed; bottom: 20px; ' + pos + '\
  z-index: ' + CFG.zIndex + ';\
  width: 60px; height: 60px;\
  border-radius: 50%;\
  background: ' + pc + ';\
  color: #fff;\
  border: none;\
  cursor: pointer;\
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);\
  display: flex; align-items: center; justify-content: center;\
  transition: transform 0.2s, box-shadow 0.2s;\
  font-size: 28px; line-height: 1;\
}\
.liga-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }\
\
.liga-overlay {\
  position: fixed; inset: 0;\
  z-index: ' + (CFG.zIndex + 1) + ';\
  background: rgba(0,0,0,0.4);\
  opacity: 0; pointer-events: none;\
  transition: opacity 0.25s;\
}\
.liga-overlay.visible { opacity: 1; pointer-events: auto; }\
\
.liga-modal {\
  position: fixed;\
  z-index: ' + (CFG.zIndex + 2) + ';\
  bottom: 92px; ' + pos + '\
  width: 400px; max-width: calc(100vw - 24px);\
  height: 560px; max-height: calc(100vh - 120px);\
  background: #fff;\
  border-radius: 16px;\
  box-shadow: 0 8px 40px rgba(0,0,0,0.25);\
  overflow: hidden;\
  display: flex; flex-direction: column;\
  opacity: 0; pointer-events: none;\
  transform: translateY(20px) scale(0.95);\
  transition: opacity 0.25s, transform 0.25s;\
}\
.liga-modal.visible { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }\
\
.liga-modal-header {\
  display: flex; align-items: center; gap: 10px;\
  padding: 14px 18px;\
  background: ' + pc + '; color: #fff;\
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;\
  font-weight: 700; font-size: 15px;\
  flex-shrink: 0;\
}\
.liga-modal-header-title { flex: 1; }\
.liga-modal-close {\
  background: none; border: none; color: #fff; font-size: 22px; cursor: pointer;\
  padding: 0; line-height: 1; opacity: 0.85; transition: opacity 0.15s;\
}\
.liga-modal-close:hover { opacity: 1; }\
\
.liga-iframe {\
  flex: 1; width: 100%; border: none;\
}\
\
.liga-powered {\
  text-align: center; padding: 4px; font-size: 10px; color: #999;\
  background: #fff; flex-shrink: 0;\
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;\
}\
\
@media (max-width: 480px) {\
  .liga-modal {\
    width: calc(100vw - 16px);\
    height: calc(100vh - 80px);\
    bottom: 8px;\
    ' + (CFG.position === "left" ? "left:8px;" : "right:8px;") + '\
    border-radius: 12px;\
  }\
  .liga-launcher { bottom: 12px; ' + (CFG.position === "left" ? "left:12px;" : "right:12px;") + ' width: 52px; height: 52px; font-size: 24px; }\
}\
';
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function toggle() {
    isOpen = !isOpen;

    overlay.classList.toggle("visible", isOpen);
    modal.classList.toggle("visible", isOpen);
    launcher.innerHTML = isOpen ? closeIconSVG() : chatIconSVG();

    // Lazy-load iframe on first open
    if (isOpen && !iframe.src) {
      iframe.src = CFG.server + "/widget/embed.html";
    }
  }

  function build() {
    host = document.createElement("div");
    host.id = "liga-widget-host";
    document.body.appendChild(host);

    shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = getStyles();
    shadow.appendChild(style);

    // Launcher button
    launcher = document.createElement("button");
    launcher.className = "liga-launcher";
    launcher.setAttribute("aria-label", "Otevřít chat");
    launcher.innerHTML = chatIconSVG();
    launcher.onclick = toggle;
    shadow.appendChild(launcher);

    // Overlay (click to close)
    overlay = document.createElement("div");
    overlay.className = "liga-overlay";
    overlay.onclick = toggle;
    shadow.appendChild(overlay);

    // Modal
    modal = document.createElement("div");
    modal.className = "liga-modal";

    // Modal header
    var header = document.createElement("div");
    header.className = "liga-modal-header";
    header.innerHTML = '<span class="liga-modal-header-title">' + escapeHtml(CFG.title) + '</span>';
    var closeBtn = document.createElement("button");
    closeBtn.className = "liga-modal-close";
    closeBtn.setAttribute("aria-label", "Zavřít");
    closeBtn.textContent = "×";
    closeBtn.onclick = toggle;
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Iframe
    iframe = document.createElement("iframe");
    iframe.className = "liga-iframe";
    iframe.setAttribute("allow", "autoplay");
    iframe.setAttribute("title", "Liga Chat");
    // src set lazily on first open
    modal.appendChild(iframe);

    // Footer
    var powered = document.createElement("div");
    powered.className = "liga-powered";
    powered.textContent = "Liga Vozíčářů";
    modal.appendChild(powered);

    shadow.appendChild(modal);

    // Auto-open if configured
    if (CFG.startOpen) {
      toggle();
    }
  }

  function boot() {
    build();

    window.LigaWidget = {
      toggle: toggle,
      init: function () {}
    };
  }

  window.LigaWidget = {
    init: function (opts) {
      if (opts) {
        if (opts.server) CFG.server = opts.server;
        if (opts.title) CFG.title = opts.title;
        if (opts.primaryColor) CFG.primaryColor = opts.primaryColor;
        if (opts.position) CFG.position = opts.position;
        if (opts.startOpen !== undefined) CFG.startOpen = opts.startOpen;
        if (opts.zIndex !== undefined) CFG.zIndex = opts.zIndex;
      }
      boot();
    },
    toggle: function () { if (toggle) toggle(); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
