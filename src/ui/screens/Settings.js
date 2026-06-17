/**
 * Improved Settings Screen
 */
export class Settings {
  constructor(app) {
    this.app = app;
  }

  render() {
    const div = document.createElement('div');
    div.className = 'screen';

    const bindings = this.app.input.bindings;

    div.innerHTML = `
            <div class="top-bar" style="max-width:800px;">
                <button class="back-btn" id="btnBack">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Geri
                </button>
                <h1 class="page-title" style="font-size: 32px; letter-spacing: 1px;">AYARLAR</h1>
                <div style="width: 80px;"></div>
            </div>

            <div class="settings-list" style="max-width: 800px;">
                <!-- Kontroller -->
                <div class="settings-section">
                    <div class="settings-section-title">
                        <span style="font-size: 24px;">🎮</span> Kontroller
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
                                <div class="control-label">
                                    <span style="margin-right: 8px;">${item.icon}</span> ${item.label}
                                </div>
                                <button class="control-key key-bind-btn" data-action="${item.id}">
                                    ${(bindings[item.id] || []).map(k => k.replace('Key', '').replace('Arrow', '')).join(' / ')}
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Ses -->
                <div class="settings-section">
                    <div class="settings-section-title">
                        <span style="font-size: 24px;">🔊</span> Ses
                    </div>
                    <div class="slider-group">
                        <label>
                            <span>Ana Ses</span>
                            <span><span id="volumeValue">100</span>%</span>
                        </label>
                        <input type="range" class="slider" id="volumeSlider" min="0" max="100" value="100" />
                    </div>
                </div>

                <!-- Görüntü -->
                <div class="settings-section">
                    <div class="settings-section-title">
                        <span style="font-size: 24px;">🔍</span> Görüntü
                    </div>
                    <div class="slider-group">
                        <label>
                            <span>Zoom (Kamera Ölçeği)</span>
                            <span><span id="zoomValue">1.5</span>x</span>
                        </label>
                        <input type="range" class="slider" id="zoomSlider" min="5" max="30" value="15" />
                    </div>
                </div>
                <!-- Admin Team Colors -->
                <div class="settings-section admin-only" id="settingsAdminColors" style="display:none;">
                  <div class="settings-section-title">
                    <span style="font-size:24px;">🎨</span> Takım Renkleri (Admin)
                  </div>
                  <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                    <div style="display:flex; flex-direction:column; gap:8px;">
                      <label>Önayarlar</label>
                      <div style="display:flex; gap:8px;">
                        <button class="btn" id="presetChampions">Champions</button>
                        <button class="btn" id="presetClassic">Classic</button>
                        <button class="btn" id="presetNeon">Neon</button>
                      </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                      <label>Red primary</label>
                      <input type="color" id="settingsRedPrimary" value="#D32F2F" />
                      <input type="text" id="settingsRedExtra" placeholder="Ek renkler, virgülle ayrılmış (FF6B6B,FFCDD2)" />
                      <label>Açı</label>
                      <input type="number" id="settingsRedAngle" value="0" />
                    </div>

                    <div style="display:flex; flex-direction:column; gap:6px;">
                      <label>Blue primary</label>
                      <input type="color" id="settingsBluePrimary" value="#1565C0" />
                      <input type="text" id="settingsBlueExtra" placeholder="Ek renkler, virgülle ayrılmış (4FA3FF,82B1FF)" />
                      <label>Açı</label>
                      <input type="number" id="settingsBlueAngle" value="0" />
                    </div>

                    <div style="display:flex; flex-direction:column; gap:6px;">
                      <label>Preview</label>
                      <div style="display:flex; gap:8px;">
                        <div id="previewRed" style="width:48px; height:48px; border-radius:50%; background:#D32F2F; box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>
                        <div id="previewBlue" style="width:48px; height:48px; border-radius:50%; background:#1565C0; box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>
                      </div>
                      <div style="margin-top:8px; display:flex; gap:8px;">
                        <button class="btn btn-primary" id="btnSettingsApplyColors">Uygula</button>
                        <button class="btn btn-secondary" id="btnSettingsLoadColors">Sunucudan Yükle</button>
                      </div>
                    </div>
                  </div>
                </div>
            </div>
        `;
    return div;
  }

