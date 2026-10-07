/**
 * Main Menu Screen
 */
export class MainMenu {
  constructor(app) {
    this.app = app;
  }

  render() {
    const div = document.createElement('div');
    div.className = 'screen';
    div.innerHTML = `
      <div class="particles-bg" id="particles"></div>
      <div class="menu-container">
        <div class="logo-container">
          <img src="/logo.png" alt="GokBall — ücretsiz çevrimiçi çok oyunculu futbol oyunu logosu" class="logo-banner" draggable="false" />
        </div>

        <div class="card" style="width: 100%;">
          <div class="input-group">
            <label for="nickname">Takma Ad</label>
            <input type="text" id="nickname" class="input" placeholder="Adını gir..." maxlength="16" autocomplete="off" />
          </div>
        </div>

        <div class="menu-buttons">
          <button class="btn btn-primary btn-lg btn-block" id="btnCreateRoom">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Oda Oluştur
          </button>
          <button class="btn btn-secondary btn-lg btn-block" id="btnBrowseRooms">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Odalara Göz At
          </button>
          <button class="btn btn-secondary btn-lg btn-block" id="btnSettings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/>
              <circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>
            </svg>
            Ayarlar
          </button>
        </div>

        <footer class="menu-footer">
          <p class="menu-footer-credit">&copy; <span id="footerYear"></span> GokBall</p>
        </footer>
      </div>
    `;
    return div;
  }

  onShow() {
    // Load saved nickname
    const saved = localStorage.getItem('gokball_nickname') || '';
    const input = document.getElementById('nickname');
    if (input) input.value = saved;

    // Create floating particles
    this._createParticles();

    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // Deep links: /?screen=roomList opens the room list directly
    const params = new URLSearchParams(window.location.search);
    const screenParam = params.get('screen');
    if (screenParam === 'roomList' || screenParam === 'createRoom' || screenParam === 'settings') {
      if (screenParam === 'roomList' || screenParam === 'createRoom') {
        if (!this._saveName()) return;
      }
      this.app.ui.showScreen(screenParam);
      return;
    }

    // Button handlers
    document.getElementById('btnCreateRoom')?.addEventListener('click', () => {
      if (!this._saveName()) return;
      this.app.ui.showScreen('createRoom');
    });

    document.getElementById('btnBrowseRooms')?.addEventListener('click', () => {
      if (!this._saveName()) return;
      this.app.ui.showScreen('roomList');
    });

    document.getElementById('btnSettings')?.addEventListener('click', () => {
      this.app.ui.showScreen('settings');
    });

  }

  _saveName() {
    const name = document.getElementById('nickname')?.value.trim();
    if (name) {
      localStorage.setItem('gokball_nickname', name);
      this.app.playerName = name;
      return true;
    } else {
      alert("Lütfen önce bir takma ad (nickname) giriniz!");
      document.getElementById('nickname')?.focus();
      return false;
    }
  }

  _createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;

    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (8 + Math.random() * 15) + 's';
      p.style.animationDelay = Math.random() * 10 + 's';
      p.style.width = (1 + Math.random() * 3) + 'px';
      p.style.height = p.style.width;
      container.appendChild(p);
    }
  }
}
