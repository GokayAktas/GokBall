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
        this.collapsed = false;
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

        const box = document.getElementById('gameChatBox');
        const minHeight = 144;
        const maxHeight = Math.max(minHeight, window.innerHeight - 20);
        const savedHeight = Number(localStorage.getItem('gokball_chat_height'));
        if (box && Number.isFinite(savedHeight) && savedHeight > 0) {
            box.style.height = `${Math.min(maxHeight, Math.max(minHeight, savedHeight))}px`;
        }

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

        // Resize vertically from the top grip. Pointer events also support
        // touch screens; the chat width remains fixed.
        const resizer = document.getElementById('gameChatResizer');
        let isResizing = false;
        let startY, startHeight;

        const onPointerMove = (e) => {
            if (!isResizing) return;
            const height = Math.min(maxHeight, Math.max(minHeight, startHeight + startY - e.clientY));
            box.style.height = `${height}px`;
        };

        const onPointerUp = () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                box.classList.remove('is-resizing');
                localStorage.setItem('gokball_chat_height', String(box.offsetHeight));
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
            }
        };

        resizer?.addEventListener('pointerdown', (e) => {
            if (this.collapsed) return; // don't resize if collapsed
            isResizing = true;
            startY = e.clientY;
            startHeight = box.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            box.classList.add('is-resizing');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
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
            const red = getComputedStyle(document.documentElement).getPropertyValue('--red-team') || '#c70000';
            const blue = getComputedStyle(document.documentElement).getPropertyValue('--blue-team') || '#00008c';
            const neutral = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#A6C5D7';
            const color = data.team === 'red' ? red.trim() : data.team === 'blue' ? blue.trim() : neutral.trim();
            div.innerHTML = `<span class="chat-message-author" style="color:${color}">${this._esc(data.playerName)}</span>: ${this._esc(data.message)}`;
        }

        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;

        // Limit messages
        while (msgs.children.length > 100) {
            msgs.removeChild(msgs.firstChild);
        }
    }

    loadHistory(messages) {
        if (!messages || !messages.length) return;
        const msgs = document.getElementById('gameChatMessages');
        if (!msgs) return;
        msgs.innerHTML = '';
        for (const msg of messages) {
            this.addMessage(msg);
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
