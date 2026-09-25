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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M16.36 16.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M16.36 7.64l1.42-1.42"/></svg>
            Ayarlar
          </button>
        </div>

        <footer class="menu-footer">
          <p class="menu-footer-tagline">
            GokBall, tarayıcıda ücretsiz oynanan gerçek zamanlı çok oyunculu futbol oyunudur.
            Oda oluştur, arkadaşlarını davet et ve gol atmaya başla — kurulum gerekmez.
          </p>
          <nav class="menu-footer-links" aria-label="Site içi bağlantılar">
            <a href="/" data-screen-link="home" title="Ana menüye dön">Ana Sayfa</a>
            <a href="/?screen=roomList" data-screen-link="roomList" title="Açık odaları görüntüle">Oda Listesi</a>
            <a href="/?screen=createRoom" data-screen-link="createRoom" title="Yeni bir oda oluştur">Oda Oluştur</a>
            <a href="/?screen=settings" data-screen-link="settings" title="Kontrolleri ve görsel ayarları düzenle">Ayarlar</a>
            <a href="https://github.com/GokayAktas/GokBall" target="_blank" rel="noopener" title="GitHub deposunu aç">GitHub</a>
          </nav>
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

    // Footer internal links navigate through the SPA router
    document.querySelectorAll('.menu-footer-links a[data-screen-link]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = link.getAttribute('data-screen-link');
        if (target === 'home') {
          this.app.ui.showScreen('mainMenu');
        } else if (target === 'roomList' || target === 'createRoom') {
          if (this._saveName()) this.app.ui.showScreen(target);
        } else if (target === 'settings') {
          this.app.ui.showScreen('settings');
        }
      });
    });

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
