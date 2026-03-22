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
  }
}
