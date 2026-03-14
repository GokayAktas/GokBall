/**
 * In-Game Management Menu (Esc)
 */
export class InGameMenu {
    constructor(app) {
        this.app = app;
        this.container = document.createElement('div');
        this.container.id = 'inGameMenuOverlay';
        this.container.className = 'in-game-menu-overlay hidden';
        document.body.appendChild(this.container);
        this.isVisible = false;
    }

    render(roomData) {
        if (!roomData) return;
        const name = roomData.name || (this.app.currentRoomData?.name || "Oda");
        const players = roomData.players || [];
        const me = players.find(p => p.id === this.app.network.playerId);
        const isAdmin = me?.isAdmin;

        const redTeam = players.filter(p => p.team === 'red');
        const blueTeam = players.filter(p => p.team === 'blue');
        const specs = players.filter(p => p.team === 'spectator');

        this.container.innerHTML = `
            <div class="room-mgmt-menu">
                <div class="room-mgmt-header">
                    <div style="display:flex; flex-direction:column;">
                        <span class="room-mgmt-title" style="margin:0;">${name}</span>
                        <span style="font-size:12px; color:rgba(255,255,255,0.4); margin-top:2px;">${roomData.stadiumName || 'Klasik Saha'} • ${players.length} Oyuncu</span>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center;">
                        ${isAdmin ? `
                            <button class="btn ${roomData.teamsLocked ? 'btn-danger' : 'btn-primary'} btn-sm" id="btnToggleLock" title="${roomData.teamsLocked ? 'Takımlar Kilitli' : 'Takımları Kilitle'}">
                                ${roomData.teamsLocked ?
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' :
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'
                }
                            </button>
                        ` : ''}
                        <button class="btn btn-danger btn-sm" id="btnLeaveRoom" style="display:flex; align-items:center; gap:6px; font-weight:700;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                            AYRIL
                        </button>
                    </div>
                </div>
                
                <div class="room-mgmt-grid">
                    <div class="mgmt-column" id="teamRed">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <span style="color:var(--red-team); font-weight:bold;">🔴 Kırmızı</span>
                            ${(!roomData.teamsLocked || isAdmin) ? `<button class="btn btn-secondary btn-xs" id="btnJoinRed" style="font-size:9px;">Katıl</button>` : ''}
                        </div>
                        <div class="player-list" id="redPlayers" style="min-height:100px;">
                            ${redTeam.map(p => `
                                <div class="player-item ${isAdmin ? 'admin-draggable' : ''} ${p.id === this.app.network.playerId ? 'is-self' : ''}" ${isAdmin ? `draggable="true" data-player-id="${p.id}"` : ''} style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <div class="mini-avatar" style="background:var(--red-team);">${p.avatar || p.name[0]}</div>
                                        <span>${p.name} ${p.id === this.app.network.playerId ? '(Ben)' : ''}</span>
                                    </div>
                                    ${isAdmin && p.id !== this.app.network.playerId ? `<button class="kick-btn" data-id="${p.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                                </div>
                            `).join('') || '<div style="color:rgba(255,255,255,0.2); font-size:11px; text-align:center; padding:10px;">Boş</div>'}
                        </div>
                    </div>
                    
