/**
 * UI Manager - Handles screen transitions
 */
export class UIManager {
    constructor() {
        this.app = document.getElementById('app');
        this.currentScreen = null;
        this.screens = {};
    }

    registerScreen(name, screen) {
        this.screens[name] = screen;
    }

    showScreen(name, data) {
        // Hide current screen
        if (this.currentScreen && this.screens[this.currentScreen]?.onHide) {
            this.screens[this.currentScreen].onHide();
        }

        this.currentScreen = name;
        const screen = this.screens[name];

        if (screen) {
            this.app.innerHTML = '';
            const el = screen.render(data);
            this.app.appendChild(el);
            if (screen.onShow) screen.onShow(data);
        }
    }

    hideAll() {
        if (this.currentScreen && this.screens[this.currentScreen]?.onHide) {
            this.screens[this.currentScreen].onHide();
        }
        this.app.innerHTML = '';
        this.app.style.display = 'none';
    }

    showApp() {
        this.app.style.display = '';
    }

    showConfirm(message, onConfirm) {
        const old = document.getElementById('customConfirmModal');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'customConfirmModal';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.7); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: #202020; padding: 25px 35px; border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.8); border: 2px solid #555;
            display: flex; flex-direction: column; align-items: center;
            font-family: 'Inter', sans-serif; min-width: 350px;
        `;

        const title = document.createElement('div');
        title.innerHTML = '⚠️ Eylem Onayı';
        title.style.cssText = `font-weight: 800; font-size: 20px; margin-bottom: 20px; color: #ff7675; text-transform: uppercase;`;

        const text = document.createElement('div');
        text.innerHTML = message;
        text.style.cssText = `font-size: 16px; margin-bottom: 30px; color: #eee; text-align: center; line-height: 1.5;`;

        const btnRow = document.createElement('div');
        btnRow.style.cssText = `display: flex; gap: 20px; width: 100%;`;

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'Vazgeç';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.style.flex = "1";
        cancelBtn.onclick = () => overlay.remove();

        const confirmBtn = document.createElement('button');
        confirmBtn.innerText = 'Onayla';
        confirmBtn.className = 'btn btn-danger';
        confirmBtn.style.flex = "1";
        confirmBtn.onclick = () => {
            overlay.remove();
            if (typeof onConfirm === 'function') onConfirm();
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        box.appendChild(title);
        box.appendChild(text);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }
}
