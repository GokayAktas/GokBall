/**
 * Create Room Screen
 */
import JSON5 from 'json5';

export class CreateRoom {
  constructor(app) {
    this.app = app;
    this._customStadium = null;
  }

  render() {
    const div = document.createElement('div');
    div.className = 'screen';
    div.innerHTML = `
      <div class="top-bar" style="max-width:500px;">
        <button class="back-btn" id="btnBack">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Geri
        </button>
        <h2 class="page-title">Oda Oluştur</h2>
        <div></div>
      </div>

      <div class="create-room-form card">
        <div class="input-group">
          <label for="roomName">Oda Adı <span style="color: var(--danger);">*</span></label>
          <input type="text" id="roomName" class="input" placeholder="Oda adı girin..." maxlength="30" autocomplete="off" />
          <span id="roomNameError" style="color: var(--danger); font-size: var(--font-xs); display: none;">Oda adı zorunludur!</span>
        </div>

        <div class="input-group">
          <label for="roomPassword">Şifre (opsiyonel)</label>
          <input type="password" id="roomPassword" class="input" placeholder="Şifre belirleyin..." maxlength="20" autocomplete="off" />
        </div>

        <div class="form-row">
          <div class="input-group">
            <label for="maxPlayers">Max Oyuncu: <span id="maxPlayersValue" class="value-highlight">12</span></label>
            <select id="maxPlayers" class="input">
              <option value="2">2</option>
              <option value="4">4</option>
              <option value="6">6</option>
              <option value="8">8</option>
              <option value="10">10</option>
              <option value="12" selected>12</option>
              <option value="14">14</option>
              <option value="16">16</option>
              <option value="20">20</option>
              <option value="22">22</option>
              <option value="24">24</option>
            </select>
          </div>

          <div class="input-group">
            <label for="scoreLimit">Skor Limiti: <span id="scoreLimitValue" class="value-highlight">3</span></label>
            <select id="scoreLimit" class="input">
              <option value="0">Limit Yok</option>
              <option value="1">1</option>
              <option value="3" selected>3</option>
              <option value="5">5</option>
              <option value="7">7</option>
              <option value="10">10</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="input-group">
            <label for="timeLimit">Süre Limiti (dk): <span id="timeLimitValue" class="value-highlight">3</span></label>
            <select id="timeLimit" class="input">
              <option value="0">Limit Yok</option>
              <option value="1">1</option>
              <option value="3" selected>3</option>
              <option value="5">5</option>
              <option value="7">7</option>
              <option value="10">10</option>
              <option value="15">15</option>
            </select>
          </div>

          <div class="input-group">
            <label>Saha</label>
            <div style="display:flex; gap: var(--space-sm);">
              <select id="stadiumSelect" class="input" style="flex:1;">
                <option value="small">Küçük (1v1)</option>
                <option value="futsal">Futsal (3v3)</option>
                <option value="classic" selected>Klasik (3v3)</option>
                <option value="big">Büyük (5v5)</option>
                <option value="huge">Devasa (7v7)</option>
              </select>
              <label class="btn-hbs">
                📁 HBS
                <input type="file" id="hbsUpload" accept=".hbs" style="display:none;" />
              </label>
            </div>
          </div>
        </div>

        <div class="input-group">
          <label for="roomType">Sunucu Lokasyonu / Performans</label>
          <select id="roomType" class="input">
            <option value="cloud" selected>🌍 Bulut Sunucu (Standart - Herkese Eşit)</option>
            <option value="local">⚡ Yerel Ana Bilgisayar (Admin İçin 0 Ping)</option>
          </select>
          <small style="color: var(--text-muted); font-size: 11px; display:block; margin-top:4px; line-height: 1.4;">
            <b>Yerel:</b> Odayı kuran kişi (Admin) 0 ping ile oynar. Fizik hesaplamaları Admin'in bilgisayarına göre yapılır (Haxball P2P modu).
          </small>
        </div>

        <button class="btn btn-primary btn-lg btn-block" id="btnCreate">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Oda Oluştur
        </button>
      </div>
    `;
    return div;
  }

