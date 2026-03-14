/**
 * Settings Modal for mid-game adjustment
 */
export class SettingsModal {
    constructor(app) {
        this.app = app;
        this.container = document.createElement('div');
        this.container.id = 'settingsModalOverlay';
        this.container.className = 'in-game-menu-overlay hidden';
        document.body.appendChild(this.container);
        this.isVisible = false;
    }

    render() {
        const bindings = this.app.input.bindings;

        this.container.innerHTML = `
            <div class="settings-modal card" style="width: 100%; max-width: 500px; max-height: 85vh; overflow-y: auto;">
                <div class="room-mgmt-header" style="margin-bottom: 20px;">
                    <span class="room-mgmt-title" style="font-size: 24px;">AYARLAR</span>
                    <button class="btn btn-secondary btn-sm" id="btnSettingsClose">Kapat</button>
                </div>
                
                <div class="settings-list">
                    <!-- Kontroller -->
                    <div class="settings-section">
                        <div class="settings-section-title" style="font-size: 18px;">
                            <span>🎮</span> Kontroller
                        </div>
                        <div class="controls-grid" style="display: flex; flex-direction: column; gap: 4px;">
                            ${[
                { id: 'up', label: 'Yukarı', icon: '⬆️' },
                { id: 'down', label: 'Aşağı', icon: '⬇️' },
                { id: 'left', label: 'Sol', icon: '⬅️' },
                { id: 'right', label: 'Sağ', icon: '➡️' },
                { id: 'kick', label: 'Vuruş', icon: '🦵' }
            ].map(item => `
                                <div class="control-item" style="padding: 6px 0;">
                                    <div class="control-label" style="font-size: 14px;">${item.label}</div>
                                    <button class="control-key key-bind-btn" data-action="${item.id}" style="padding: 2px 8px; font-size: 12px; min-width: 70px;">
                                        ${(bindings[item.id] || []).map(k => k.replace('Key', '').replace('Arrow', '')).join(' / ')}
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Ses -->
                    <div class="settings-section" style="padding: 15px;">
                        <div class="settings-section-title" style="font-size: 18px; margin-bottom: 10px;">
                            <span>🔊</span> Ses
                        </div>
                        <div class="slider-group">
                            <label style="display: flex; justify-content: space-between; font-size: 14px;">
                                <span>Ana Ses</span>
                                <span><span id="modVolumeValue">100</span>%</span>
                            </label>
                            <input type="range" class="slider" id="modVolumeSlider" min="0" max="100" value="100" />
                        </div>
                    </div>

                    <!-- Görüntü -->
                    <div class="settings-section" style="padding: 15px;">
                        <div class="settings-section-title" style="font-size: 18px; margin-bottom: 10px;">
                            <span>🔍</span> Görüntü
                        </div>
                        <div class="slider-group">
                            <label style="display: flex; justify-content: space-between; font-size: 14px;">
                                <span>Zoom</span>
                                <span><span id="modZoomValue">1.5</span>x</span>
                            </label>
                            <input type="range" class="slider" id="modZoomSlider" min="5" max="30" value="15" />
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._bindEvents();
    }

    _bindEvents() {
        this.container.querySelector('#btnSettingsClose')?.addEventListener('click', () => this.hide());

        // Volume
        const volSlider = this.container.querySelector('#modVolumeSlider');
        const volValue = this.container.querySelector('#modVolumeValue');
        const savedVol = localStorage.getItem('gokball_volume') || 100;
        if (volSlider) volSlider.value = savedVol;
        if (volValue) volValue.textContent = savedVol;

        volSlider?.addEventListener('input', () => {
            const val = volSlider.value;
            if (volValue) volValue.textContent = val;
            localStorage.setItem('gokball_volume', val);
        });

        // Zoom
        const zoomSlider = this.container.querySelector('#modZoomSlider');
        const zoomValue = this.container.querySelector('#modZoomValue');
        const savedZoom = localStorage.getItem('gokball_zoom') || 1.5;
        if (zoomSlider) zoomSlider.value = Math.round(parseFloat(savedZoom) * 10);
        if (zoomValue) zoomValue.textContent = savedZoom;

        zoomSlider?.addEventListener('input', () => {
            const val = (parseInt(zoomSlider.value) / 10).toFixed(1);
            if (zoomValue) zoomValue.textContent = val;
            localStorage.setItem('gokball_zoom', val);
            if (this.app.camera) this.app.camera.setZoom(parseFloat(val));
        });

        // Rebinding
        this.container.querySelectorAll('.key-bind-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                btn.textContent = '...';

                const handler = (e) => {
                    e.preventDefault();
                    this.app.input.rebind(action, [e.code]);
                    this.app.input.saveBindings();
                    btn.textContent = e.code.replace('Key', '').replace('Arrow', '');
                    window.removeEventListener('keydown', handler);
                };
                window.addEventListener('keydown', handler, { once: true });
            });
        });

        this.container.onclick = (e) => {
            if (e.target === this.container) this.hide();
        };
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    show() {
        this.render();
        this.container.classList.remove('hidden');
        this.isVisible = true;
    }

    hide() {
        this.container.classList.add('hidden');
        this.isVisible = false;
    }
}
