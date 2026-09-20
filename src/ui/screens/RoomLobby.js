/**
 * Room Lobby Screen - Team picker, player list, chat, admin controls
 */
import JSON5 from 'json5';
import HBSParser from '../../engine/HBSParser.js';

export class RoomLobby {
  constructor(app) {
    this.app = app;
    this.roomData = null;
    this.teamsLocked = false;
    this._networkHandlers = [];
    this._globalDragHandlersAdded = false;
  }

  render(data) {
    this.roomData = data;
    const div = document.createElement('div');
    div.className = 'screen';
    div.style.justifyContent = 'center';
    div.style.padding = '20px';

    div.innerHTML = `
      <div class="lobby-shell" style="min-height: 600px;">
        <div class="lobby-main-col">

          <!-- ============ ROOM HUD HEADER ============ -->
          <div class="room-hud">
            <div class="room-hud-titles">
              <div class="room-hud-title" id="roomTitle">${this._esc(data?.roomName || 'Oda')}</div>
              <div class="room-hud-sub">
                <span>${this._esc(data?.stadium?.name || 'Klasik')}</span>
                <span class="room-hud-sep">•</span>
                <span><span id="playerCount">${data?.players?.length || 0}</span> Oyuncu</span>
              </div>
            </div>
            <div class="room-hud-actions">
              <button class="btn btn-danger btn-sm btn-leave" id="btnLeave" title="Odadan Ayrıl">
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                 </svg>
                 AYRIL
              </button>
            </div>
          </div>

          <!-- ============ TEAM LOBBY ============ -->
          <div class="lobby-teams">
            <!-- Red Team -->
            <div class="team-card red team-column" id="teamRed">
              <div class="team-header">
                 <div class="team-header-actions">
                    <div class="team-title"><span class="team-dot"></span> KIRMIZI</div>
                    <div class="jersey-anchor" style="position:relative;" id="jerseyRedWrapper">
                      <button class="team-kit-btn" id="btnJerseyRed" title="Kırmızı Forma Seç">
                        <img src="/assets/red_shirt.png" style="width:15px; height:15px;" />
                        <span>Forma Seç</span>
                      </button>
                      <div id="jerseyDropdownRed" class="jersey-dropdown" style="display:none; position:absolute; top:calc(100% + 6px); left:0;"></div>
                    </div>
                    <button class="team-join-btn" id="btnJoinRed">Katıl</button>
                 </div>
                 <button class="team-clear-btn" id="btnClearRed" style="display:none;" title="Kırmızı Takımı Boşalt">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>
              </div>
              <div class="player-list" id="redPlayers"></div>
            </div>

            <!-- Spectators -->
            <div class="team-card spectator team-column" id="teamSpectator">
              <div class="team-header">
                 <div class="team-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> İzleyiciler</div>
                 <div class="team-header-actions">
                   <button class="team-dice-btn" id="btnJoinAuto" style="display:none;" title="Takımları Rastgele Karıştır (Sadece Admin)">🎲</button>
                   <button class="team-join-btn team-join-btn-accent" id="btnJoinSpectator">
                     <img src="/assets/video_camera.png" alt="" />
                     İzle
                   </button>
                 </div>
              </div>
              <div class="player-list" id="spectatorPlayers"></div>
            </div>

            <!-- Blue Team -->
            <div class="team-card blue team-column" id="teamBlue">
              <div class="team-header">
                 <button class="team-clear-btn" id="btnClearBlue" style="display:none;" title="Mavi Takımı Boşalt">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(180deg)"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>
                 <div class="team-header-actions">
                    <button class="team-join-btn" id="btnJoinBlue">Katıl</button>
                    <div class="jersey-anchor" style="position:relative;" id="jerseyBlueWrapper">
                      <button class="team-kit-btn" id="btnJerseyBlue" title="Mavi Forma Seç">
                        <img src="/assets/blue_shirt.png" style="width:15px; height:15px;" />
                        <span>Forma Seç</span>
                      </button>
                      <div id="jerseyDropdownBlue" class="jersey-dropdown" style="display:none; position:absolute; top:calc(100% + 6px); right:0;"></div>
                    </div>
                    <div class="team-title">MAVİ <span class="team-dot"></span></div>
                 </div>
              </div>
              <div class="player-list" id="bluePlayers"></div>
            </div>
          </div>

          <!-- ============ MATCH SETTINGS STRIP ============ -->
          <div class="lobby-settings">
            <div class="setting-inline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>Süre Limiti: <b id="timeLimitInfo">${data?.game?.timeLimit === 0 ? '∞' : Math.floor((data?.game?.timeLimit || 180) / 60)} dk</b></span>
            </div>
            <div class="setting-inline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
              <span>Skor Limiti: <b id="scoreLimitInfo">${data?.game?.scoreLimit === 0 ? '∞' : (data?.game?.scoreLimit || 3)}</b></span>
            </div>
            <div class="setting-inline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"></path></svg>
              <span>Oyun Hızı: <b>X<span id="speedInfo">${(data?.playerSpeedMultiplier || 1.0).toFixed(2)}</span></b></span>
            </div>
            <div class="setting-inline">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
              <span>Saha: <b><span id="stadiumName">${this._esc(data?.stadium?.name || 'Klasik')}</span></b></span>
            </div>
          </div>

          <!-- ============ ADMIN / HOST CONTROLS ============ -->
          <div id="adminPanel" class="admin-panel" style="display:none;">
            <button class="btn btn-primary btn-block btn-start" id="btnStartGame">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 21 12 6 21 6 3"></polygon></svg>
              OYUNU BAŞLAT
            </button>

            <!-- Admin Tools -->
            <div class="admin-tools">
              <button class="btn btn-secondary btn-sm" id="btnToggleLock" style="height:34px;">
                 <span id="lockIcon"></span> <span id="lockText">Takımları Kilitle</span>
              </button>
              <div class="setting-field">
                 <span class="setting-label">SAHA</span>
                 <select id="lobbyStadiumSelect" class="input setting-select">
                   <option value="small">Küçük (1v1)</option>
                   <option value="futsal">Futsal (3v3)</option>
                   <option value="classic">Klasik (3v3)</option>
                   <option value="big">Büyük (5v5)</option>
                   <option value="huge">Devasa (7v7)</option>
                   <option value="custom" disabled hidden>Özel Saha</option>
                 </select>
              </div>
              <div class="setting-field">
                 <span class="setting-label">GOL LİMİTİ</span>
                 <select id="lobbyScoreLimit" class="input setting-select">
                   <option value="1">1 Gol</option><option value="3">3 Gol</option><option value="5">5 Gol</option><option value="10">10 Gol</option><option value="0">Sınırsız</option>
                 </select>
              </div>
              <div class="setting-field">
                 <span class="setting-label">SÜRE</span>
                 <select id="lobbyTimeLimit" class="input setting-select">
                   <option value="60">1 Dakika</option><option value="180">3 Dakika</option><option value="300">5 Dakika</option><option value="600">10 Dakika</option><option value="0">Sınırsız</option>
                 </select>
              </div>
              <div class="setting-field">
                 <span class="setting-label">HIZ</span>
                 <select id="lobbySpeedMultiplier" class="input setting-select">
                   <option value="0.50">x0.50</option>
                   <option value="0.75">x0.75</option>
                   <option value="1.00">x1.00</option>
                   <option value="1.25">x1.25</option>
                   <option value="1.50">x1.50</option>
                   <option value="1.75">x1.75</option>
                   <option value="2.00">x2.00</option>
                 </select>
              </div>
              <button class="btn btn-overtime on" id="btnToggleOvertime" style="height:38px;">
                ⏱ <span id="overtimeText">Uzatma Var</span>
              </button>
              <label class="btn btn-secondary btn-sm" style="cursor:pointer; height:38px;">
                📁 Saha Yükle
                <input type="file" id="lobbyHbsUpload" accept=".hbs" style="display:none;" />
              </label>
            </div>
          </div>
        </div>

        <!-- ============ CHAT SIDEBAR ============ -->
        <div class="lobby-chat">
          <div class="lobby-chat-header">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            Sohbet
          </div>
          <div class="lobby-chat-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            Komutlar: /komut
          </div>
          <div class="lobby-chat-messages" id="lobbyChatMessages"></div>
          <div class="lobby-chat-inputrow">
            <input type="text" id="lobbyChatInput" class="input" placeholder="Mesaj yaz..." autocomplete="off" />
            <button class="btn btn-send-chat" id="btnSendChat" title="Gönder">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3 20V4l19 8L3 20zm2-3l11.85-5L5 7v3.5l6 1.5-6 1.5V17z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    return div;
  }

  onShow(data) {
    this.roomData = data;
    this.teamsLocked = data?.teamsLocked || false;

    // Clean up old event handlers
    this._cleanupHandlers();

    // Update player list
    this._updatePlayers(data?.players || []);
    // Show join hint (private message) if provided in server response
    if (data?.joinHint) {
      this._addChatMessage({ message: data.joinHint, system: true });
    }
    this._updateLockUI();
    this._updateAdminVisibility(data);

    // Leave button
    document.getElementById('btnLeave')?.addEventListener('click', () => {
      this.app.leaveRoom();
    });

    // Team buttons
    document.getElementById('btnJoinRed')?.addEventListener('click', () => {
      if (this.teamsLocked && !this._isCurrentPlayerAdmin()) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
        return;
      }
      const isGameRunning = this.roomData?.game && (this.roomData.game.state === 'playing' || this.roomData.game.state === 'countdown' || this.roomData.game.state === 'goal');
      if (isGameRunning && !this._isCurrentPlayerAdmin()) {
        alert('Maç devam ederken takım değiştirilemez!');
        return;
      }
      this.app.network.changeTeam('red');
    });
    document.getElementById('btnJoinBlue')?.addEventListener('click', () => {
      if (this.teamsLocked && !this._isCurrentPlayerAdmin()) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
        return;
      }
      const isGameRunning = this.roomData?.game && (this.roomData.game.state === 'playing' || this.roomData.game.state === 'countdown' || this.roomData.game.state === 'goal');
      if (isGameRunning && !this._isCurrentPlayerAdmin()) {
        alert('Maç devam ederken takım değiştirilemez!');
        return;
      }
      this.app.network.changeTeam('blue');
    });
    document.getElementById('btnJoinSpectator')?.addEventListener('click', () => {
      if (this.teamsLocked && !this._isCurrentPlayerAdmin()) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
        return;
      }
      const isGameRunning = this.roomData?.game && (this.roomData.game.state === 'playing' || this.roomData.game.state === 'countdown' || this.roomData.game.state === 'goal');
      if (isGameRunning && !this._isCurrentPlayerAdmin()) {
        alert('Maç devam ederken takım değiştirilemez!');
        return;
      }
      this.app.network.changeTeam('spectator');
    });

    document.getElementById('btnJoinAuto')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Önce kilidi açmalısınız.');
        return;
      }
      this.app.network.socket.emit('randomizeTeams');
    });

    document.getElementById('btnClearRed')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Önce kilidi açmalısınız.');
        return;
      }
      this.app.network.socket.emit('clearTeam', 'red');
    });

    document.getElementById('btnClearBlue')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Önce kilidi açmalısınız.');
        return;
      }
      this.app.network.socket.emit('clearTeam', 'blue');
    });

    // Admin buttons
    document.getElementById('btnStartGame')?.addEventListener('click', () => {
      this.app.network.startGame();
    });
    document.getElementById('btnToggleLock')?.addEventListener('click', () => {
      this.teamsLocked = !this.teamsLocked;
      this.roomData = { ...this.roomData, teamsLocked: this.teamsLocked };
      this._updateLockUI();
      this.app.network.socket.emit('toggleTeamLock');
    });

    // Overtime toggle
    this.overtimeEnabled = data?.overtimeEnabled ?? true;
    this._updateOvertimeUI();
    document.getElementById('btnToggleOvertime')?.addEventListener('click', () => {
      this.overtimeEnabled = !this.overtimeEnabled;
      this._updateOvertimeUI();
      this.app.network.socket.emit('setOvertime', this.overtimeEnabled);
    });

    // Jersey (Forma) Selection - reset for each new room
    localStorage.removeItem('gokball_selectedJersey');
    this._setupJerseySelector();

    // Speed Multiplier
    const speedSelect = document.getElementById('lobbySpeedMultiplier');
    if (speedSelect) {
      speedSelect.value = parseFloat(data?.playerSpeedMultiplier || 1.0).toFixed(2);
      speedSelect.addEventListener('change', (e) => {
        this.app.network.socket.emit('setSpeedMultiplier', parseFloat(e.target.value));
      });
    }

    // Lobby stadium change
    const stadiumSelect = document.getElementById('lobbyStadiumSelect');
    if (stadiumSelect) {
      // Map Turkish name/current name to value
      const currentName = data.stadium?.name;
      if (currentName === 'Küçük') stadiumSelect.value = 'small';
      else if (currentName === 'Futsal 3v3') stadiumSelect.value = 'futsal';
      else if (currentName === 'Klasik') stadiumSelect.value = 'classic';
      else if (currentName === 'Büyük') stadiumSelect.value = 'big';
      else if (currentName === 'Devasa') stadiumSelect.value = 'huge';
      else stadiumSelect.value = 'custom';

      stadiumSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val && val !== 'custom') {
          // Use new server-authoritative map system
          this.app.network.changeMap(val);
        }
      });
    }

    // HBS Upload
    const hbsUpload = document.getElementById('lobbyHbsUpload');
    if (hbsUpload) {
      hbsUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const hbsContent = event.target.result;
            const stadiumData = HBSParser.parse(hbsContent);
            
            // Basic validation
            if (!stadiumData.name) stadiumData.name = file.name.replace('.hbs', '');
            
            console.log('HBS parsed successfully:', stadiumData.name);
            this.app.network.changeStadium(stadiumData);
            
            // Re-select value if it was a preset
            if (stadiumSelect) stadiumSelect.value = 'classic'; // Reset selector visually
          } catch (err) {
            console.error('HBS Parse Error:', err);
            alert('Saha dosyası okunamadı: ' + err.message);
          }
        };
        reader.readAsText(file);
        // Clear input so same file can be uploaded twice if needed
        hbsUpload.value = '';
      });
    }

    // Score/Time Limits
    const scoreSelect = document.getElementById('lobbyScoreLimit');
    if (scoreSelect) {
      scoreSelect.value = data.game?.scoreLimit || 3;
      scoreSelect.addEventListener('change', (e) => this.app.network.socket.emit('setScoreLimit', e.target.value));
    }
    const timeSelect = document.getElementById('lobbyTimeLimit');
    if (timeSelect) {
      timeSelect.value = data.game?.timeLimit || 180;
      timeSelect.addEventListener('change', (e) => this.app.network.socket.emit('setTimeLimit', e.target.value));
    }

    // Drag and drop setup once
    this._setupDragDrop();

    // HBS upload in lobby
    document.getElementById('lobbyHbsUpload')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const stadium = JSON5.parse(ev.target.result);
          this.app.network.changeStadium(stadium);
        } catch (err) {
          alert('HBS dosyası geçersiz: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    // Chat - Fix: prevent duplicate sends
    const chatInput = document.getElementById('lobbyChatInput');
    const sendBtn = document.getElementById('btnSendChat');

    sendBtn?.addEventListener('click', () => {
      this._sendChat();
    });
    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._sendChat();
      }
    });

    // Network events - store references for cleanup
    this._registerHandler('playerJoined', (data) => {
      this._updatePlayers(data.players);
      this._addSystemMessage(`${data.player.name} odaya katıldı`);
    });

    this._registerHandler('playerLeft', (data) => {
      this._updatePlayers(data.players);
      this._addSystemMessage(`${data.playerName} ayrıldı`);
    });

    this._registerHandler('teamChanged', (data) => {
      this._updatePlayers(data.players);
    });

    this._registerHandler('chatMessage', (data) => {
      this._addChatMessage(data);
    });

    this._registerHandler('adminUpdate', (data) => {
      this.roomData = { ...this.roomData, ...data };
      if (data.players) this._updatePlayers(data.players);
      this._updateAdminVisibility(this.roomData);
    });

    this._registerHandler('stadiumChanged', (data) => {
      // Update roomData with new stadium
      if (data.stadium) {
        this.roomData = { ...this.roomData, stadium: data.stadium };
      }
      const el = document.getElementById('stadiumName');
      if (el) el.textContent = data.stadium?.name || 'Custom';
      // Update the stadium select dropdown to reflect the change
      const stadiumSelect = document.getElementById('lobbyStadiumSelect');
      if (stadiumSelect && data.stadium) {
        const name = data.stadium.name;
        if (name === 'Küçük') stadiumSelect.value = 'small';
        else if (name === 'Futsal 3v3') stadiumSelect.value = 'futsal';
        else if (name === 'Klasik') stadiumSelect.value = 'classic';
        else if (name === 'Büyük') stadiumSelect.value = 'big';
        else if (name === 'Devasa') stadiumSelect.value = 'huge';
      }
      this._addSystemMessage('Saha değiştirildi: ' + (data.stadium?.name || 'Custom'));
    });

    this._registerHandler('countdown', (data) => {
      this._addSystemMessage(`Oyun ${data.seconds} saniye içinde başlıyor...`);
    });

    this._registerHandler('gameStarted', () => {
      this.app.startGame(this.roomData);
    });

    this._registerHandler('teamLockChanged', (data) => {
      this.teamsLocked = data.locked;
      this._updateLockUI();
      this._addSystemMessage(data.locked ? '🔒 Takımlar kilitlendi' : '🔓 Takım kilidi açıldı');
    });

    this._registerHandler('roomUpdate', (data) => {
      this.roomData = { ...this.roomData, ...data };
      this._updateAdminVisibility(this.roomData);
      if (data.scoreLimit !== undefined) {
        const info = document.getElementById('scoreLimitInfo');
        if (info) info.textContent = data.scoreLimit === 0 ? '∞' : data.scoreLimit;
        const sel = document.getElementById('lobbyScoreLimit');
        if (sel) sel.value = data.scoreLimit;
      }
      if (data.timeLimit !== undefined) {
        const info = document.getElementById('timeLimitInfo');
        if (info) info.textContent = data.timeLimit === 0 ? '∞' : Math.floor(data.timeLimit / 60);
        const sel = document.getElementById('lobbyTimeLimit');
        if (sel) sel.value = data.timeLimit;
      }
      if (data.overtimeEnabled !== undefined) {
        this.overtimeEnabled = data.overtimeEnabled;
        this._updateOvertimeUI();
      }
      if (data.playerSpeedMultiplier !== undefined) {
        const sel = document.getElementById('lobbySpeedMultiplier');
        if (sel) sel.value = parseFloat(data.playerSpeedMultiplier).toFixed(2);
        const info = document.getElementById('speedInfo');
        if (info) info.textContent = parseFloat(data.playerSpeedMultiplier).toFixed(2);
      }
      if (data.players) {
        this._updatePlayers(data.players);
        const countSpan = document.getElementById('playerCount');
        if (countSpan) countSpan.textContent = data.players.length;
      }
    });
  }    _updateAdminVisibility(data) {
    const myPlayer = data?.players?.find(p => p.id === this.app.network.playerId);
    const isAdmin = myPlayer?.isAdmin;
    
    // Admin Panel
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = isAdmin ? '' : 'none';
    
    // Dice Button
    const btnJoinAuto = document.getElementById('btnJoinAuto');
    if (btnJoinAuto) btnJoinAuto.style.display = isAdmin ? '' : 'none';
    
    // Clear Arrows - always visible for admin
    const btnClearRed = document.getElementById('btnClearRed');
    if (btnClearRed) btnClearRed.style.display = isAdmin ? '' : 'none';
    
    const btnClearBlue = document.getElementById('btnClearBlue');
    if (btnClearBlue) btnClearBlue.style.display = isAdmin ? '' : 'none';

    // Room status chip removed from HUD (kept clean like reference design)
    const canClick = isAdmin || (!data.teamsLocked && !isGameRunning);
    const btnJoinRed = document.getElementById('btnJoinRed');
    if (btnJoinRed) {
        btnJoinRed.style.display = '';
        btnJoinRed.disabled = !canClick;
        btnJoinRed.style.opacity = canClick ? '1' : '0.4';
        btnJoinRed.style.cursor = canClick ? 'pointer' : 'not-allowed';
    }
    const btnJoinBlue = document.getElementById('btnJoinBlue');
    if (btnJoinBlue) {
        btnJoinBlue.style.display = '';
        btnJoinBlue.disabled = !canClick;
        btnJoinBlue.style.opacity = canClick ? '1' : '0.4';
        btnJoinBlue.style.cursor = canClick ? 'pointer' : 'not-allowed';
    }
    const btnJoinSpectator = document.getElementById('btnJoinSpectator');
    if (btnJoinSpectator) {
        btnJoinSpectator.style.display = '';
        btnJoinSpectator.disabled = !canClick;
        btnJoinSpectator.style.opacity = canClick ? '1' : '0.4';
        btnJoinSpectator.style.cursor = canClick ? 'pointer' : 'not-allowed';
    }
}

  onHide() {
    this._cleanupHandlers();
  }

  _registerHandler(event, handler) {
    this.app.network.on(event, handler);
    this._networkHandlers.push({ event, handler });
  }

  _cleanupHandlers() {
    for (const { event, handler } of this._networkHandlers) {
      this.app.network.off(event, handler);
    }
    this._networkHandlers = [];
  }

  _updateLockUI() {
    const lockIcon = document.getElementById('lockIcon');
    const lockText = document.getElementById('lockText');
    const lockBtn = document.getElementById('btnToggleLock');

    // SVG icons for cleaner look
    const lockedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    const openSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

    if (lockBtn) {
      if (lockIcon) lockIcon.innerHTML = this.teamsLocked ? lockedSvg : openSvg;
      if (lockText) lockText.textContent = this.teamsLocked ? 'Kilidi Aç' : 'Takımları Kilitle';

      // Visual button state change
      if (this.teamsLocked) {
        lockBtn.classList.remove('btn-secondary');
        lockBtn.classList.add('btn-danger');
      } else {
        lockBtn.classList.add('btn-secondary');
        lockBtn.classList.remove('btn-danger');
      }
    }

    // Re-evaluate admin visibility after lock change
    this._updateAdminVisibility(this.roomData);
  }

  _updatePlayers(players) {
    const redTeam = players.filter(p => p.team === 'red');
    const blueTeam = players.filter(p => p.team === 'blue');
    const specs = players.filter(p => p.team === 'spectator');

    const myId = this.app.network.playerId;
    const isAdmin = players.find(p => p.id === myId)?.isAdmin;

    const renderPlayerList = (list, emptyText, emptyKind) => {
      if (list.length === 0) {
        const emptyIcon = emptyKind === 'camera'
          ? `<img src="/assets/video_camera.png" alt="" />`
          : `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
        return `<div class="player-empty">
          ${emptyIcon}
          <span>${emptyText}</span>
        </div>`;
      }
      return list.map(p => {
        const isSelf = p.id === myId;
        const avatarBg = p.team === 'red' ? 'var(--red)' : (p.team === 'blue' ? 'var(--blue)' : 'var(--surface-3)');

        return `
        <div class="team-player ${isAdmin ? 'admin-draggable' : ''} ${isSelf ? 'is-self' : ''}" data-player-id="${p.id}" draggable="${isAdmin ? 'true' : 'false'}">
          <div class="team-player-avatar" style="background:${avatarBg}; color:#0A0A0F; border:2px solid var(--stroke);${isSelf ? ' outline:2px solid var(--white); outline-offset:-1px;' : ''}">
            ${p.avatar || p.name.charAt(0).toUpperCase()}
          </div>
          <span class="team-player-name" style="${isSelf ? 'font-weight:700;' : ''} color:${p.team === 'spectator' ? 'var(--text-2)' : 'var(--white)'};">${this._esc(p.name)}${isSelf ? ' <span style="color:var(--text-muted);">(Ben)</span>' : ''}</span>
          ${p.isAdmin ? '<span class="team-player-admin" title="Admin">👑</span>' : ''}
          ${isAdmin && !p.isAdmin ? `
            <div style="display:flex; gap:4px;">
              <button class="btn-icon btn-kick" data-kick-id="${p.id}" title="Oyuncuyu odadan at" style="padding:2px 6px; font-size:12px;">🦵</button>
              <button class="btn-icon btn-ban" data-ban-id="${p.id}" title="Oyuncuyu banla" style="padding:2px 6px; font-size:10px;">✕</button>
            </div>
          ` : ''}
        </div>
      `;
      }).join('');
    };

    const redEl = document.getElementById('redPlayers');
    const blueEl = document.getElementById('bluePlayers');
    const specEl = document.getElementById('spectatorPlayers');

    if (redEl) redEl.innerHTML = renderPlayerList(redTeam, 'Takımda oyuncu yok', 'players');
    if (blueEl) blueEl.innerHTML = renderPlayerList(blueTeam, 'Takımda oyuncu yok', 'players');
    if (specEl) specEl.innerHTML = renderPlayerList(specs, 'İzleyici yok', 'camera');

    // Admin kick buttons need re-binding as elements are new
    if (isAdmin) {
      this._setupKickButtons();
    }
  }

  _setupDragDrop() {
    const columns = document.querySelectorAll('.team-column');
    columns.forEach(col => {
      // Use delegated events or just ensure we don't add multiple times
      if (col._hasDragHandlers) return;
      col._hasDragHandlers = true;

      col.addEventListener('dragover', (e) => {
        const myId = this.app.network.playerId;
        const isAdmin = this.roomData?.players?.find(p => p.id === myId)?.isAdmin;
        if (!isAdmin) return;

        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => {
        col.classList.remove('drag-over');
      });
      col.addEventListener('drop', (e) => {
        const myId = this.app.network.playerId;
        const isAdmin = this.roomData?.players?.find(p => p.id === myId)?.isAdmin;
        if (!isAdmin) return;

        e.preventDefault();
        col.classList.remove('drag-over');
        const playerId = e.dataTransfer.getData('text/plain');
        let targetTeam = 'spectator';
        if (col.id === 'teamRed') targetTeam = 'red';
        else if (col.id === 'teamBlue') targetTeam = 'blue';

        this.app.network.socket.emit('adminMovePlayer', { playerId, team: targetTeam });
      });
    });

    // Global Draggable start/end (Add ONLY once)
    if (!this._globalDragHandlersAdded) {
      this._globalDragHandlersAdded = true;
      document.addEventListener('dragstart', (e) => {
        if (e.target.classList?.contains('admin-draggable')) {
          e.dataTransfer.setData('text/plain', e.target.dataset.playerId);
          e.target.style.opacity = '0.5';
        }
      });
      document.addEventListener('dragend', (e) => {
        if (e.target.classList?.contains('admin-draggable')) {
          e.target.style.opacity = '1';
        }
      });
    }
  }

  _setupKickButtons() {
    // Kick first, then ban. Use confirm-with-reason modal.
    document.querySelectorAll('.btn-kick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.kickId;
        this.app.ui.showConfirmWithReason('Bu oyuncuyu odadan atmak istediğinize emin misiniz?', (reason) => {
          this.app.network.kickPlayer(playerId, reason || 'Kicked by admin');
        }, { placeholder: 'Sebep (opsiyonel)', confirmText: 'At', danger: true });
      });
    });

    document.querySelectorAll('.btn-ban').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.banId;
        this.app.ui.showConfirmWithReason('Bu oyuncuyu banlamak istediğinize emin misiniz?', (reason) => {
          this.app.network.banPlayer(playerId, reason || 'Banned by admin');
        }, { placeholder: 'Ban sebebi (opsiyonel)', confirmText: 'Banla', danger: true });
      });
    });
  }
  _sendChat() {
    const input = document.getElementById('lobbyChatInput');
    if (!input) return;
    const msg = input.value.trim();
    if (msg) {
      this.app.network.sendChat(msg);
      input.value = '';
    } else {
      input.value = '';
      input.blur();
    }
    // NOTE: Don't add own message here! Server will broadcast it back to us.
  }

  _addChatMessage(data) {
    const container = document.getElementById('lobbyChatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'chat-message';

    if (data.system) {
      div.className += ' chat-message-system';
      div.textContent = data.message;
    } else {
      const teamColor = data.team === 'red' ? 'var(--red)' : data.team === 'blue' ? 'var(--blue)' : 'var(--text-2)';
      div.innerHTML = `<span class="chat-message-author" style="color:${teamColor}">${this._esc(data.playerName)}</span>: ${this._esc(data.message)}`;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  _addSystemMessage(text) {
    this._addChatMessage({ message: text, system: true });
  }

  _updateOvertimeUI() {
    const txtEl = document.getElementById('overtimeText');
    const btnEl = document.getElementById('btnToggleOvertime');
    if (txtEl) txtEl.textContent = this.overtimeEnabled ? 'Uzatma Var' : 'Uzatma Yok';
    if (btnEl) {
      btnEl.classList.toggle('on', !!this.overtimeEnabled);
      btnEl.classList.toggle('off', !this.overtimeEnabled);
    }
  }    _setupJerseySelector() {
    // Track selected jersey per team - persist across re-renders
    const saved = localStorage.getItem('gokball_selectedJersey');
    this._selectedJersey = saved ? JSON.parse(saved) : { red: -1, blue: -1 };

    // Jersey presets with flag images
    const presets = [
      { name: 'Galatasaray', angle: 0, avatarColor: 'FFFFFF', colors: ['F28C28','8A1538'], flag: '/assets/tr.png' },
      { name: 'Fenerbahçe', angle: 0, avatarColor: 'FFFFFF', colors: ['FFC900','002D72','FFC900'], flag: '/assets/tr.png' },
      { name: 'Beşiktaş', angle: 0, avatarColor: '111111', colors: ['FFFFFF'], flag: '/assets/tr.png' },
      { name: 'Trabzonspor', angle: 0, avatarColor: 'FFFFFF', colors: ['7A1731','2A9FD6','7A1731'], flag: '/assets/tr.png' },
      { name: 'Rizespor', angle: 0, avatarColor: 'FFFFFF', colors: ['13107A','00945F','13107A'], flag: '/assets/tr.png' },
      { name: 'Real Madrid', angle: 0, avatarColor: '143832', colors: ['FFFFFF'], flag: '/assets/es.png' },
      { name: 'Barcelona', angle: 0, avatarColor: 'FFCF30', colors: ['2C3F83','781028'], flag: '/assets/es.png' },
      { name: 'Atlético Madrid', angle: 0, avatarColor: '0f5ac5', colors: ['FFFFFF','D40424','FFFFFF'], flag: '/assets/es.png' },
      { name: 'Manchester United', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Manchester City', angle: 0, avatarColor: 'FFFFFF', colors: ['6CABDD'], flag: '/assets/uk.png' },
      { name: 'Liverpool', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Arsenal', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Chelsea', angle: 0, avatarColor: 'eecc1d', colors: ['034694'], flag: '/assets/uk.png' },
      { name: 'Aston Villa', angle: 0, avatarColor: 'bbd2f2', colors: ['6E303F'], flag: '/assets/uk.png' },
      { name: 'Juventus', angle: 0, avatarColor: 'd4be88', colors: ['000000','FFFFFF','000000'], flag: '/assets/it.png' },
      { name: 'Inter Milan', angle: 0, avatarColor: 'f0ba56', colors: ['0068A8','000000','0068A8'], flag: '/assets/it.png' },
      { name: 'AC Milan', angle: 0, avatarColor: 'FFFFFF', colors: ['000000','AC1F2D','000000'], flag: '/assets/it.png' },
      { name: 'Bayern Munich', angle: 0, avatarColor: 'FFFFFF', colors: ['DC052D'], flag: '/assets/de.png' },
      { name: 'Borussia Dortmund', angle: 0, avatarColor: '000000', colors: ['FDE100'], flag: '/assets/de.png' },
      { name: 'Paris Saint-Germain', angle: 0, avatarColor: 'FFFFFF', colors: ['002A8A','DC0B28','002A8A'], flag: '/assets/fr.png' },
      { name: 'Türkiye', angle: 0, avatarColor: 'FFFFFF', colors: ['D0021B'], flag: '/assets/globe.png' },
      { name: 'Arjantin', angle: 0, avatarColor: '000000', colors: ['75AADB','FFFFFF','75AADB'], flag: '/assets/globe.png' },
      { name: 'İspanya', angle: 0, avatarColor: 'F1BF00', colors: ['AA151B'], flag: '/assets/globe.png' },
      { name: 'Fransa', angle: 0, avatarColor: 'FFFFFF', colors: ['243567'], flag: '/assets/globe.png' },
      { name: 'İngiltere', angle: 0, avatarColor: '000000', colors: ['DEE2E5'], flag: '/assets/globe.png' },
      { name: 'İtalya', angle: 0, avatarColor: 'FFFFFF', colors: ['0067B1'], flag: '/assets/globe.png' },
      { name: 'Portekiz', angle: 0, avatarColor: 'FFFFFF', colors: ['9D2639'], flag: '/assets/globe.png' },
      { name: 'Brezilya', angle: 0, avatarColor: '0f4a36', colors: ['EED04B'], flag: '/assets/globe.png' },
      { name: 'Almanya', angle: 90, avatarColor: 'FFFFFF', colors: ['000000','DD0000','FFCE00'], flag: '/assets/globe.png' },
    ];

    // Build a dropdown for a given team ('red' or 'blue')
    const buildDropdown = (team, dropdownId) => {
      const dropdown = document.getElementById(dropdownId);
      if (!dropdown) return;

      const renderItems = () => {
        const myId = this.app.network.playerId;
        const isAdmin = this.roomData?.players?.find(p => p.id === myId)?.isAdmin;

        dropdown.innerHTML = presets.map((p, i) => {
          const flagHtml = `<img src="${p.flag}" style="width:16px; height:16px; border-radius:2px; object-fit:cover; flex-shrink:0;" />`;
          const isSelected = this._selectedJersey[team] === i;
          const checkHtml = isSelected ? `<span style="margin-left:auto; color:var(--green); font-weight:bold; font-size:14px;">✓</span>` : '';
          const bgStyle = isSelected ? 'background:rgba(255,255,255,0.10);' : '';
          const cursorStyle = isAdmin ? 'cursor:pointer;' : 'cursor:default; opacity:0.7;';
          return `
            <div class="jersey-preset-item" data-idx="${i}" style="display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; ${cursorStyle} transition:background 0.15s; font-size:13px; color:var(--text-primary);${bgStyle}">
              ${flagHtml}
              <span>${p.name}</span>
              ${checkHtml}
            </div>
          `;
        }).join('');

        // Hover + click (admin only)
        if (isAdmin) {
          dropdown.querySelectorAll('.jersey-preset-item').forEach(item => {
            item.addEventListener('mouseenter', () => { if (this._selectedJersey[team] !== parseInt(item.dataset.idx)) item.style.background = 'rgba(255,255,255,0.08)'; });
            item.addEventListener('mouseleave', () => { if (this._selectedJersey[team] !== parseInt(item.dataset.idx)) item.style.background = ''; });
            item.addEventListener('click', () => {
              const idx = parseInt(item.dataset.idx);
              const preset = presets[idx];
              if (!preset) return;

              // Track selection
              this._selectedJersey[team] = idx;
              localStorage.setItem('gokball_selectedJersey', JSON.stringify(this._selectedJersey));

              // Apply colors directly via socket event (max 3 colors)
              this.app.network.socket.emit('setTeamColors', {
                team: team,
                angle: preset.angle,
                avatarColor: preset.avatarColor,
                colors: preset.colors.slice(0, 3)
              });

              // Re-render to show checkmark
              renderItems();
              dropdown.style.display = 'none';
            });
          });
        }
      };
      renderItems();
    };

    // Build both dropdowns
    buildDropdown('red', 'jerseyDropdownRed');
    buildDropdown('blue', 'jerseyDropdownBlue');

    // Toggle handlers
    const setupToggle = (btnId, dropdownId, wrapperId) => {
      const btn = document.getElementById(btnId);
      const dropdown = document.getElementById(dropdownId);
      const wrapper = document.getElementById(wrapperId);
      if (!btn || !dropdown) return;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other dropdown
        document.querySelectorAll('.jersey-dropdown').forEach(d => {
          if (d !== dropdown) d.style.display = 'none';
        });
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
      });
    };

    setupToggle('btnJerseyRed', 'jerseyDropdownRed', 'jerseyRedWrapper');
    setupToggle('btnJerseyBlue', 'jerseyDropdownBlue', 'jerseyBlueWrapper');

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#jerseyRedWrapper') && !e.target.closest('#jerseyBlueWrapper')) {
        document.querySelectorAll('.jersey-dropdown').forEach(d => d.style.display = 'none');
      }
    });
  }

  _isCurrentPlayerAdmin() {
    const myId = this.app.network.playerId;
    return this.roomData?.players?.find(p => p.id === myId)?.isAdmin || false;
  }

  _esc(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }
}
