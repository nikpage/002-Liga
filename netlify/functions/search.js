<!DOCTYPE html>
<html>
<head>
    <title>Aplikace Otázky a Odpovědi</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background-color: #f0f2f5; }
        #chat-container { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); min-height: 400px; display: flex; flex-direction: column; }
        #messages { flex-grow: 1; overflow-y: auto; margin-bottom: 20px; max-height: 500px; display: flex; flex-direction: column; scroll-behavior: smooth; }
        .message { margin-bottom: 20px; padding: 15px; border-radius: 15px; max-width: 85%; line-height: 1.6; position: relative; }
        .user-msg { background-color: #007bff; color: white; align-self: flex-end; margin-left: auto; }
        .bot-msg { background-color: #e4e6eb; color: black; align-self: flex-start; padding-bottom: 60px; }
        .msg-toolbar { display: flex; gap: 8px; justify-content: center; margin-top: 15px; padding-top: 10px; border-top: 1px solid #ccc; position: absolute; bottom: 10px; left: 15px; right: 15px; }
        .tool-btn { background: white; border: 1px solid #adb5bd; color: #495057; cursor: pointer; padding: 5px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; }
        .controls-area { display: flex; gap: 10px; align-items: center; }
        input[type="text"] { flex-grow: 1; padding: 10px; border-radius: 5px; border: 1px solid #ccc; font-size: 16px; }
        #sendBtn { padding: 10px 15px; border: none; border-radius: 5px; background-color: #28a745; color: white; cursor: pointer; font-size: 16px; }
        #progress-indicator { margin-top: 10px; text-align: center; display: none; font-weight: bold; padding: 10px; background-color: white; border: 1px solid #ccc; border-radius: 5px; }
    </style>
</head>
<body>
    <div id="chat-container">
        <h2>Aplikace Otázky a Odpovědi 🧠</h2>
        <div id="messages"></div>
        <div class="controls-area">
            <select id="modelSelect">
                <option value="gemini-2.5-flash" selected>⚡ Gemini 2.5 Flash</option>
                <option value="gemini-3-pro-preview">🧠 Gemini 3 Pro</option>
            </select>
            <input type="text" id="question" placeholder="Zadejte dotaz..." onkeydown="if(event.key === 'Enter') ask()">
            <button id="sendBtn" onclick="ask()">Odeslat</button>
        </div>
        <div id="progress-indicator">Zpracovávám...</div>
    </div>
    <script>
        let chatHistory = [];
        const progressIndicator = document.getElementById('progress-indicator');

        function downloadFile(filename, text) {
            const element = document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
            element.setAttribute('download', filename);
            element.click();
        }

        function downloadHistory() {
            const text = chatHistory.map(msg => `[${msg.role.toUpperCase()}]\n${msg.content}\n-------------------`).join('\n\n');
            downloadFile('chat_historie.txt', text);
        }

        function addMessage(role, content) {
            const msgs = document.getElementById('messages');
            const newMsg = document.createElement('div');
            newMsg.className = `message ${role === 'user' ? 'user-msg' : 'bot-msg'}`;
            const contentDiv = document.createElement('div');
            if (content.trim().startsWith('<div')) {
                contentDiv.innerHTML = content;
                const scripts = contentDiv.querySelectorAll('script');
                scripts.forEach(oldScript => {
                    const newScript = document.createElement('script');
                    newScript.textContent = oldScript.textContent;
                    document.body.appendChild(newScript);
                });
            } else {
                contentDiv.innerHTML = marked.parse(content || "");
            }
            newMsg.appendChild(contentDiv);
            if (role === 'assistant') {
                const toolbar = document.createElement('div');
                toolbar.className = 'msg-toolbar';
                toolbar.appendChild(createBtn('💾 Odpověď', () => downloadFile('odpoved.txt', content)));
                toolbar.appendChild(createBtn('📂 Celý chat', () => downloadHistory()));
                if (content.match(/Kč|limit|výpočet|příspěvek/i)) toolbar.appendChild(createBtn('🧮 Kalkulačka', () => askTool("calc", content)));
                if (content.match(/poradna|e-mail|kontaktovat/i)) toolbar.appendChild(createBtn('✉️ E-mail', () => askTool("email", content)));
                if (content.length > 250) toolbar.appendChild(createBtn('🪜 Postup', () => askTool("step", content)));
                newMsg.appendChild(toolbar);
            }
            msgs.appendChild(newMsg);
            if (role === 'user') newMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });
            return newMsg;
        }

        function createBtn(text, fn) {
            const btn = document.createElement('button');
            btn.className = 'tool-btn';
            btn.innerHTML = text;
            btn.onclick = fn;
            return btn;
        }

        async function askTool(type, context) {
            progressIndicator.style.display = 'block';
            try {
                const res = await fetch('/.netlify/functions/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: context, history: chatHistory, type: type })
                });
                const data = await res.json();
                progressIndicator.style.display = 'none';
                if (type === 'email') {
                    window.location.href = `mailto:poradna@ligavozickaru.cz?subject=Dotaz&body=${encodeURIComponent(data.answer)}`;
                } else {
                    const el = addMessage('assistant', data.answer);
                    chatHistory.push({ role: "assistant", content: data.answer });
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } catch (error) {
                progressIndicator.style.display = 'none';
            }
        }

        async function ask(suggestionText = null) {
            const input = document.getElementById('question');
            const question = suggestionText || input.value.trim();
            if (!question) return;
            addMessage('user', question);
            input.value = '';
            chatHistory.push({ role: "user", content: question });
            progressIndicator.style.display = 'block';
            try {
                const res = await fetch('/.netlify/functions/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question: question, history: chatHistory, model: document.getElementById('modelSelect').value })
                });
                const data = await res.json();
                progressIndicator.style.display = 'none';
                addMessage('assistant', data.answer);
                chatHistory.push({ role: "assistant", content: data.answer });
            } catch (error) {
                progressIndicator.style.display = 'none';
            }
        }
    </script>
</body>
</html>
