/**
 * Input Manager - Captures keyboard input for player movement
 * Default keys match Haxball: Arrow keys + X (kick)
 */
export class InputManager {
    constructor() {
        this.keys = {};
        this.bindings = {
            up: ['ArrowUp', 'KeyW'],
            down: ['ArrowDown', 'KeyS'],
            left: ['ArrowLeft', 'KeyA'],
            right: ['ArrowRight', 'KeyD'],
            kick: ['KeyX', 'Space']
        };

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);

        this.enabled = false;
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    disable() {
        this.enabled = false;
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this.keys = {};
    }

    _onKeyDown(e) {
        this.keys[e.code] = true;

        // Prevent default for game keys (but not when typing in chat)
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            const allBindings = Object.values(this.bindings).flat();
            if (allBindings.includes(e.code)) {
                e.preventDefault();
            }
        }
    }

    _onKeyUp(e) {
        this.keys[e.code] = false;
    }

    /**
     * Get current input state
     */
    getInput() {
        return {
            up: this._isAction('up'),
            down: this._isAction('down'),
            left: this._isAction('left'),
            right: this._isAction('right'),
            kick: this._isAction('kick')
        };
    }

    _isAction(action) {
        const keys = this.bindings[action] || [];
        return keys.some(k => this.keys[k]);
    }

    /**
     * Rebind a key
     */
    rebind(action, keys) {
        if (this.bindings[action]) {
            this.bindings[action] = Array.isArray(keys) ? keys : [keys];
        }
    }

    /**
     * Load bindings from localStorage
     */
    loadBindings() {
        try {
            const saved = localStorage.getItem('gokball_keybinds');
            if (saved) {
                this.bindings = { ...this.bindings, ...JSON.parse(saved) };
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * Save bindings to localStorage
     */
    saveBindings() {
        try {
            localStorage.setItem('gokball_keybinds', JSON.stringify(this.bindings));
        } catch (e) { /* ignore */ }
    }
}
