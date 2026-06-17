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
            <div class="settings-modal card">
                <div class="room-mgmt-header">
                    <span class="room-mgmt-title">AYARLAR</span>
                    <button class="btn btn-secondary btn-sm" id="btnSettingsClose">Kapat</button>
                </div>
                <!-- Admin Team Colors (visible to admins) -->
                <div class="settings-section padded admin-team-colors hidden" id="adminTeamColorsSection">
                    <div class="settings-section-title">
                        <span>🎨</span> Takım Renkleri (Admin)
                    </div>
                    <div class="team-color-row">
                        <label>Red primary</label>
                        <input type="text" id="adminRedPrimary" placeholder="D32F2F" />
                        <label>Extras (comma)</label>
                        <input type="text" id="adminRedExtras" placeholder="FF6B6B,FFCDD2" />
                        <label>Açı</label>
                        <input type="number" id="adminRedAngle" value="0" />
                    </div>
                    <div class="team-color-row">
                        <label>Blue primary</label>
                        <input type="text" id="adminBluePrimary" placeholder="1565C0" />
                        <label>Extras (comma)</label>
                        <input type="text" id="adminBlueExtras" placeholder="4FA3FF,82B1FF" />
                        <label>Açı</label>
                        <input type="number" id="adminBlueAngle" value="0" />
                    </div>
                    <div style="margin-top:8px; display:flex; gap:8px;">
                        <button class="btn btn-primary" id="btnApplyTeamColors">Uygula</button>
                        <button class="btn btn-secondary" id="btnFetchTeamColors">Sunucudan Yükle</button>
                    </div>
                </div>
                
                <div class="settings-list">
                    <!-- Kontroller -->
                        <div class="settings-section padded">
                        <div class="settings-section-title">
                            <span>🎮</span> Kontroller
                        </div>
                        <div class="controls-grid">
                            ${[
                { id: 'up', label: 'Yukarı', icon: '⬆️' },
                { id: 'down', label: 'Aşağı', icon: '⬇️' },
                { id: 'left', label: 'Sol', icon: '⬅️' },
                { id: 'right', label: 'Sağ', icon: '➡️' },
                { id: 'kick', label: 'Vuruş', icon: '🦵' }
            ].map(item => `
                                <div class="control-item">
                                    <div class="control-label control-label-inline">${item.label}</div>
                                    <button class="control-key key-bind-btn" data-action="${item.id}">
                                        ${(bindings[item.id] || []).map(k => k.replace('Key', '').replace('Arrow', '')).join(' / ')}
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Ses -->
                    <div class="settings-section padded">
                        <div class="settings-section-title">
                            <span>🔊</span> Ses
                        </div>
                        <div class="slider-group">
                            <label class="slider-label">
                                <span>Ana Ses</span>
                                <span><span id="modVolumeValue">100</span>%</span>
                            </label>
                            <input type="range" class="slider" id="modVolumeSlider" min="0" max="100" value="100" />
                        </div>
                    </div>

                    <!-- Görüntü -->
                    <div class="settings-section padded">
                        <div class="settings-section-title">
                            <span>🔍</span> Görüntü
                        </div>
                        <div class="slider-group">
                            <label class="slider-label">
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

        // Admin team colors UI
        const adminSection = this.container.querySelector('#adminTeamColorsSection');
        const isAdmin = this.app.network.socket?.id === this.app.currentRoomData?.adminId;
        if (adminSection) {
            if (isAdmin) adminSection.classList.remove('hidden');
            else adminSection.classList.add('hidden');

            const btnApply = this.container.querySelector('#btnApplyTeamColors');
            const btnFetch = this.container.querySelector('#btnFetchTeamColors');

            btnApply?.addEventListener('click', () => {
                const redPrimary = (this.container.querySelector('#adminRedPrimary')?.value || '').replace('#','').trim();
                const redExtras = (this.container.querySelector('#adminRedExtras')?.value || '').split(',').map(s => s.replace('#','').trim()).filter(Boolean);
                const redAngle = parseInt(this.container.querySelector('#adminRedAngle')?.value || '0', 10) || 0;

                const bluePrimary = (this.container.querySelector('#adminBluePrimary')?.value || '').replace('#','').trim();
                const blueExtras = (this.container.querySelector('#adminBlueExtras')?.value || '').split(',').map(s => s.replace('#','').trim()).filter(Boolean);
                const blueAngle = parseInt(this.container.querySelector('#adminBlueAngle')?.value || '0', 10) || 0;

                // Prepare payloads and emit via network manager
                if (redPrimary) {
                    this.app.network.setTeamColors({ team: 'red', angle: redAngle, textColor: 'FFFFFF', colors: [redPrimary, ...redExtras] });
                }
                if (bluePrimary) {
                    this.app.network.setTeamColors({ team: 'blue', angle: blueAngle, textColor: 'FFFFFF', colors: [bluePrimary, ...blueExtras] });
                }
            });

            btnFetch?.addEventListener('click', () => {
                // Request current room data from server to populate fields
                const rc = this.app.currentRoomData?.teamColors || (this.app.currentRoomData ? this.app.currentRoomData.teamColors : null);
                if (rc && rc.red) {
                    this.container.querySelector('#adminRedPrimary').value = rc.red.colors?.[0] || '';
                    this.container.querySelector('#adminRedExtras').value = (rc.red.colors || []).slice(1).join(',');
                    this.container.querySelector('#adminRedAngle').value = rc.red.angle || 0;
                }
                if (rc && rc.blue) {
                    this.container.querySelector('#adminBluePrimary').value = rc.blue.colors?.[0] || '';
                    this.container.querySelector('#adminBlueExtras').value = (rc.blue.colors || []).slice(1).join(',');
                    this.container.querySelector('#adminBlueAngle').value = rc.blue.angle || 0;
                }
            });
        }
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
