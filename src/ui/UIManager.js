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
        this.app.innerHTML = '';
        this.app.style.display = 'none';
    }

    showApp() {
        this.app.style.display = '';
    }
}