  onShow() {
    this._customStadium = null;

    document.getElementById('btnBack')?.addEventListener('click', () => {
      this.app.ui.showScreen('mainMenu');
    });

    // Slider value display
    const sliders = [
      { id: 'maxPlayers', display: 'maxPlayersValue' },
      { id: 'scoreLimit', display: 'scoreLimitValue', labels: { '0': 'Limit Yok' } },
      { id: 'timeLimit', display: 'timeLimitValue', labels: { '0': 'Limit Yok' } }
    ];

    sliders.forEach(({ id, display, labels }) => {
      const slider = document.getElementById(id);
      const span = document.getElementById(display);
      if (!slider || !span) return;

      const update = () => {
        const val = slider.value;
        span.textContent = (labels && labels[val]) ? labels[val] : val;
      };

      slider.addEventListener('change', update);
      slider.addEventListener('input', update);
    });

    // Clear error on input
    document.getElementById('roomName')?.addEventListener('input', () => {
      const errEl = document.getElementById('roomNameError');
      if (errEl) errEl.style.display = 'none';
      document.getElementById('roomName').style.borderColor = '';
    });

    // HBS file upload
    document.getElementById('hbsUpload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          // Validate by parsing
          const parsed = JSON5.parse(ev.target.result);
          this._customStadium = parsed;
          const select = document.getElementById('stadiumSelect');
          // Remove old custom option
          const old = select.querySelector('option[value="custom"]');
          if (old) old.remove();
          const opt = document.createElement('option');
          opt.value = 'custom';
          opt.textContent = parsed.name || file.name.replace('.hbs', '');
          opt.selected = true;
          select.appendChild(opt);
        } catch (err) {
          alert('HBS dosyası okunamadı: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    // Create button
    document.getElementById('btnCreate')?.addEventListener('click', () => {
      this._createRoom();
    });
  }

  _createRoom() {
    const nameInput = document.getElementById('roomName');
    const btnCreate = document.getElementById('btnCreate');
    const name = nameInput?.value.trim();

    // Validate room name
    if (!name) {
      const errEl = document.getElementById('roomNameError');
      if (errEl) errEl.style.display = 'block';
      if (nameInput) {
        nameInput.style.borderColor = 'var(--danger)';
        nameInput.focus();
      }
      return;
    }

    const password = document.getElementById('roomPassword')?.value || '';
    const maxPlayers = parseInt(document.getElementById('maxPlayers')?.value) || 12;

    const scoreLimitVal = document.getElementById('scoreLimit')?.value;
    const scoreLimit = (scoreLimitVal === '0') ? 0 : (parseInt(scoreLimitVal) || 3);

    const timeLimitVal = document.getElementById('timeLimit')?.value;
    const timeLimit = (timeLimitVal === '0') ? 0 : (parseInt(timeLimitVal) || 3) * 60;

    const stadiumValue = document.getElementById('stadiumSelect')?.value;
    const roomType = document.getElementById('roomType')?.value || 'cloud';

    const options = {
      name,
      password,
      maxPlayers,
      scoreLimit,
      timeLimit,
      stadium: stadiumValue,
      roomType,
      playerName: this.app.playerName || 'Player'
    };

    // If custom stadium uploaded
    if (this._customStadium && stadiumValue === 'custom') {
      options.stadium = this._customStadium;
    }

    // Feedback
    btnCreate.disabled = true;
    btnCreate.innerHTML = `
      <svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
      Oda Oluşturuluyor...
    `;

    this.app.createRoom(options);

    // Timeout to re-enable button if something goes wrong
    setTimeout(() => {
      if (btnCreate) {
        btnCreate.disabled = false;
        btnCreate.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Oda Oluştur
        `;
      }
    }, 5000);
  }
}
