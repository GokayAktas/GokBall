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
      <div style="display: flex; gap: 20px; width: 100%; max-width: 1350px; margin: 0 auto; min-height: 600px;">
        <div class="lobby-new-layout" style="flex: 1;">
          <div class="lobby-new-header">
            <div class="header-titles">
              <h2 id="roomTitle">${this._esc(data?.roomName || 'Oda')}</h2>
              <div class="header-sub">${this._esc(data?.stadium?.name || 'Klasik')} • <span id="playerCount">${data?.players?.length || 0}</span> Oyuncu</div>
            </div>
            <button class="btn btn-danger btn-sm" id="btnLeave" style="font-weight: 700; display:flex; gap:6px; align-items:center; border-radius: 20px; padding: 6px 16px;">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
               </svg>
               AYRIL
            </button>
          </div>
          
          <div class="lobby-divider"></div>

          <div class="lobby-teams-grid">
            <!-- Red Team -->
            <div class="team-card team-column red" id="teamRed">
              <div class="team-header red" style="display:flex; justify-content:space-between; align-items:center;">
                 <div style="display:flex; align-items:center; gap:10px;">
                    <div class="team-title"><span class="team-dot red"></span> Kırmızı</div>
                    <button class="btn btn-secondary btn-xs team-join-btn" id="btnJoinRed" style="padding: 2px 8px;">Katıl</button>
                    <div style="position:relative;" id="jerseyRedWrapper">
                      <button class="btn btn-xs" id="btnJerseyRed" style="padding:2px 8px; background:rgba(231,76,60,0.15); border:1px solid rgba(231,76,60,0.3); border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px; white-space:nowrap;" title="Kırmızı Forma Seç">
                        <img src="/assets/red_shirt.png" style="width:16px; height:16px;" />
                        <span style="font-size:11px; color:rgba(255,255,255,0.7);">Forma Seç</span>
                      </button>
                      <div id="jerseyDropdownRed" class="jersey-dropdown" style="display:none; position:absolute; top:calc(100% + 6px); left:0; background: rgba(10,20,40,0.95); backdrop-filter:blur(16px); border:1px solid var(--border-color); border-radius:12px; padding:8px; max-height:400px; overflow-y:auto; min-width:240px; z-index:100; box-shadow:var(--shadow-lg);"></div>
                    </div>
                 </div>
                 <button class="btn btn-xs team-clear-btn" id="btnClearRed" style="display:none; background:var(--bg-glass); color:var(--text-primary); border:none; padding:4px; border-radius:4px; cursor:pointer;" title="Kırmızı Takımı Boşalt">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>
              </div>
              <div class="player-list" id="redPlayers"></div>
            </div>

            <!-- Spectators -->
            <div class="team-card team-column spectator" id="teamSpectator">
              <div class="team-header spectator">
                 <div class="team-title"><span class="team-icon">👁️</span> İzleyiciler</div>
                 <div style="display:flex; gap: 5px;">
                   <button class="btn btn-xs" id="btnJoinAuto" style="display:none; background: linear-gradient(135deg, var(--accent-purple), var(--accent-royal)); color:var(--text-primary); border:none; padding:4px 8px; border-radius:6px; font-size:16px; cursor:pointer; box-shadow: var(--shadow-sm);" title="Takımları Rastgele Karıştır (Sadece Admin)">🎲</button>
                   <button class="btn btn-secondary btn-xs team-join-btn" id="btnJoinSpectator">İzle</button>
                 </div>
              </div>
              <div class="player-list" id="spectatorPlayers"></div>
            </div>

            <!-- Blue Team -->
            <div class="team-card team-column blue" id="teamBlue">
              <div class="team-header blue" style="display:flex; justify-content:space-between; align-items:center; flex-direction:row-reverse;">
                 <div style="display:flex; align-items:center; gap:10px; flex-direction:row-reverse;">
                    <div class="team-title" style="flex-direction:row-reverse"><span class="team-dot blue"></span> Mavi</div>
                    <button class="btn btn-secondary btn-xs team-join-btn" id="btnJoinBlue" style="padding: 2px 8px;">Katıl</button>
                    <div style="position:relative;" id="jerseyBlueWrapper">
                      <button class="btn btn-xs" id="btnJerseyBlue" style="padding:2px 8px; background:rgba(52,152,219,0.15); border:1px solid rgba(52,152,219,0.3); border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px; white-space:nowrap;" title="Mavi Forma Seç">
                        <span style="font-size:11px; color:rgba(255,255,255,0.7);">Forma Seç</span>
                        <img src="/assets/blue_shirt.png" style="width:16px; height:16px;" />
                      </button>
                      <div id="jerseyDropdownBlue" class="jersey-dropdown" style="display:none; position:absolute; top:calc(100% + 6px); right:0; background: rgba(10,20,40,0.95); backdrop-filter:blur(16px); border:1px solid var(--border-color); border-radius:12px; padding:8px; max-height:400px; overflow-y:auto; min-width:240px; z-index:100; box-shadow:var(--shadow-lg);"></div>
                    </div>
                 </div>
                 <button class="btn btn-xs team-clear-btn" id="btnClearBlue" style="display:none; background:var(--bg-glass); color:var(--text-primary); border:none; padding:4px; border-radius:4px; cursor:pointer;" title="Mavi Takımı Boşalt">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(180deg)"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>
              </div>
              <div class="player-list" id="bluePlayers"></div>
            </div>
          </div>

          <div class="lobby-info-row">
            <div>Süre Limiti: <span id="timeLimitInfo">${data?.game?.timeLimit === 0 ? '∞' : Math.floor((data?.game?.timeLimit || 180) / 60)}</span> dk</div>
            <div>Skor Limiti: <span id="scoreLimitInfo">${data?.game?.scoreLimit === 0 ? '∞' : (data?.game?.scoreLimit || 3)}</span></div>
            <div>Oyuncu Hızı: <span id="speedInfo">x${(data?.playerSpeedMultiplier || 1.0).toFixed(2)}</span></div>
            <div>Saha: <span id="stadiumName">${this._esc(data?.stadium?.name || 'Klasik')}</span></div>
          </div>

          <div id="adminPanel" style="display:none; width: 100%; margin-top: 20px;">
            <button class="btn btn-primary btn-block btn-lg" id="btnStartGame" style="font-weight: 800; font-size: 16px; letter-spacing: 1px; border-radius: 8px;">OYUNU BAŞLAT</button>
            
            <!-- Admin Tools -->
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; justify-content: center; margin-top: 20px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 12px;">
              <button class="btn btn-secondary btn-sm" id="btnToggleLock" style="display:flex; align-items:center; gap:6px; height:36px; border-radius: 10px;">
                 <span id="lockIcon"></span> <span id="lockText">Takımları Kilitle</span>
              </button>
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                 <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">SAHA</span>
                 <select id="lobbyStadiumSelect" class="input" style="padding: 6px 32px 6px 10px; font-size: 12px; height: 34px; min-width: 110px; border-radius: 10px; background-color: rgba(15,82,186,0.1);">
                   <option value="small">Küçük (1v1)</option>
                   <option value="futsal">Futsal (3v3)</option>
                   <option value="classic">Klasik (3v3)</option>
                   <option value="big">Büyük (5v5)</option>
                   <option value="huge">Devasa (7v7)</option>
                   <option value="custom" disabled hidden>Özel Saha</option>
                 </select>
              </div>
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                 <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">GOL LİMİTİ</span>
                 <select id="lobbyScoreLimit" class="input" style="padding: 6px 32px 6px 10px; font-size: 12px; height: 34px; min-width: 90px; border-radius: 10px; background-color: rgba(231,76,60,0.1);">
                   <option value="1">1 Gol</option><option value="3">3 Gol</option><option value="5">5 Gol</option><option value="10">10 Gol</option><option value="0">Sınırsız</option>
                 </select>
              </div>
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                 <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">SÜRE</span>
                 <select id="lobbyTimeLimit" class="input" style="padding: 6px 32px 6px 10px; font-size: 12px; height: 34px; min-width: 100px; border-radius: 10px; background-color: rgba(46,204,113,0.1);">
                   <option value="60">1 Dakika</option><option value="180">3 Dakika</option><option value="300">5 Dakika</option><option value="600">10 Dakika</option><option value="0">Sınırsız</option>
                 </select>
              </div>
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                 <span style="font-size:10px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px;">HIZ</span>
                 <select id="lobbySpeedMultiplier" class="input" style="padding: 6px 32px 6px 10px; font-size: 12px; height: 34px; min-width: 90px; border-radius: 10px; background-color: rgba(241,196,15,0.1);">
                   <option value="0.50">x0.50</option>
                   <option value="0.75">x0.75</option>
                   <option value="1.00">x1.00</option>
                   <option value="1.25">x1.25</option>
                   <option value="1.50">x1.50</option>
                   <option value="1.75">x1.75</option>
                   <option value="2.00">x2.00</option>
                 </select>
              </div>
              <button class="btn btn-sm" id="btnToggleOvertime" style="display:flex; align-items:center; gap:6px; height:36px; background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.3); color: #ffd54f; border-radius: 10px;">
                ⏱ <span id="overtimeText">Uzatma Var</span>
              </button>
              <label class="btn btn-secondary btn-sm" style="cursor:pointer; padding: 4px 8px; height:36px; border-radius: 10px;">
                📁 Saha Yükle
                <input type="file" id="lobbyHbsUpload" accept=".hbs" style="display:none;" />
              </label>
            </div>
          </div>
        </div>

        <div class="lobby-chat-sidebar" style="width: 350px; display: flex; flex-direction: column; background: var(--bg-secondary); border-radius: 16px; border: 1px solid var(--border-color); box-shadow: var(--shadow-md); padding: 20px;">
          <h3 style="margin-top:0; margin-bottom:15px; font-size: 18px; color: var(--text-primary);">💬 Sohbet</h3>
          <div id="lobbyChatMessages" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 5px; margin-bottom: 15px; font-size: 13px;"></div>
          <div style="display:flex; gap: 8px;">
            <input type="text" id="lobbyChatInput" class="input" placeholder="Mesaj..." style="flex:1; padding: 10px; border-radius: 8px; font-size: 13px; background: var(--bg-input);" autocomplete="off" />
            <button class="btn btn-primary" id="btnSendChat" style="padding: 0; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
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

    // Jersey (Forma) Selection
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
        if (info) info.textContent = 'x' + parseFloat(data.playerSpeedMultiplier).toFixed(2);
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

    // Join buttons - always show, but disable when locked or game running
    const isGameRunning = data.game && (data.game.state === 'playing' || data.game.state === 'countdown' || data.game.state === 'goal');
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
        lockBtn.style.background = '#e74c3c';
        lockBtn.style.boxShadow = '0 0 15px rgba(231, 76, 60, 0.4)';
      } else {
        lockBtn.classList.add('btn-secondary');
        lockBtn.classList.remove('btn-danger');
        lockBtn.style.background = '';
        lockBtn.style.boxShadow = '';
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

    const renderPlayerList = (list, teamColorVar) => list.map(p => {
      const isSelf = p.id === myId;
      // Priority: Team Color > Self Highlight (sapphire) > Spec/Empty
      const avatarBg = p.team === 'red' ? 'var(--red-team)' : (p.team === 'blue' ? 'var(--blue-team)' : (p.team === 'spectator' ? 'var(--text-muted)' : (isSelf ? 'var(--sapphire)' : 'var(--bg-glass)')));
      const nameColor = p.team === 'spectator' ? 'var(--text-muted)' : (isSelf ? 'var(--ice-blue)' : 'white');

      return `
        <div class="team-player ${isAdmin ? 'admin-draggable' : ''} ${isSelf ? 'is-self' : ''}" data-player-id="${p.id}" draggable="${isAdmin ? 'true' : 'false'}">
          <div class="team-player-avatar" style="background:${avatarBg}; color: white; border: ${isSelf ? '2px solid white' : 'none'};">
            ${p.avatar || p.name.charAt(0).toUpperCase()}
          </div>
          <span class="team-player-name" style="${isSelf ? 'font-weight:bold;' : ''} color:${nameColor};">${this._esc(p.name)} ${isSelf ? '(Ben)' : ''}</span>
          ${p.isAdmin ? '<span class="team-player-admin">👑</span>' : ''}
          ${isAdmin && !p.isAdmin ? `
            <div style="margin-left:auto; display:flex; gap:4px;">
              <button class="btn-icon btn-kick" data-kick-id="${p.id}" title="Oyuncuyu odadan at" style="padding:2px 4px; font-size:12px;">🦵</button>
              <button class="btn-icon btn-ban" data-ban-id="${p.id}" title="Oyuncuyu banla" style="padding:2px 4px; font-size:10px;">✕</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    const redEl = document.getElementById('redPlayers');
    const blueEl = document.getElementById('bluePlayers');
    const specEl = document.getElementById('spectatorPlayers');

    if (redEl) redEl.innerHTML = renderPlayerList(redTeam, 'var(--red-team)');
    if (blueEl) blueEl.innerHTML = renderPlayerList(blueTeam, 'var(--blue-team)');
    if (specEl) specEl.innerHTML = renderPlayerList(specs, 'var(--text-muted)');

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
        col.style.borderColor = 'var(--sapphire)';
      });
      col.addEventListener('dragleave', () => {
        col.style.borderColor = '';
      });
      col.addEventListener('drop', (e) => {
        const myId = this.app.network.playerId;
        const isAdmin = this.roomData?.players?.find(p => p.id === myId)?.isAdmin;
        if (!isAdmin) return;

        e.preventDefault();
        col.style.borderColor = '';
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
      const teamColor = data.team === 'red' ? 'var(--red-team)' : data.team === 'blue' ? 'var(--blue-team)' : 'var(--text-secondary)';
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
      if (this.overtimeEnabled) {
        btnEl.style.background = 'rgba(255, 193, 7, 0.15)';
        btnEl.style.borderColor = 'rgba(255, 193, 7, 0.3)';
        btnEl.style.color = '#ffd54f';
      } else {
        btnEl.style.background = 'rgba(255, 255, 255, 0.05)';
        btnEl.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        btnEl.style.color = 'rgba(255, 255, 255, 0.4)';
      }
    }
  }    _setupJerseySelector() {
    // Track selected jersey per team - persist across re-renders
    const saved = localStorage.getItem('gokball_selectedJersey');
    this._selectedJersey = saved ? JSON.parse(saved) : { red: -1, blue: -1 };

    // Jersey presets with flag images
    const presets = [
      { name: 'Galatasaray', angle: 0, avatarColor: 'FFFFFF', colors: ['F28C28','8A1538'], flag: '/assets/tr.png' },
      { name: 'Fenerbahçe', angle: 0, avatarColor: 'FFFFFF', colors: ['FFC900','002D72'], flag: '/assets/tr.png' },
      { name: 'Beşiktaş', angle: 0, avatarColor: '111111', colors: ['FFFFFF'], flag: '/assets/tr.png' },
      { name: 'Trabzonspor', angle: 0, avatarColor: 'FFFFFF', colors: ['7A1731','2A9FD6'], flag: '/assets/tr.png' },
      { name: 'Rizespor', angle: 0, avatarColor: 'FFFFFF', colors: ['13107A','00945F'], flag: '/assets/tr.png' },
      { name: 'Manchester United', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Manchester City', angle: 0, avatarColor: 'FFFFFF', colors: ['6CABDD'], flag: '/assets/uk.png' },
      { name: 'Liverpool', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Arsenal', angle: 0, avatarColor: 'FFFFFF', colors: ['DA291C'], flag: '/assets/uk.png' },
      { name: 'Chelsea', angle: 0, avatarColor: 'eecc1d', colors: ['034694'], flag: '/assets/uk.png' },
      { name: 'Aston Villa', angle: 0, avatarColor: 'bbd2f2', colors: ['6E303F'], flag: '/assets/uk.png' },
      { name: 'Real Madrid', angle: 0, avatarColor: '143832', colors: ['FFFFFF'], flag: '/assets/es.png' },
      { name: 'Barcelona', angle: 0, avatarColor: 'dd9721', colors: ['2C3F83','781028'], flag: '/assets/es.png' },
      { name: 'Atlético Madrid', angle: 0, avatarColor: '0f5ac5', colors: ['FFFFFF','D40424'], flag: '/assets/es.png' },
      { name: 'Juventus', angle: 0, avatarColor: 'd4be88', colors: ['000000','FFFFFF'], flag: '/assets/it.png' },
      { name: 'Inter Milan', angle: 0, avatarColor: 'f0ba56', colors: ['0068A8','000000'], flag: '/assets/it.png' },
      { name: 'AC Milan', angle: 0, avatarColor: 'FFFFFF', colors: ['000000','AC1F2D'], flag: '/assets/it.png' },
      { name: 'Bayern Munich', angle: 0, avatarColor: 'FFFFFF', colors: ['DC052D'], flag: '/assets/de.png' },
      { name: 'Borussia Dortmund', angle: 0, avatarColor: '000000', colors: ['FDE100'], flag: '/assets/de.png' },
      { name: 'Paris Saint-Germain', angle: 0, avatarColor: 'FFFFFF', colors: ['002A8A','DC0B28'], flag: '/assets/fr.png' },
      { name: 'Türkiye', angle: 0, avatarColor: 'FFFFFF', colors: ['D0021B'], flag: '/assets/globe.png' },
      { name: 'Arjantin', angle: 0, avatarColor: '000000', colors: ['75AADB','FFFFFF'], flag: '/assets/globe.png' },
      { name: 'İspanya', angle: 0, avatarColor: 'F1BF00', colors: ['AA151B'], flag: '/assets/globe.png' },
      { name: 'Fransa', angle: 0, avatarColor: 'FFFFFF', colors: ['243567'], flag: '/assets/globe.png' },
      { name: 'İngiltere', angle: 0, avatarColor: '000000', colors: ['DEE2E5'], flag: '/assets/globe.png' },
      { name: 'İtalya', angle: 0, avatarColor: 'FFFFFF', colors: ['0067B1'], flag: '/assets/globe.png' },
      { name: 'Portekiz', angle: 0, avatarColor: 'FFFFFF', colors: ['9D2639'], flag: '/assets/globe.png' },
      { name: 'Brezilya', angle: 0, avatarColor: '0f4a36', colors: ['EED04B'], flag: '/assets/globe.png' },
      { name: 'Almanya', angle: 90, avatarColor: 'FFFFFF', colors: ['DD0000','FFCE00'], flag: '/assets/globe.png' },
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
          const checkHtml = isSelected ? `<span style="margin-left:auto; color:#4ade80; font-weight:bold; font-size:14px;">✓</span>` : '';
          const bgStyle = isSelected ? 'background:rgba(15,82,186,0.25);' : '';
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
            item.addEventListener('mouseenter', () => { if (this._selectedJersey[team] !== parseInt(item.dataset.idx)) item.style.background = 'rgba(15,82,186,0.2)'; });
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
