/**
 * In-game Scoreboard HUD
 */
export class Scoreboard {
  constructor() {
    this.container = document.getElementById('scoreboard');
    this.onSettingsClick = null;
  }

  show(roomName = "") {
    if (roomName) this._roomName = roomName;
    if (!this.container) this.container = document.getElementById('scoreboard');
    if (!this.container) return;

    this.container.innerHTML = `
            <div class="scoreboard-hud">
                <div class="hud-left">
                    <!-- Room name removed -->
                </div>
                <div class="hud-center">
                    <div class="score-display">
                        <div class="score-box red"></div>
                        <span class="score-text" id="hud-score-red">0</span>
                        <span style="color: rgba(255,255,255,0.3)">-</span>
                        <span class="score-text" id="hud-score-blue">0</span>
                        <div class="score-box blue"></div>
                    </div>
                    <div class="timer-text" id="hud-timer">00:00</div>
                </div>
                <div class="hud-right">
                    <div class="volume-container">
                        <div class="volume-slider-popover">
                            <input type="range" id="hud-volume-slider" min="0" max="1" step="0.01" value="0.5" />
                        </div>
                        <button class="in-game-btn" id="hud-volume-btn" title="Ses">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                        </button>
                    </div>
                    <button class="in-game-btn menu-btn" id="hud-menu-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="18" x2="20" y2="18"></line></svg>
                        MENÜ
                    </button>
                    <button class="in-game-btn" id="hud-settings-btn" title="Ayarlar">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                </div>
            </div>
        `;
    this.container.classList.remove('hidden');

    // Bind buttons
    const menuBtn = this.container.querySelector('#hud-menu-btn');
    if (menuBtn) menuBtn.onclick = () => window.dispatchEvent(new CustomEvent('toggleInGameMenu'));

    const settingsBtn = this.container.querySelector('#hud-settings-btn');
    if (settingsBtn) settingsBtn.onclick = () => window.dispatchEvent(new CustomEvent('toggleSettings'));

    const volBtn = this.container.querySelector('#hud-volume-btn');
    const volSlider = this.container.querySelector('#hud-volume-slider');

    if (volSlider) {
      // Initialize from localStorage or default
      const savedVol = localStorage.getItem('gokball_volume') || 0.5;
      volSlider.value = savedVol;
      window.dispatchEvent(new CustomEvent('setVolume', { detail: { volume: savedVol } }));

      volSlider.oninput = (e) => {
        const v = parseFloat(e.target.value);
        localStorage.setItem('gokball_volume', v);
        window.dispatchEvent(new CustomEvent('setVolume', { detail: { volume: v } }));
      };
    }

    if (volBtn) {
      volBtn.onclick = () => {
        if (volSlider) {
          volSlider.value = volSlider.value > 0 ? 0 : 0.5;
          volSlider.oninput({ target: volSlider });
        }
      };
    }
  }

  hide() {
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.innerHTML = '';
    }
  }

  updateRoomName(name) {
    this._roomName = name;
    const el = document.getElementById('hud-room-display');
    if (el) el.textContent = name;
  }

  update(scoreRed, scoreBlue, timeSeconds) {
    const redEl = document.getElementById('hud-score-red');
    const blueEl = document.getElementById('hud-score-blue');
    const timerEl = document.getElementById('hud-timer');

    if (redEl) redEl.textContent = scoreRed;
    if (blueEl) blueEl.textContent = scoreBlue;
    if (timerEl) {
      const mins = Math.floor(timeSeconds / 60);
      const secs = timeSeconds % 60;
      timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }

  showGoal(team) {
    const color = team === 'red' ? '#E74C3C' : '#3498DB';
    const overlay = document.createElement('div');
    overlay.className = 'goal-overlay';
    overlay.innerHTML = `<div class="goal-text" style="color: ${color}">GOOOL!!!</div>`;
    document.body.appendChild(overlay);

    setTimeout(() => overlay.remove(), 2500);
  }
}
