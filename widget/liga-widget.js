/**
 * Liga Vozíčářů – Embeddable Q&A Chat Widget
 *
 * Usage:
 *   <script src="https://YOUR-SERVER/widget/liga-widget.js"
 *           data-server="https://YOUR-SERVER"
 *           data-title="Otázky a Odpovědi"
 *           data-primary-color="#007bff"
 *           data-position="right"
 *           data-open="false">
 *   </script>
 *
 * Or programmatically:
 *   LigaWidget.init({ server: "https://YOUR-SERVER" });
 */
(function () {
  "use strict";

  /* ── Prevent double-load ── */
  if (window.__ligaWidgetLoaded) return;
  window.__ligaWidgetLoaded = true;

  /* ── Read config from script tag data-* attributes ── */
  const scriptTag = document.currentScript;
  const CFG = {
    server: attr("server", ""),
    title: attr("title", "Otázky a Odpovědi 🧠"),
    placeholder: attr("placeholder", "Zadejte dotaz..."),
    primaryColor: attr("primary-color", "#007bff"),
    position: attr("position", "right"),  // "left" or "right"
    startOpen: attr("open", "false") === "true",
    zIndex: parseInt(attr("z-index", "9999"), 10),
  };

  function attr(name, fallback) {
    return scriptTag && scriptTag.getAttribute("data-" + name) || fallback;
  }

  /* ── Marked.js (minimal inline copy – v14 subset) ── */
  // We load marked from CDN rather than bundling to keep the widget lean.
  let markedReady = false;
  let markedQueue = [];

  function ensureMarked(cb) {
    if (markedReady) return cb();
    markedQueue.push(cb);
    if (document.getElementById("liga-widget-marked")) return; // already loading
    const s = document.createElement("script");
    s.id = "liga-widget-marked";
    s.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    s.onload = function () {
      markedReady = true;
      if (typeof marked !== "undefined" && marked.setOptions) {
        marked.setOptions({ breaks: true });
      }
      markedQueue.forEach(function (fn) { fn(); });
      markedQueue = [];
    };
    document.head.appendChild(s);
  }

  function renderMarkdown(text) {
    if (typeof marked !== "undefined" && marked.parse) return marked.parse(text);
    // Minimal fallback if marked hasn't loaded
    return text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  /* ── Styles (isolated inside shadow DOM) ── */
  function getStyles() {
    var pc = CFG.primaryColor;
    var pos = CFG.position === "left" ? "left:20px;right:auto;" : "right:20px;left:auto;";
    var panelPos = CFG.position === "left" ? "left:20px;right:auto;" : "right:20px;left:auto;";

    return `
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Launcher Button ── */
.liga-launcher {
  position: fixed; bottom: 20px; ${pos}
  z-index: ${CFG.zIndex};
  width: 60px; height: 60px;
  border-radius: 50%;
  background: ${pc};
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
  font-size: 28px; line-height: 1;
}
.liga-launcher:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }
.liga-launcher.open { transform: rotate(45deg); }

/* ── Panel ── */
.liga-panel {
  position: fixed; bottom: 92px; ${panelPos}
  z-index: ${CFG.zIndex};
  width: 400px; max-width: calc(100vw - 24px);
  height: 560px; max-height: calc(100vh - 120px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.2);
  display: flex; flex-direction: column;
  overflow: hidden;
  opacity: 0; pointer-events: none;
  transform: translateY(20px) scale(0.95);
  transition: opacity 0.25s, transform 0.25s;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 14px; color: #1a1a1a; line-height: 1.5;
}
.liga-panel.visible { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }

/* ── Header ── */
.liga-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  background: ${pc}; color: #fff;
  font-weight: 700; font-size: 15px;
  flex-shrink: 0;
}
.liga-header-title { flex:1; }
.liga-close-btn {
  background: none; border: none; color: #fff; font-size: 22px; cursor: pointer;
  padding: 0; line-height: 1; opacity: 0.85; transition: opacity 0.15s;
}
.liga-close-btn:hover { opacity: 1; }

/* ── Messages Area ── */
.liga-messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-behavior: smooth;
  background: #f7f8fa;
}

.liga-msg {
  max-width: 88%; padding: 12px 14px; border-radius: 14px;
  line-height: 1.6; word-wrap: break-word; position: relative;
}
.liga-msg-user {
  align-self: flex-end; background: ${pc}; color: #fff;
  border-bottom-right-radius: 4px;
}
.liga-msg-bot {
  align-self: flex-start; background: #e9ebee; color: #1a1a1a;
  border-bottom-left-radius: 4px;
  padding-bottom: 52px;
}

/* ── Bot message typography ── */
.liga-msg-bot h1 { font-size: 1.1rem; margin: 0.8rem 0 0.4rem; color: ${pc}; border-bottom: 1px solid #d8d8d8; padding-bottom: 3px; }
.liga-msg-bot h2 { font-size: 1rem; margin: 0.7rem 0 0.3rem; }
.liga-msg-bot h3 { font-size: 0.95rem; margin: 0.6rem 0 0.3rem; }
.liga-msg-bot ul, .liga-msg-bot ol { padding-left: 1.15rem; margin-bottom: 0.5rem; }
.liga-msg-bot li { margin-bottom: 0.5rem; }
.liga-msg-bot p { margin-bottom: 0.9rem; }
.liga-msg-bot a { color: ${pc}; text-decoration: underline; }
.liga-msg-bot hr { border: none; border-top: 1px solid #ccc; margin: 0.8rem 0; }

/* ── Message Toolbar ── */
.liga-toolbar {
  display: flex; gap: 8px; justify-content: center;
  padding-top: 8px; margin-top: 10px;
  border-top: 1px solid #ccc;
  position: absolute; bottom: 8px; left: 12px; right: 12px;
}
.liga-tool-btn {
  background: #fff; border: 1px solid #adb5bd; color: #495057;
  cursor: pointer; padding: 4px 10px; border-radius: 16px;
  font-size: 11px; font-weight: 600;
  display: flex; align-items: center; gap: 4px;
  transition: background 0.15s;
}
.liga-tool-btn:hover { background: #f0f0f0; }

/* ── Suggestions ── */
.liga-suggestions {
  display: flex; flex-wrap: wrap; gap: 6px;
  justify-content: center; padding: 2px 0;
}
.liga-sug-btn {
  background: #fff; border: 1px solid ${pc}; color: ${pc};
  padding: 6px 10px; border-radius: 16px;
  font-size: 12px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.liga-sug-btn:hover { background: ${pc}; color: #fff; }

/* ── Progress ── */
.liga-progress {
  text-align: center; padding: 10px;
  font-weight: 600; color: #555;
  display: none; flex-shrink: 0;
  background: #fff;
}
.liga-progress.active { display: block; }

/* ── Typing dots ── */
.liga-typing { display: inline-flex; gap: 4px; align-items: center; padding: 2px 0; }
.liga-typing span { width: 6px; height: 6px; border-radius: 50%; background: #888; animation: ligaDot 1.2s infinite ease-in-out; }
.liga-typing span:nth-child(2) { animation-delay: 0.2s; }
.liga-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes ligaDot { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1.1)} }

/* ── Input Area ── */
.liga-input-area {
  display: flex; gap: 8px; padding: 12px; flex-shrink: 0;
  border-top: 1px solid #e0e0e0; background: #fff;
}
.liga-input {
  flex: 1; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #ccc; font-size: 14px; outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.liga-input:focus { border-color: ${pc}; }
.liga-send-btn {
  padding: 10px 18px; border: none; border-radius: 8px;
  background: #28a745; color: #fff; cursor: pointer;
  font-size: 14px; font-weight: 700; white-space: nowrap;
  transition: background 0.15s;
}
.liga-send-btn:hover { background: #218838; }
.liga-send-btn:disabled { background: #6c757d; cursor: not-allowed; }

/* ── Powered-by ── */
.liga-powered {
  text-align: center; padding: 4px; font-size: 10px; color: #999;
  background: #fff; flex-shrink: 0;
}
.liga-powered a { color: #999; text-decoration: none; }

/* ── Mobile ── */
@media (max-width: 480px) {
  .liga-panel {
    width: calc(100vw - 16px);
    height: calc(100vh - 80px);
    bottom: 8px;
    ${CFG.position === "left" ? "left:8px;" : "right:8px;"}
    border-radius: 12px;
  }
  .liga-launcher { bottom: 12px; ${CFG.position === "left" ? "left:12px;" : "right:12px;"} width: 52px; height: 52px; font-size: 24px; }
}
`;
  }

  /* ── Build DOM inside Shadow Root ── */
  function buildWidget() {
    var host = document.createElement("div");
    host.id = "liga-widget-host";
    document.body.appendChild(host);

    var shadow = host.attachShadow({ mode: "open" });

    // Stylesheet
    var style = document.createElement("style");
    style.textContent = getStyles();
    shadow.appendChild(style);

    // Launcher
    var launcher = document.createElement("button");
    launcher.className = "liga-launcher";
    launcher.setAttribute("aria-label", "Otevřít chat");
    launcher.innerHTML = chatIconSVG();
    shadow.appendChild(launcher);

    // Panel
    var panel = document.createElement("div");
    panel.className = "liga-panel";
    panel.innerHTML = `
      <div class="liga-header">
        <span class="liga-header-title">${escapeHtml(CFG.title)}</span>
        <button class="liga-close-btn" aria-label="Zavřít">×</button>
      </div>
      <div class="liga-messages"></div>
      <div class="liga-progress">
        <div class="liga-typing"><span></span><span></span><span></span></div>
        Pracuji...
      </div>
      <div class="liga-input-area">
        <input class="liga-input" type="text" placeholder="${escapeHtml(CFG.placeholder)}">
        <button class="liga-send-btn">Odeslat</button>
      </div>
      <div class="liga-powered">Liga Vozíčářů</div>
    `;
    shadow.appendChild(panel);

    return {
      shadow: shadow,
      launcher: launcher,
      panel: panel,
      messages: panel.querySelector(".liga-messages"),
      progress: panel.querySelector(".liga-progress"),
      input: panel.querySelector(".liga-input"),
      sendBtn: panel.querySelector(".liga-send-btn"),
      closeBtn: panel.querySelector(".liga-close-btn"),
    };
  }

  function chatIconSVG() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  }

  function closeIconSVG() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  /* ── Widget Controller ── */
  function createController(dom) {
    var chatHistory = [];
    var isOpen = CFG.startOpen;

    /* Toggle open/close */
    function toggle() {
      isOpen = !isOpen;
      dom.panel.classList.toggle("visible", isOpen);
      dom.launcher.innerHTML = isOpen ? closeIconSVG() : chatIconSVG();
      dom.launcher.classList.toggle("open", isOpen);
      if (isOpen) dom.input.focus();
    }

    dom.launcher.onclick = toggle;
    dom.closeBtn.onclick = toggle;

    /* Keyboard: Enter to send */
    dom.input.onkeydown = function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askQuestion(); }
    };
    dom.sendBtn.onclick = function () { askQuestion(); };

    /* Download helpers */
    function downloadFile(filename, text) {
      var a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function downloadHistory() {
      if (chatHistory.length === 0) return;
      var text = chatHistory.map(function (m) {
        return "[" + m.role.toUpperCase() + "]\n" + m.content + "\n-------------------";
      }).join("\n\n");
      downloadFile("chat_historie.txt", text);
    }

    /* Normalize answer markdown */
    function normalizeAnswer(md) {
      if (!md) return md;
      md = md.replace(/^[•*-]\s*(https?:\/\/\S+)/gm, function (match, url) {
        var filename = url.split("/").pop();
        var title = filename
          .replace(/\.(pdf|docx?|xlsx?|txt)$/i, "")
          .replace(/[_-]+/g, " ")
          .replace(/^(\w)/, function (m) { return m.toUpperCase(); })
          .trim();
        return "- [" + title + "](" + url + ")";
      });
      return md.trim();
    }

    /* Add message to UI */
    function addMessage(role, content, sources) {
      var div = document.createElement("div");
      div.className = "liga-msg " + (role === "user" ? "liga-msg-user" : "liga-msg-bot");

      if (role === "assistant") {
        content = normalizeAnswer(content);
      }

      div.innerHTML = renderMarkdown(content);

      if (role === "assistant") {
        var toolbar = document.createElement("div");
        toolbar.className = "liga-toolbar";

        var dlReply = document.createElement("button");
        dlReply.className = "liga-tool-btn";
        dlReply.textContent = "💾 Odpověď";
        dlReply.onclick = function () { downloadFile("odpoved.txt", content); };

        var dlChat = document.createElement("button");
        dlChat.className = "liga-tool-btn";
        dlChat.textContent = "📂 Celý chat";
        dlChat.onclick = function () { downloadHistory(); };

        toolbar.appendChild(dlReply);
        toolbar.appendChild(dlChat);
        div.appendChild(toolbar);
      }

      dom.messages.appendChild(div);
      if (role === "user") {
        div.scrollIntoView({ behavior: "smooth", block: "end" });
      }
      return div;
    }

    /* Add suggestion buttons */
    function addSuggestions(suggestions) {
      if (!suggestions || suggestions.length === 0) return;
      var container = document.createElement("div");
      container.className = "liga-suggestions";
      suggestions.forEach(function (text) {
        var btn = document.createElement("button");
        btn.className = "liga-sug-btn";
        btn.textContent = text;
        btn.onclick = function () { askQuestion(text); };
        container.appendChild(btn);
      });
      dom.messages.appendChild(container);
    }

    /* Main ask function */
    function askQuestion(suggestionText) {
      var query = suggestionText || dom.input.value.trim();
      if (!query) return;

      addMessage("user", query);
      dom.input.value = "";
      dom.sendBtn.disabled = true;
      chatHistory.push({ role: "user", content: query });

      // Hide old suggestions
      var oldSugs = dom.messages.querySelectorAll(".liga-suggestions");
      oldSugs.forEach(function (el) { el.style.display = "none"; });

      dom.progress.classList.add("active");

      var apiUrl = CFG.server + "/search";

      fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "Odpovídej pouze v češtině. Dotaz: " + query,
          history: chatHistory
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          dom.progress.classList.remove("active");
          var sources = (data.metadata && data.metadata.sources) ? data.metadata.sources : [];
          var el = addMessage("assistant", data.answer, sources);
          chatHistory.push({ role: "assistant", content: data.answer });
          if (data.suggestions) addSuggestions(data.suggestions);
          setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 100);
        })
        .catch(function () {
          dom.progress.classList.remove("active");
          addMessage("assistant", "CHYBA SYSTÉMU: Zkontrolujte připojení.");
        })
        .finally(function () {
          dom.sendBtn.disabled = false;
        });
    }

    /* Initial state */
    if (isOpen) {
      dom.panel.classList.add("visible");
      dom.launcher.innerHTML = closeIconSVG();
      dom.launcher.classList.add("open");
    }

    return { toggle: toggle, ask: askQuestion };
  }

  /* ── Boot ── */
  function boot() {
    ensureMarked(function () {
      var dom = buildWidget();
      var ctrl = createController(dom);
      window.LigaWidget = {
        toggle: ctrl.toggle,
        ask: ctrl.ask,
        init: function () {} // already initialized
      };
    });
  }

  /* Expose init for programmatic usage */
  window.LigaWidget = {
    init: function (opts) {
      if (opts) {
        if (opts.server) CFG.server = opts.server;
        if (opts.title) CFG.title = opts.title;
        if (opts.placeholder) CFG.placeholder = opts.placeholder;
        if (opts.primaryColor) CFG.primaryColor = opts.primaryColor;
        if (opts.position) CFG.position = opts.position;
        if (opts.startOpen !== undefined) CFG.startOpen = opts.startOpen;
        if (opts.zIndex !== undefined) CFG.zIndex = opts.zIndex;
      }
      boot();
    }
  };

  /* Auto-init when DOM ready */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