  onShow() {
    document.getElementById('btnBack')?.addEventListener('click', () => {
      this.app.ui.showScreen('mainMenu');
    });

    // Volume slider
    const volSlider = document.getElementById('volumeSlider');
    const volValue = document.getElementById('volumeValue');
    const savedVol = localStorage.getItem('gokball_volume') || 100;
    if (volSlider) volSlider.value = savedVol;
    if (volValue) volValue.textContent = savedVol;

    volSlider?.addEventListener('input', () => {
      const val = volSlider.value;
      if (volValue) volValue.textContent = val;
      localStorage.setItem('gokball_volume', val);
      // window.audioManager?.setVolume(val/100);
    });

    // Zoom slider
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    const savedZoom = localStorage.getItem('gokball_zoom') || 1.5;
    if (zoomSlider) zoomSlider.value = Math.round(parseFloat(savedZoom) * 10);
    if (zoomValue) zoomValue.textContent = savedZoom;

    zoomSlider?.addEventListener('input', () => {
      const val = (parseInt(zoomSlider.value) / 10).toFixed(1);
      if (zoomValue) zoomValue.textContent = val;
      localStorage.setItem('gokball_zoom', val);
      if (this.app.camera) this.app.camera.setZoom(parseFloat(val));
    });

    // Key rebinding
    document.querySelectorAll('.key-bind-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const oldText = btn.textContent;
        btn.textContent = 'Bir tuşa bas...';
        btn.style.background = 'rgba(231, 76, 60, 0.2)';
        btn.style.borderColor = '#c70000';

        const handler = (e) => {
          e.preventDefault();
          const newKey = e.code;
          this.app.input.rebind(action, [newKey]);
          this.app.input.saveBindings();

          btn.textContent = newKey.replace('Key', '').replace('Arrow', '');
          btn.style.background = '';
          btn.style.borderColor = '';
          window.removeEventListener('keydown', handler);
        };
        window.addEventListener('keydown', handler, { once: true });
      });
    });
    // After elements are mounted, wire admin color controls
    // Small timeout to ensure DOM nodes exist in the page
    setTimeout(() => this.onMountElements?.(), 20);
  }

  onMountElements() {
    // Helper to apply local preview and optionally emit to server via NetworkManager
    const applyPreview = (allColors, emitToServer = false) => {
      try {
        if (allColors.red && allColors.red.colors && allColors.red.colors[0]) {
          document.documentElement.style.setProperty('--red-team', '#' + allColors.red.colors[0]);
          const preview = document.getElementById('previewRed');
          if (preview) preview.style.background = '#' + allColors.red.colors[0];
        }
        if (allColors.blue && allColors.blue.colors && allColors.blue.colors[0]) {
          document.documentElement.style.setProperty('--blue-team', '#' + allColors.blue.colors[0]);
          const preview = document.getElementById('previewBlue');
          if (preview) preview.style.background = '#' + allColors.blue.colors[0];
        }

        // Apply to local physics discs immediately for quick preview
        if (this.app.gameRunning && this.app.physics && this.app.physics.discs) {
          for (const disc of this.app.physics.discs) {
            if (!disc.isPlayer) continue;
            const tc = allColors[disc.team];
            if (tc && tc.colors && tc.colors.length > 0) {
              disc.color = tc.colors[0];
              disc.colors = tc.colors.slice();
              disc.colorAngle = tc.angle || 0;
              disc.avatarColor = tc.textColor || disc.avatarColor;
            }
          }
        }

        if (emitToServer) {
          if (allColors.red) this.app.network.setTeamColors({ team: 'red', angle: allColors.red.angle || 0, textColor: allColors.red.textColor || 'FFFFFF', colors: allColors.red.colors });
          if (allColors.blue) this.app.network.setTeamColors({ team: 'blue', angle: allColors.blue.angle || 0, textColor: allColors.blue.textColor || 'FFFFFF', colors: allColors.blue.colors });
        }
      } catch (e) {
        console.error('applyPreview error', e);
      }
    };

    // Wire admin controls
    const isAdmin = this.app.network.socket?.id === this.app.currentRoomData?.adminId;
    const adminSection = document.getElementById('settingsAdminColors');
    if (adminSection) {
      adminSection.style.display = isAdmin ? 'block' : 'none';

      const redPicker = document.getElementById('settingsRedPrimary');
      const bluePicker = document.getElementById('settingsBluePrimary');
      const redExtras = document.getElementById('settingsRedExtra');
      const blueExtras = document.getElementById('settingsBlueExtra');
      const redAngle = document.getElementById('settingsRedAngle');
      const blueAngle = document.getElementById('settingsBlueAngle');
      const previewApply = document.getElementById('btnSettingsApplyColors');
      const previewLoad = document.getElementById('btnSettingsLoadColors');

      const collect = () => ({
        red: {
          colors: [redPicker.value.replace('#','')].concat((redExtras.value || '').split(',').map(s => s.replace('#','').trim()).filter(Boolean)),
          angle: parseInt(redAngle.value || '0', 10) || 0,
          textColor: 'FFFFFF'
        },
        blue: {
          colors: [bluePicker.value.replace('#','')].concat((blueExtras.value || '').split(',').map(s => s.replace('#','').trim()).filter(Boolean)),
          angle: parseInt(blueAngle.value || '0', 10) || 0,
          textColor: 'FFFFFF'
        }
      });

      // Live preview when picking color
      redPicker?.addEventListener('input', () => {
        const p = collect(); applyPreview({ red: p.red, blue: p.blue }, false);
      });
      bluePicker?.addEventListener('input', () => {
        const p = collect(); applyPreview({ red: p.red, blue: p.blue }, false);
      });

      // Preset buttons
      document.getElementById('presetChampions')?.addEventListener('click', () => {
        document.getElementById('settingsRedPrimary').value = '#D32F2F';
        document.getElementById('settingsRedExtra').value = 'FF6B6B,FFCDD2';
        document.getElementById('settingsRedAngle').value = '0';
        document.getElementById('settingsBluePrimary').value = '#1565C0';
        document.getElementById('settingsBlueExtra').value = '4FA3FF,82B1FF';
        document.getElementById('settingsBlueAngle').value = '0';
        applyPreview(collect(), false);
      });

      document.getElementById('presetClassic')?.addEventListener('click', () => {
        document.getElementById('settingsRedPrimary').value = '#c70000';
        document.getElementById('settingsRedExtra').value = 'FF9999';
        document.getElementById('settingsBluePrimary').value = '#00008c';
        document.getElementById('settingsBlueExtra').value = '6666FF';
        applyPreview(collect(), false);
      });

      document.getElementById('presetNeon')?.addEventListener('click', () => {
        document.getElementById('settingsRedPrimary').value = '#FF007F';
        document.getElementById('settingsRedExtra').value = 'FF66A3,FFCCE6';
        document.getElementById('settingsBluePrimary').value = '#00E5FF';
        document.getElementById('settingsBlueExtra').value = '66FBFF,CCFBFF';
        applyPreview(collect(), false);
      });

      previewApply?.addEventListener('click', () => {
        const p = collect(); applyPreview(p, true); // emit to server
      });

      previewLoad?.addEventListener('click', () => {
        const rc = this.app.currentRoomData?.teamColors || null;
        if (rc && rc.red) {
          document.getElementById('settingsRedPrimary').value = '#' + (rc.red.colors?.[0] || 'D32F2F');
          document.getElementById('settingsRedExtra').value = (rc.red.colors || []).slice(1).join(',');
          document.getElementById('settingsRedAngle').value = rc.red.angle || 0;
        }
        if (rc && rc.blue) {
          document.getElementById('settingsBluePrimary').value = '#' + (rc.blue.colors?.[0] || '1565C0');
          document.getElementById('settingsBlueExtra').value = (rc.blue.colors || []).slice(1).join(',');
          document.getElementById('settingsBlueAngle').value = rc.blue.angle || 0;
        }
      });
    }
  }
}