                    <div class="mgmt-column" id="teamSpectator">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            <span style="color:var(--text-muted); font-weight:bold;">👁️ İzleyiciler</span>
                            ${(!roomData.teamsLocked || isAdmin) ? `<button class="btn btn-secondary btn-xs" id="btnJoinSpec" style="font-size:9px;">İzle</button>` : ''}
                        </div>
                        <div class="player-list" id="spectatorPlayers" style="min-height:100px;">
                            ${specs.map(p => `
                                <div class="player-item ${isAdmin ? 'admin-draggable' : ''} ${p.id === this.app.network.playerId ? 'is-self' : ''}" ${isAdmin ? `draggable="true" data-player-id="${p.id}"` : ''} style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <div class="mini-avatar" style="background:var(--text-muted);">${p.avatar || p.name[0]}</div>
                                        <span style="color:var(--text-muted);">${p.name} ${p.id === this.app.network.playerId ? '(Ben)' : ''}</span>
                                    </div>
                                    ${isAdmin && p.id !== this.app.network.playerId ? `<button class="kick-btn" data-id="${p.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                                </div>
                            `).join('') || '<div style="color:rgba(255,255,255,0.2); font-size:11px; text-align:center; padding:10px;">Boş</div>'}
                        </div>
                    </div>

                    <div class="mgmt-column" id="teamBlue">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                            ${(!roomData.teamsLocked || isAdmin) ? `<button class="btn btn-secondary btn-xs" id="btnJoinBlue" style="font-size:9px;">Katıl</button>` : ''}
                            <span style="color:var(--blue-team); font-weight:bold;">🔵 Mavi</span>
                        </div>
                        <div class="player-list" id="bluePlayers" style="min-height:100px;">
                            ${blueTeam.map(p => `
                                <div class="player-item ${isAdmin ? 'admin-draggable' : ''} ${p.id === this.app.network.playerId ? 'is-self' : ''}" ${isAdmin ? `draggable="true" data-player-id="${p.id}"` : ''} style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <div class="mini-avatar" style="background:var(--blue-team);">${p.avatar || p.name[0]}</div>
                                        <span>${p.name} ${p.id === this.app.network.playerId ? '(Ben)' : ''}</span>
                                    </div>
                                    ${isAdmin && p.id !== this.app.network.playerId ? `<button class="kick-btn" data-id="${p.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                                </div>
                            `).join('') || '<div style="color:rgba(255,255,255,0.2); font-size:11px; text-align:center; padding:10px;">Boş</div>'}
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; font-size:12px; color:var(--text-secondary);">
                    <div>Süre Limiti: ${Math.floor(roomData.timeLimit / 60)} dk</div>
                    <div>Skor Limiti: ${roomData.scoreLimit}</div>
                    <div>Saha: ${roomData.stadium?.name || 'Klasik'}</div>
                </div>

                <div style="display:flex; flex-direction:column; gap:10px; margin-top:15px;">
                    <button class="btn btn-primary btn-block" id="btnResumeGame" style="font-weight:700; height: 45px; font-size: 16px;">OYUNA DÖN</button>
                    ${isAdmin ? `
                        <button class="btn btn-danger btn-block" id="btnStopGame" style="font-weight:700; height: 40px; display:flex; gap:8px; justify-content:center; align-items:center; background: rgba(231, 76, 60, 0.15); border: 1px solid rgba(231, 76, 60, 0.3); color: #ff7675;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
                            MAÇI DURDUR (LOBİYE DÖN)
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        this._bindEvents(isAdmin);
    }

    _bindEvents(isAdmin) {
        this.container.querySelector('#btnResumeGame')?.addEventListener('click', () => this.hide());
        this.container.querySelector('#btnLeaveRoom')?.addEventListener('click', () => {
            if (confirm('Odadan ayrılmak istediğinize emin misiniz?')) {
                this.app.leaveRoom();
                this.hide();
            }
        });

        this.container.querySelector('#btnJoinRed')?.addEventListener('click', () => this.app.network.changeTeam('red'));
        this.container.querySelector('#btnJoinBlue')?.addEventListener('click', () => this.app.network.changeTeam('blue'));
        this.container.querySelector('#btnJoinSpec')?.addEventListener('click', () => this.app.network.changeTeam('spec'));

        if (isAdmin) {
            this.container.querySelector('#btnStopGame')?.addEventListener('click', () => this.app.network.stopGame());
            // Note: pauseGame might need implementation on server if not present
            this.container.querySelector('#btnPauseGame')?.addEventListener('click', () => this.app.network.socket.emit('pauseGame'));

            this.container.querySelector('#btnToggleLock')?.addEventListener('click', () => {
                this.app.network.socket.emit('toggleTeamLock');
            });

            this.container.querySelectorAll('.kick-btn').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.dataset.id;
                    if (confirm('Bu oyuncuyu atmak istediğinize emin misiniz?')) {
                        this.app.network.kickPlayer(id, 'Kicked by admin');
                    }
                };
            });

            // Drag patterns
            const columns = this.container.querySelectorAll('.mgmt-column');
            columns.forEach(col => {
                col.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    col.style.borderColor = 'var(--sapphire)';
                });
                col.addEventListener('dragleave', () => {
                    col.style.borderColor = '';
                });
                col.addEventListener('drop', (e) => {
                    e.preventDefault();
                    col.style.borderColor = '';
                    const playerId = e.dataTransfer.getData('text/plain');
                    let targetTeam = 'spectator';
                    if (col.id === 'teamRed') targetTeam = 'red';
                    else if (col.id === 'teamBlue') targetTeam = 'blue';
                    this.app.network.socket.emit('adminMovePlayer', { playerId, team: targetTeam });
                });
            });

            // Make sure document listeners are only added once
            if (!this._dragListenerAdded) {
                this._dragListenerAdded = true;
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

        this.container.onclick = (e) => {
            if (e.target === this.container) this.hide();
        };
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    show() {
        if (!this.app.gameRunning) return;
        this.render(this.app.currentRoomData);
        this.container.classList.remove('hidden');
        this.isVisible = true;

        // Fetch latest room data to ensure sync
        this.app.network.socket?.emit('getRoomUpdate');
    }

    hide() {
        this.container.classList.add('hidden');
        this.isVisible = false;
    }
}
