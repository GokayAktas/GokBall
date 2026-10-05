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
          <img src="/logo.png" alt="GokBall — ücretsiz çevrimiçi çok oyunculu futbol oyunu logosu" class="logo-banner" />
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
          <button class="btn btn-ghost btn-block" id="btnAbout" aria-haspopup="dialog">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/>
            </svg>
            Hakkında
          </button>
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

    document.getElementById('btnAbout')?.addEventListener('click', () => this._showAbout());
  }

  /** Hakkında dialog */
  _showAbout() {
    const old = document.getElementById('aboutModal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aboutModal';
    overlay.className = 'about-overlay';
    overlay.innerHTML = `
      <div class="about-box" role="dialog" aria-modal="true" aria-labelledby="aboutTitle" aria-describedby="aboutDescription">
        <button class="about-close-icon" id="aboutCloseIcon" aria-label="Hakkında penceresini kapat">×</button>
        <div class="about-mark" aria-hidden="true"><span>⚽</span></div>
        <p class="about-eyebrow">OYUN HAKKINDA</p>
        <h2 id="aboutTitle" class="about-title">Sahaya çık, maç başlasın.</h2>
        <p id="aboutDescription" class="about-text">
          <strong>GokBall</strong>, tarayıcınızda arkadaşlarınızla oynayabileceğiniz gerçek zamanlı,
          çok oyunculu bir 2D futbol oyunudur. Oda kurun, takımınızı seçin ve maça başlayın.
        </p>
        <div class="about-features">
          <div class="about-feature">
            <span class="about-feature-icon">⚡</span>
            <span><strong>Canlı maçlar</strong><small>Arkadaşlarınla aynı sahada buluş.</small></span>
          </div>
          <div class="about-feature">
            <span class="about-feature-icon">⚽</span>
            <span><strong>Takım oyunu</strong><small>Sohbet et, paslaş ve skor yap.</small></span>
          </div>
          <div class="about-feature">
            <span class="about-feature-icon">🎨</span>
            <span><strong>Sana göre</strong><small>Kontrolleri ve görünümü düzenle.</small></span>
          </div>
        </div>
        <div class="about-bottom">
          <span>Bir oda oluştur. Takımını kur. Oyuna gir.</span>
          <button class="btn btn-primary" id="aboutClose">Tamam</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      document.getElementById('btnAbout')?.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    overlay.querySelector('#aboutClose')?.addEventListener('click', close);
    overlay.querySelector('#aboutCloseIcon')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
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
