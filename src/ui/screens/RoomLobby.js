/**
 * Room Lobby Screen - Team picker, player list, chat, admin controls
 */
import JSON5 from 'json5';

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
                 </div>
                 <button class="btn btn-xs team-clear-btn" id="btnClearRed" style="display:none; background:rgba(0,0,0,0.3); color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;" title="Kırmızı Takımı Boşalt">
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
                   <button class="btn btn-xs" id="btnJoinAuto" style="display:none; background:linear-gradient(135deg, #FF9A9E, #FECFEF); color:#333; border:none; padding:4px 8px; border-radius:6px; font-size:16px; cursor:pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" title="Takımları Rastgele Karıştır (Sadece Admin)">🎲</button>
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
                 </div>
                 <button class="btn btn-xs team-clear-btn" id="btnClearBlue" style="display:none; background:rgba(0,0,0,0.3); color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;" title="Mavi Takımı Boşalt">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(180deg)"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>
              </div>
              <div class="player-list" id="bluePlayers"></div>
            </div>
          </div>

          <div class="lobby-info-row">
            <div>Süre Limiti: <span id="timeLimitInfo">${data?.game?.timeLimit === 0 ? '∞' : Math.floor((data?.game?.timeLimit || 180) / 60)}</span> dk</div>
            <div>Skor Limiti: <span id="scoreLimitInfo">${data?.game?.scoreLimit === 0 ? '∞' : (data?.game?.scoreLimit || 3)}</span></div>
            <div>Saha: <span id="stadiumName">${this._esc(data?.stadium?.name || 'Klasik')}</span></div>
          </div>

          <div id="adminPanel" style="display:none; width: 100%; margin-top: 20px;">
            <button class="btn btn-primary btn-block btn-lg" id="btnStartGame" style="font-weight: 800; font-size: 16px; letter-spacing: 1px; border-radius: 8px;">OYUNU BAŞLAT</button>
            
            <!-- Admin Tools -->
            <div style="display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: center; justify-content: center; margin-top: 20px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 12px;">
              <button class="btn btn-secondary btn-sm" id="btnToggleLock" style="display:flex; align-items:center; gap:6px;">
                 <span id="lockIcon"></span> <span id="lockText">Takım Kilitle</span>
              </button>
              <select id="lobbyStadiumSelect" class="input" style="padding: 4px 8px; font-size: 11px; height: 32px; min-width: 100px;">
                 <option value="small">Küçük (1v1)</option>
                 <option value="classic">Klasik (3v3)</option>
                 <option value="big">Büyük (5v5)</option>
                 <option value="huge">Devasa (7v7)</option>
              </select>
              <select id="lobbyScoreLimit" class="input" style="padding: 4px 24px 4px 8px; font-size: 11px; height: 32px; min-width: 80px;">
                 <option value="1">1 Gol</option><option value="3">3 Gol</option><option value="5">5 Gol</option><option value="10">10 Gol</option><option value="0">Sınırsız</option>
              </select>
              <select id="lobbyTimeLimit" class="input" style="padding: 4px 8px; font-size: 11px; height: 32px; min-width: 90px;">
                 <option value="60">1 Dakika</option><option value="180">3 Dakika</option><option value="300">5 Dakika</option><option value="600">10 Dakika</option><option value="0">Sınırsız</option>
              </select>
              <button class="btn btn-sm" id="btnToggleOvertime" style="display:flex; align-items:center; gap:6px; background: rgba(255, 193, 7, 0.15); border: 1px solid rgba(255, 193, 7, 0.3); color: #ffd54f;">
                ⏱ <span id="overtimeText">Uzatma Var</span>
              </button>
              <label class="btn btn-secondary btn-sm" style="cursor:pointer; padding: 4px 8px; height:32px;">
                📁 Saha Yükle
                <input type="file" id="lobbyHbsUpload" accept=".hbs" style="display:none;" />
              </label>
            </div>
          </div>
        </div>

        <div class="lobby-chat-sidebar" style="width: 350px; display: flex; flex-direction: column; background: #0B132B; border-radius: 16px; border: 1px solid rgba(255,255,255,0.03); box-shadow: 0 8px 32px rgba(0,0,0,0.4); padding: 20px;">
          <h3 style="margin-top:0; margin-bottom:15px; font-size: 18px; color: white;">💬 Sohbet</h3>
          <div id="lobbyChatMessages" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 5px; margin-bottom: 15px; font-size: 13px;"></div>
          <div style="display:flex; gap: 8px;">
            <input type="text" id="lobbyChatInput" class="input" placeholder="Mesaj..." style="flex:1; padding: 10px; border-radius: 8px; font-size: 13px; background: rgba(0,0,0,0.2);" autocomplete="off" />
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
    this._updateLockUI();
    this._updateAdminVisibility(data);

    // Leave button
    document.getElementById('btnLeave')?.addEventListener('click', () => {
      this.app.leaveRoom();
    });

    // Team buttons
    document.getElementById('btnJoinRed')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
        return;
      }
      this.app.network.changeTeam('red');
    });
    document.getElementById('btnJoinBlue')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
        return;
      }
      this.app.network.changeTeam('blue');
    });
    document.getElementById('btnJoinSpectator')?.addEventListener('click', () => {
      if (this.teamsLocked) {
        alert('Takımlar kilitli! Admin kilidi açana kadar bekleyin.');
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

    // Lobby stadium change
    const stadiumSelect = document.getElementById('lobbyStadiumSelect');
    if (stadiumSelect) {
      // Map Turkish name/current name to value
      const currentName = data.stadium?.name;
      if (currentName === 'Küçük') stadiumSelect.value = 'small';
      else if (currentName === 'Klasik') stadiumSelect.value = 'classic';
      else if (currentName === 'Büyük') stadiumSelect.value = 'big';
      else if (currentName === 'Devasa') stadiumSelect.value = 'huge';
      else stadiumSelect.value = 'classic';

      stadiumSelect.addEventListener('change', (e) => {
        this.app.network.changeStadium(e.target.value);
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
      const el = document.getElementById('stadiumName');
      if (el) el.textContent = data.stadium?.name || 'Custom';
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
      if (data.players) {
        this._updatePlayers(data.players);
        const countSpan = document.getElementById('playerCount');
        if (countSpan) countSpan.textContent = data.players.length;
      }
    });
  }

  _updateAdminVisibility(data) {
    const myPlayer = data?.players?.find(p => p.id === this.app.network.playerId);
    const isAdmin = myPlayer?.isAdmin;
    
    // Admin Panel
    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = isAdmin ? '' : 'none';
    
    // Dice Button
    const btnJoinAuto = document.getElementById('btnJoinAuto');
    if (btnJoinAuto) btnJoinAuto.style.display = isAdmin ? '' : 'none';
    
    // Clear Arrows
    const isStopped = !data.game || data.game.state === 'stopped' || data.game.state === 'ended';
    
    const btnClearRed = document.getElementById('btnClearRed');
    if (btnClearRed) btnClearRed.style.display = (isAdmin && isStopped) ? '' : 'none';
    
    const btnClearBlue = document.getElementById('btnClearBlue');
    if (btnClearBlue) btnClearBlue.style.display = (isAdmin && isStopped) ? '' : 'none';
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

    // Disable/enable join buttons for non-admins
    const joinBtns = document.querySelectorAll('.team-join-btn');
    joinBtns.forEach(btn => {
      // Only disable if teams are locked AND current user is not admin
      const myPlayer = this.roomData?.players?.find(p => p.id === this.app.network.playerId);
      const isAdmin = myPlayer?.isAdmin;

      if (this.teamsLocked && !isAdmin) {
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.disabled = true;
      } else {
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.disabled = false;
      }
    });
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
          ${isAdmin && !p.isAdmin ? `<button class="btn-icon btn-kick" data-kick-id="${p.id}" title="Oyuncuyu at" style="margin-left:auto; padding:2px 4px; font-size:10px;">✕</button>` : ''}
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
    document.querySelectorAll('.btn-kick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = btn.dataset.kickId;
        if (confirm('Bu oyuncuyu atmak istediğinize emin misiniz?')) {
          this.app.network.kickPlayer(playerId, 'Kicked by admin');
        }
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
  }

  _esc(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }
}
