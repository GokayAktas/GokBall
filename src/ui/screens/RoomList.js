/**
 * Room List Screen - Browse and join rooms
 */
export class RoomList {
  constructor(app) {
    this.app = app;
    this.rooms = [];
  }

  render() {
    const div = document.createElement('div');
    div.className = 'screen';
    div.innerHTML = `
      <div class="roomlist-container">
        <div class="top-bar">
          <button class="back-btn" id="btnBack">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Geri
          </button>
          <h2 class="page-title">Odalar</h2>
          <button class="btn btn-secondary btn-sm" id="btnRefresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Yenile
          </button>
        </div>

        <div class="card">
          <div class="roomlist-search">
            <input type="text" class="input" id="searchRooms" placeholder="Oda ara..." style="flex:1" />
          </div>
        </div>

        <div class="room-list" id="roomListContainer">
          <div style="text-align: center; color: var(--text-muted); padding: var(--space-xl);">
            Odalar yükleniyor...
          </div>
        </div>
        </div>
      </div>
      
      <!-- Custom Password Modal -->
      <div id="passwordModal" class="hidden" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:1000; display:flex; align-items:center; justify-content:center;">
        <div class="card" style="width: 320px; text-align: center;">
          <h3 style="margin-bottom: 16px; color: var(--text-primary);">Oda Şifreli</h3>
          <p style="font-size: var(--font-sm); color: var(--text-secondary); margin-bottom: 16px;">Bu odaya girmek için şifreyi giriniz:</p>
          <input type="password" id="modalPasswordInput" class="input" style="width: 100%; margin-bottom: 16px;" placeholder="Şifre" />
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn btn-secondary btn-sm" id="btnCancelPassword">İptal</button>
            <button class="btn btn-primary btn-sm" id="btnSubmitPassword">Odaya Gir</button>
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

    document.getElementById('btnRefresh')?.addEventListener('click', () => {
      this._loadRooms();
    });

    document.getElementById('searchRooms')?.addEventListener('input', (e) => {
      this._filterRooms(e.target.value);
    });

    // Listen for room list
    this.app.network.on('roomList', (rooms) => {
      this.rooms = rooms;
      this._renderRooms(rooms);
    });

    this._loadRooms();
  }

  _loadRooms() {
    this.app.network.listRooms();
  }

  _renderRooms(rooms) {
    const container = document.getElementById('roomListContainer');
    if (!container) return;

    if (rooms.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: var(--space-xl);">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3; margin-bottom: 12px;"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>
          <p>Henüz aktif oda yok</p>
          <p style="font-size: var(--font-xs); margin-top: 8px;">İlk odayı sen oluştur!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = rooms.map(room => `
      <div class="room-item" data-room-id="${room.id}">
        <div class="room-item-info">
          <span class="room-item-name">${this._escapeHtml(room.name)}</span>
          <div class="room-item-details">
            <span>🏟️ ${this._escapeHtml(room.stadiumName)}</span>
            <span>${room.hasPassword ? '🔒 Şifreli' : '🔓 Açık'}</span>
            ${room.gameState === 'playing' ? '<span>⚽ Oyun devam ediyor</span>' : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap: var(--space-md);">
          ${room.hasPassword ? '<span class="badge badge-locked">🔒</span>' : '<span class="badge badge-open">Açık</span>'}
          <span class="room-item-players">${room.playerCount}/${room.maxPlayers}</span>
        </div>
      </div>
    `).join('');

    // Click handlers
    container.querySelectorAll('.room-item').forEach(item => {
      item.addEventListener('click', () => {
        const roomId = item.dataset.roomId;
        const room = rooms.find(r => r.id === roomId);
        if (room?.hasPassword) {
          this._showPasswordModal(roomId);
        } else {
          this.app.joinRoom(roomId);
        }
      });
    });
  }

  _showPasswordModal(roomId) {
    const modal = document.getElementById('passwordModal');
    const input = document.getElementById('modalPasswordInput');
    const btnCancel = document.getElementById('btnCancelPassword');
    const btnSubmit = document.getElementById('btnSubmitPassword');

    if (!modal || !input) return;

    modal.classList.remove('hidden');
    input.value = '';
    input.focus();

    const cleanup = () => {
      modal.classList.add('hidden');
      btnCancel.onclick = null;
      btnSubmit.onclick = null;
      input.onkeydown = null;
    };

    btnCancel.onclick = cleanup;

    const submit = () => {
      const pw = input.value;
      if (pw !== null) {
        this.app.joinRoom(roomId, pw);
      }
      cleanup();
    };

    btnSubmit.onclick = submit;

    input.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cleanup();
    };
  }

  _filterRooms(query) {
    const filtered = this.rooms.filter(r =>
      r.name.toLowerCase().includes(query.toLowerCase())
    );
    this._renderRooms(filtered);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
