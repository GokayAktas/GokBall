/**
 * In-game Chat component
 */
export class Chat {
    constructor(app) {
        this.app = app;
        this.visible = true;
        this.container = document.getElementById('chatContainer');
    }

    show() {
        if (!this.container) this.container = document.getElementById('chatContainer');
        if (!this.container) return;

        this.container.innerHTML = `
      <div class="chat-box" id="gameChatBox">
        <div class="chat-resizer" id="gameChatResizer" title="Boyutu Ayarla"></div>
        <div class="chat-messages" id="gameChatMessages"></div>
        <div class="chat-input-row">
          <input type="text" class="chat-input" id="gameChatInput" placeholder="Mesaj yaz... (Tab)" maxlength="200" autocomplete="off" />
          <button class="chat-send" id="gameChatSend">
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3 20V4l19 8L3 20zm2-3l11.85-5L5 7v3.5l6 1.5-6 1.5V17z"/></svg>
          </button>
          <button class="chat-toggle-btn-small" id="gameChatHideBtn" title="Sohbeti Gizle/Göster">
            <svg id="eyeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      </div>
    `;

        this.container.classList.remove('hidden');

        document.getElementById('gameChatSend')?.addEventListener('click', () => this._send());
        const chatInput = document.getElementById('gameChatInput');
        chatInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._send();
            e.stopPropagation();
        });

        chatInput?.addEventListener('focus', () => {
            this.app.network.socket?.emit('setTyping', true);
        });

        chatInput?.addEventListener('blur', () => {
            this.app.network.socket?.emit('setTyping', false);
        });

        document.getElementById('gameChatHideBtn')?.addEventListener('click', () => {
            this._toggleCollapse();
        });

        // Custom Resize Logic
        const resizer = document.getElementById('gameChatResizer');
        const box = document.getElementById('gameChatBox');
        let isResizing = false;
        let startY, startHeight;

        const onMouseMove = (e) => {
            if (!isResizing) return;
            const dy = startY - e.clientY; // moving up increases height
            let h = startHeight + dy;
            if (h < 100) h = 100;
            if (h > window.innerHeight * 0.8) h = window.innerHeight * 0.8;
            box.style.height = h + 'px';
        };

        const onMouseUp = () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            }
        };

        resizer?.addEventListener('mousedown', (e) => {
            if (this.collapsed) return; // don't resize if collapsed
            isResizing = true;
            startY = e.clientY;
            startHeight = box.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        // Tab to focus chat
        window.addEventListener('keydown', this._tabHandler = (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const input = document.getElementById('gameChatInput');
                if (input) {
                    if (document.activeElement === input) {
                        input.blur();
                    } else {
                        if (this.collapsed) this._toggleCollapse();
                        input.focus();
                    }
                }
            }
        });
    }

    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
            this.container.innerHTML = '';
        }
        if (this._tabHandler) {
            window.removeEventListener('keydown', this._tabHandler);
        }
    }

    _toggleCollapse() {
        const box = document.getElementById('gameChatBox');
        if (!box) return;
        this.collapsed = !this.collapsed;

        if (this.collapsed) {
            box.classList.add('collapsed');
            document.getElementById('eyeIcon').innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
        } else {
            box.classList.remove('collapsed');
            document.getElementById('eyeIcon').innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
        }
    }

    addMessage(data) {
        const msgs = document.getElementById('gameChatMessages');
        if (!msgs) return;

        const div = document.createElement('div');
        div.className = 'chat-message' + (data.system ? ' chat-message-system' : '');

        if (data.system) {
            div.textContent = data.message;
        } else {
            const color = data.team === 'red' ? '#c70000' : data.team === 'blue' ? '#00008c' : '#A6C5D7';
            div.innerHTML = `<span class="chat-message-author" style="color:${color}">${this._esc(data.playerName)}</span>: ${this._esc(data.message)}`;
        }

        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;

        // Limit messages
        while (msgs.children.length > 100) {
            msgs.removeChild(msgs.firstChild);
        }
    }

    _send() {
        const input = document.getElementById('gameChatInput');
        if (!input) return;

        const msg = input.value.trim();
        if (msg) {
            this.app.network.sendChat(msg);
            input.value = '';
        } else {
            input.value = '';
            input.blur();
        }
    }

    _esc(t) {
        const d = document.createElement('div');
        d.textContent = t || '';
        return d.innerHTML;
    }
}
