/**
 * Server-side Room manager
 * Manages players, teams, admin, chat, and game lifecycle
 */
import { Player } from './Player.js';
import { Game } from './Game.js';
import { MapManager } from './MapManager.js';

// Stadium Generator
function createStadium(name, fieldW, fieldH, spawnDist = 170) {
    const classicFieldW = 370;
    const classicFieldH = 170;
    const goalDepth = Math.round(fieldW * (40 / classicFieldW));
    const goalWidth = Math.round(fieldH * (64 / classicFieldH));
    const goalBackWidth = Math.round(goalWidth * (44 / 64));
    const kickOffRadius = Math.round(fieldH * (75 / classicFieldH));

    return {
        name,
        width: fieldW + goalDepth + 10,
        height: fieldH + 30,
        spawnDistance: spawnDist,
        bg: {
            type: "grass", width: fieldW, height: fieldH,
            kickOffRadius, cornerRadius: 0,
            color: "699057", stripeColor: "7B9F6C", bgColor: "718D5A",
            lineColor: "C7E6BD", showCenterLine: true, showKickOffCircle: true
        },
        vertexes: [
            { x: -fieldW, y: fieldH, bCoef: 0.1, cMask: ["ball"] }, // 0: TL
            { x: -fieldW, y: goalWidth, bCoef: 0.1, cMask: ["ball"] },  // 1: Red Post T
            { x: -fieldW, y: -goalWidth, bCoef: 0.1, cMask: ["ball"] }, // 2: Red Post B
            { x: -fieldW, y: -fieldH, bCoef: 0.1, cMask: ["ball"] }, // 3: BL
            { x: fieldW, y: fieldH, bCoef: 0.1, cMask: ["ball"] },  // 4: TR
            { x: fieldW, y: goalWidth, bCoef: 0.1, cMask: ["ball"] },   // 5: Blue Post T
            { x: fieldW, y: -goalWidth, bCoef: 0.1, cMask: ["ball"] },  // 6: Blue Post B
            { x: fieldW, y: -fieldH, bCoef: 0.1, cMask: ["ball"] }, // 7: BR
            { x: 0, y: fieldH, bCoef: 0.1, cMask: [], cGroup: [] }, // 8
            { x: 0, y: -fieldH, bCoef: 0.1, cMask: [], cGroup: [] }, // 9
            // Goal Netting Points (U-Shape with rounded corners)
            { x: -(fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ["ball"] },  // 10
            { x: -(fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ["ball"] }, // 11
            { x: (fieldW + goalDepth), y: goalBackWidth, bCoef: 0.1, cMask: ["ball"] },   // 12
            { x: (fieldW + goalDepth), y: -goalBackWidth, bCoef: 0.1, cMask: ["ball"] }   // 13
        ],
        segments: [
            // Pitch Lines
            { v0: 0, v1: 8, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 8, v1: 4, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 3, v1: 9, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 9, v1: 7, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 0, v1: 1, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 2, v1: 3, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 4, v1: 5, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            { v0: 6, v1: 7, curve: 0, vis: true, color: "C7E6BD", bCoef: 1, cMask: ["ball"] },
            // Red Goal (Pure U-Shape)
            { v0: 1, v1: 10, curve: 90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 10, v1: 11, curve: 0, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 11, v1: 2, curve: 90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            // Blue Goal (Pure U-Shape)
            { v0: 5, v1: 12, curve: -90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 12, v1: 13, curve: 0, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] },
            { v0: 13, v1: 6, curve: -90, vis: true, color: "000000", bCoef: 0.1, cMask: ["ball"] }
        ],
        goals: [
            { p0: [-fieldW, goalWidth], p1: [-fieldW, -goalWidth], team: "red" },
            { p0: [fieldW, goalWidth], p1: [fieldW, -goalWidth], team: "blue" }
        ],
        discs: [
            { pos: [0, 0], radius: 10, invMass: 1, bCoef: 0.5, damping: 0.99, color: "FFFFFF", cMask: ["all"], cGroup: ["ball"] },
            // Posts
            { pos: [-fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [-fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [fieldW, goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] },
            { pos: [fieldW, -goalWidth], radius: 8, invMass: 0, bCoef: 0.5, color: "CCCCFF", cMask: ["all"] }
        ],
        planes: [
            { normal: [0, 1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ["all"] },
            { normal: [0, -1], dist: -(fieldH + 30), bCoef: 0.1, cMask: ["all"] },
            { normal: [1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ["all"] },
            { normal: [-1, 0], dist: -(fieldW + goalDepth + 10), bCoef: 0.1, cMask: ["all"] }
        ],
        playerPhysics: {
            radius: 15, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.10, kickingAcceleration: 0.065, kickingDamping: 0.96, kickStrength: 5
        },
        ballPhysics: "disc0"
    };
}

// Maps are now managed centrally by MapManager
// Legacy STADIUMS object kept for backward compatibility
const STADIUMS = {
    small:  MapManager.getMap('small'),
    classic: MapManager.getMap('classic'),
    futsal: MapManager.getMap('futsal'),
    big:    MapManager.getMap('big'),
    huge:   MapManager.getMap('huge'),
};

let roomIdCounter = 1;

export class Room {
    constructor(options = {}) {
        this.id = 'room_' + (roomIdCounter++);
        this.name = options.name || 'GokBall Room';
        this.password = options.password || '';
        this.maxPlayers = Math.min(options.maxPlayers || 12, 24);
        this.roomType = 'cloud';
        this.players = new Map(); // socketId -> Player
        this.bannedIPs = new Set();
        this.hostId = null;
        this.creatorId = null; // The original room creator
        this.teamsLocked = false;
        this._closing = false; // Flag to prevent recursive cleanup
        this.playerSpeedMultiplier = options.playerSpeedMultiplier || 1.0;

        // Map Selection (server-authoritative)
        if (options.stadium && typeof options.stadium === 'string') {
            this.mapId = MapManager.isValid(options.stadium) ? options.stadium : 'classic';
        } else {
            this.mapId = 'classic';
        }
        this.stadium = MapManager.getMap(this.mapId);
        this.mapHash = MapManager.getHash(this.mapId);

        // Default team colors aligned with frontend "champions" theme.
        // Colors stored without # to be compatible with existing code paths.
        this.teamColors = options.teamColors || {
            red: { angle: 0, textColor: 'FFFFFF', colors: ['D32F2F'] },
            blue: { angle: 0, textColor: 'FFFFFF', colors: ['1565C0'] }
        };

        // Persist lobby chat for in-game display
        this.chatHistory = [];

        // Game
        this.game = new Game(this);
        this.game.setStadium(this.stadium);
        this.game.scoreLimit = options.scoreLimit !== undefined ? options.scoreLimit : 3;
        this.game.timeLimit = options.timeLimit !== undefined ? options.timeLimit : 180;
    }

    /**
     * Add a player to the room
     */
    addPlayer(socket, name) {
        if (this.players.size >= this.maxPlayers) {
            return { error: 'Room is full' };
        }

        const player = new Player(socket, name);

        player.avatar = this._randomAvatar();

        // First player becomes host/admin and creator
        if (this.players.size === 0) {
            player.isAdmin = true;
            this.hostId = player.id;
            this.creatorId = player.id;
        }

        this.players.set(player.id, player);

        // Notify others
        this.broadcast('playerJoined', {
            player: player.toJSON(),
            players: this.getPlayerList()
        }, player.id);

        // Broadcast join message to chat for in-game display
        this.broadcast('chatMessage', {
            playerName: '🏟 SİSTEM',
            message: `✅ ${name} odaya katıldı!`,
            team: 'spectator',
            system: true
        });

        // Send a private command hint only to the joining player.
        // NOTE: Return a private join hint so the client UI can display it
        // at the right moment (after lobby UI has initialized).
        const joinHint = '📜 Komutları görmek için /komut yazın';

        return {
            roomId: this.id,
            roomName: this.name,
            roomType: this.roomType,
            creatorId: this.creatorId,
            player: player.toJSON(),
            players: this.getPlayerList(),
            stadium: this.stadium,
            teamColors: this.teamColors,
            playerSpeedMultiplier: this.playerSpeedMultiplier,
            game: this.game.getInfo(),
            teamsLocked: this.teamsLocked,
            chatHistory: this.chatHistory.slice(),
            joinHint
        };
    }

    /**
     * Remove a player from the room
     */
    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (!player) return;

        // Remove player disc from game if playing
        if (this.game.state === 'playing' || this.game.state === 'countdown' || this.game.state === 'goal') {
            const discIdx = this.game.playerDiscs.get(socketId);
            if (discIdx !== undefined) {
                this.game.physics.removeDisc(discIdx);
                this.game.playerDiscs.delete(socketId);
                this.game.rebuildPlayerDiscMap();
            }
        }

        this.players.delete(socketId);

        // Transfer admin if host left
        if (this.hostId === socketId && this.players.size > 0) {
            const newHost = this.players.values().next().value;
            newHost.isAdmin = true;
            this.hostId = newHost.id;
            this.broadcast('adminUpdate', {
                playerId: newHost.id,
                isAdmin: true,
                players: this.getPlayerList()
            });
        }

        // Broadcast leave message to chat for in-game display
        this.broadcast('chatMessage', {
            playerName: '🏟 SİSTEM',
            message: `❌ ${player.name} odadan ayrıldı!`,
            team: 'spectator',
            system: true
        });

        this.broadcast('playerLeft', {
            playerId: socketId,
            playerName: player.name,
            players: this.getPlayerList()
        });

        // Stop game if not enough players
        if (this.game.state === 'playing') {
            const red = this.getTeamPlayers('red').length;
            const blue = this.getTeamPlayers('blue').length;
            if (red === 0 || blue === 0) {
                this.game.stop();
                this.broadcast('gameStopped', { reason: 'Not enough players' });
            }
        }

        return this.players.size;
    }

    /**
     * Change a player's team
     */
    changeTeam(socketId, team) {
        const player = this.players.get(socketId);
        if (!player) return;

        if (!['red', 'blue', 'spectator'].includes(team)) return;

        // Check team lock (non-admins can't change if locked OR game is running)
        const isGameRunning = this.game.state === 'playing' || this.game.state === 'countdown' || this.game.state === 'goal';
        if ((this.teamsLocked || isGameRunning) && !player.isAdmin) {
            player.socket.emit('roomError', { error: 'Oyun devam ederken veya takımlar kilitliyken geçiş yapamazsınız!' });
            return;
        }

        const oldTeam = player.team;
        if (oldTeam === team) return;

        // AFK players cannot join teams (unless admin moves them)
        if (player.afk && team !== 'spectator') {
            player.socket.emit('chatMessage', {
                playerName: 'SİSTEM',
                message: '💤 AFK modundaysken takıma katılamazsınız. /afk ile AFK modunu kapatın.',
                system: true
            });
            return;
        }

        player.team = team;

        // If game is running, handle disc update (just like adminMovePlayer)
        if (this.game.state === 'playing' || this.game.state === 'countdown' || this.game.state === 'goal') {
            // Remove old disc if it exists
            const oldDiscIdx = this.game.playerDiscs.get(socketId);
            if (oldDiscIdx !== undefined) {
                this.game.physics.removeDisc(oldDiscIdx);
                this.game.playerDiscs.delete(socketId);
            }

            // Add new disc if moved to red/blue
            if (team === 'red' || team === 'blue') {
                const spawnX = (team === 'red' ? -1 : 1) * (this.stadium.spawnDistance || 170);
                const discIdx = this.game.physics.addPlayerDisc(this.stadium.playerPhysics || {}, team, spawnX, 0, socketId);
                const disc = this.game.physics.discs[discIdx];
                if (disc) {
                    disc._playerName = player.name;
                    disc._avatar = player.avatar;
                    disc.ownerId = socketId;
                    if (this.teamColors && this.teamColors[team]) {
                        disc.color = this.teamColors[team].colors[0];
                        disc.colors = this.teamColors[team].colors;
                        disc.colorAngle = this.teamColors[team].angle;
                        disc.avatarColor = this.teamColors[team].textColor;
                    } else {
                        disc.color = team === 'red' ? 'c70000' : '00008c';
                        disc.colors = [disc.color];
                        disc.colorAngle = 0;
                        disc.avatarColor = 'FFFFFF';
                    }
                }
            } else {
                player.discIndex = -1;
            }

            // Rebuild mapping after add/remove
            this.game.rebuildPlayerDiscMap();
        }

        this.broadcast('teamChanged', {
            playerId: socketId,
            team,
            players: this.getPlayerList()
        });
    }

    /**
     * Admin tools for team management
     */
    randomizeTeams(adminId) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        const allPlayers = Array.from(this.players.values());
        
        // Shuffle array
        for (let i = allPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
        }
        
        // Separate AFK players and assignable players
        const assignable = allPlayers.filter(p => !p.afk);
        const afkPlayers = allPlayers.filter(p => p.afk);
        
        const teamSize = Math.floor(assignable.length / 2);
        
        // Assign non-AFK players to teams
        for (let i = 0; i < assignable.length; i++) {
            const p = assignable[i];
            let targetTeam = 'spectator';
            if (i < teamSize) targetTeam = 'red';
            else if (i < teamSize * 2) targetTeam = 'blue';
            
            if (p.team !== targetTeam) {
                this.adminMovePlayer(adminId, p.id, targetTeam);
            }
        }
        
        // AFK players stay in spectator
        for (const p of afkPlayers) {
            if (p.team !== 'spectator') {
                this.adminMovePlayer(adminId, p.id, 'spectator');
            }
        }
        this.broadcast('chatMessage', {
            playerName: '[SİSTEM]',
            message: '🎲 Takımlar rastgele karıştırıldı!',
            team: 'spectator'
        });
    }

    clearTeam(adminId, team) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        // "bu tuşa sadece maç başlamadan basılabilsin"
        if (this.game.state !== 'stopped' && this.game.state !== 'ended') {
            admin.socket.emit('roomError', { error: 'Takım boşaltma sadece maç oynanmıyorken yapılabilir!' });
            return;
        }

        const playersInTeam = this.getTeamPlayers(team);
        for (const p of playersInTeam) {
            this.adminMovePlayer(adminId, p.id, 'spectator');
        }
    }

    /**
     * Admin moves a player to a team (ignores lock)
     */
    adminMovePlayer(adminId, targetId, team) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        const target = this.players.get(targetId);
        if (!target) return;

        const oldTeam = target.team;
        if (oldTeam === team) return;
        if (!['red', 'blue', 'spectator'].includes(team)) return;

        target.team = team;

        // If game is running, handle disc update
        if (this.game.state === 'playing' || this.game.state === 'countdown' || this.game.state === 'goal') {
            // Remove old disc if it exists
            const oldDiscIdx = this.game.playerDiscs.get(targetId);
            if (oldDiscIdx !== undefined) {
                this.game.physics.removeDisc(oldDiscIdx);
                this.game.playerDiscs.delete(targetId);
            }

            // Add new disc if moved to red/blue
            if (team === 'red' || team === 'blue') {
                const spawnX = (team === 'red' ? -1 : 1) * (this.stadium.spawnDistance || 170);
                const discIdx = this.game.physics.addPlayerDisc(this.stadium.playerPhysics || {}, team, spawnX, 0, targetId);
                const disc = this.game.physics.discs[discIdx];
                if (disc) {
                    disc._playerName = target.name;
                    disc._avatar = target.avatar;
                    disc.ownerId = targetId; // Critical for proper sync
                    if (this.teamColors && this.teamColors[team]) {
                        disc.color = this.teamColors[team].colors[0];
                        disc.colors = this.teamColors[team].colors;
                        disc.colorAngle = this.teamColors[team].angle;
                        disc.avatarColor = this.teamColors[team].textColor;
                    } else {
                        disc.color = team === 'red' ? 'c70000' : '00008c';
                        disc.colors = [disc.color];
                        disc.colorAngle = 0;
                        disc.avatarColor = 'FFFFFF';
                    }
                }
            } else {
                target.discIndex = -1; // Explicitly set spectator index
            }

            // Always rebuild map after any add/remove during game!
            this.game.rebuildPlayerDiscMap();
        }

        this.broadcast('teamChanged', {
            playerId: targetId,
            team,
            players: this.getPlayerList()
        });
    }

    /**
     * Toggle team lock
     */
    toggleTeamLock(adminId) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        this.teamsLocked = !this.teamsLocked;
        this.broadcast('teamLockChanged', { locked: this.teamsLocked });
    }

    /**
     * Kick a player
     */
    kickPlayer(adminId, targetId, reason) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        const target = this.players.get(targetId);
        if (!target) return;

        target.socket.emit('playerKicked', { reason: reason || 'Kicked by admin' });
        target.socket.disconnect();
        this.removePlayer(targetId);
    }

    /**
     * Ban a player
     */
    banPlayer(adminId, targetId, reason) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        const target = this.players.get(targetId);
        if (!target) return;

        // Store ban by IP
        const ip = target.socket.handshake.address;
        this.bannedIPs.add(ip);

        target.socket.emit('playerKicked', { reason: reason || 'Banned by admin', banned: true });
        target.socket.disconnect();
        this.removePlayer(targetId);
    }

    /**
     * Give/remove admin
     */
    toggleAdmin(adminId, targetId) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;

        const target = this.players.get(targetId);
        if (!target || target.id === adminId) return;

        target.isAdmin = !target.isAdmin;
        this.broadcast('adminUpdate', {
            playerId: targetId,
            isAdmin: target.isAdmin,
            players: this.getPlayerList()
        });
    }

    /**
     * Change map (server-authoritative, hash-based dedup)
     * @param {string} adminId - The requesting player's socket ID
     * @param {string} mapId   - The map ID from the registry
     */
    changeMap(adminId, mapId) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;
        if (this.game.state === 'playing') return;
        if (!MapManager.isValid(mapId)) return;

        // Dedup: skip if same map is already active
        if (this.mapId === mapId) return;

        this.mapId = mapId;
        this.stadium = MapManager.getMap(mapId);
        this.mapHash = MapManager.getHash(mapId);
        this.game.setStadium(this.stadium);
        this.broadcast('mapChanged', { mapId, mapHash: this.mapHash, stadium: this.stadium });
    }

    /**
     * Legacy changeStadium - resolves string IDs via MapManager
     */
    changeStadium(adminId, stadiumData) {
        if (typeof stadiumData === 'string') {
            return this.changeMap(adminId, stadiumData);
        }
        // Custom HBS data: register as a temporary map
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;
        if (this.game.state === 'playing') return;

        const tempId = 'custom_' + Date.now();
        MapManager.registerMap(tempId, stadiumData);
        this.mapId = tempId;
        this.stadium = stadiumData;
        this.mapHash = MapManager.getHash(tempId);
        this.game.setStadium(this.stadium);
        this.broadcast('mapChanged', { mapId: this.mapId, mapHash: this.mapHash, stadium: this.stadium });
    }

    /**
     * Broadcast a message to all players (optionally exclude one)
     */
    broadcast(event, data, excludeId) {
        for (const [id, player] of this.players) {
            if (id !== excludeId) {
                player.socket.emit(event, data);
            }
        }
    }

    _recordChatMessage(data) {
        this.chatHistory.push({
            playerId: data.playerId || null,
            playerName: data.playerName || 'System',
            message: data.message,
            team: data.team || null,
            system: !!data.system
        });
        if (this.chatHistory.length > 100) {
            this.chatHistory.shift();
        }
    }

    /**
     * Send chat message (broadcasts to ALL players including sender)
     */
    chat(senderId, message) {
        const sender = this.players.get(senderId);
        if (!sender) return;

        // Handle commands
        if (message.startsWith('/')) {
            this._handleCommand(sender, message);
            return;
        }

        const payload = {
            playerId: senderId,
            playerName: sender.name,
            message: message.substring(0, 200),
            team: sender.team
        };
        this._recordChatMessage(payload);
        this.broadcast('chatMessage', payload);
    }

    setTyping(senderId, state) {
        const player = this.players.get(senderId);
        if (!player) return;

        player.typing = !!state;

        // Broadcast typing update (can be optimized but simple roomUpdate works)
        this.broadcast('playerTyping', {
            playerId: senderId,
            typing: player.typing
        });
    }

    _randomAvatar() {
        return (Math.floor(Math.random() * 99) + 1).toString();
    }

    _normalizeColor(value) {
        const cleaned = (value || '').replace('#', '').trim().toUpperCase();
        return /^[0-9A-F]{6}$/.test(cleaned) ? cleaned : null;
    }

    _applyAvatarToDisc(player) {
        if (this.game.state !== 'playing' && this.game.state !== 'countdown' && this.game.state !== 'goal') return;

        const discIdx = this.game.playerDiscs.get(player.id);
        if (discIdx === undefined) return;

        const disc = this.game.physics.discs[discIdx];
        if (disc) {
            disc.avatar = player.avatar;
            disc._avatar = player.avatar;
        }
    }

    _handleCommand(player, cmd) {
        const parts = cmd.split(' ');
        const command = parts[0].toLowerCase();

        switch (command) {
            case '/avatar':
                if (parts[1]?.toLowerCase() === 'random') {
                    player.avatar = this._randomAvatar();
                } else {
                    player.avatar = parts.slice(1).join(' ').substring(0, 2);
                }
                this.broadcast('roomUpdate', { players: this.getPlayerList() });
                this._applyAvatarToDisc(player);
                break;
            case '/colors':
                if (player.isAdmin) {
                    const teamArg = parts[1]?.toLowerCase();
                    const team = teamArg === 'kirmizi' || teamArg === 'kırmızı' ? 'red'
                        : teamArg === 'mavi' ? 'blue'
                            : teamArg;
                    if (team === 'red' || team === 'blue') {
                        if (parts.length !== 7) {
                            player.socket.emit('chatMessage', {
                                playerName: 'SISTEM',
                                message: 'Kullanım: /colors (takım) (açı) (yazı rengi) (renk1) (renk2) (renk3)',
                                system: true
                            });
                            break;
                        }

                        const angle = Number.parseInt(parts[2], 10);
                        const textColor = this._normalizeColor(parts[3]);
                        const colors = parts.slice(4, 7).map(c => this._normalizeColor(c));
                        
                        if (Number.isFinite(angle) && textColor && colors.every(Boolean)) {
                            if (!this.teamColors) this.teamColors = { red: null, blue: null };
                            this.teamColors[team] = {
                                angle,
                                textColor,
                                colors
                            };
                            
                            // Broadcast update
                            this.broadcast('chatMessage', {
                                playerName: 'SİSTEM',
                                message: `${team.toUpperCase()} takım renkleri güncellendi.`,
                                system: true
                            });

                            // Apply to active players if game is running
                            if (this.game.state === 'playing' || this.game.state === 'countdown' || this.game.state === 'goal') {
                                this.game.physics.discs.forEach(d => {
                                    if (d.isPlayer && d.team === team) {
                                        d.color = colors[0];
                                        d.colors = colors;
                                        d.colorAngle = angle;
                                        d.avatarColor = textColor;
                                    }
                                });
                                this.broadcast('gameState', this.game._getGameState());
                            }

                            // Broadcast teamColorsUpdated so clients update their local state
                            this.broadcast('teamColorsUpdated', {
                                team,
                                teamColors: this.teamColors[team],
                                allTeamColors: this.teamColors
                            });
                        } else {
                            player.socket.emit('chatMessage', {
                                playerName: 'SISTEM',
                                message: 'Renk kodları 6 haneli HEX olmalı. Örnek: /colors red 60 FFFFFF C70000 FF5555 AA0000',
                                system: true
                            });
                        }
                    }
                }
                break;
            case '/afk':
                if (player.afk) {
                    // Toggle off AFK
                    player.afk = false;
                    player.afkMatchesLeft = 0;
                    // Move back to spectator if they were placed
                    if (player.team !== 'spectator') {
                        this.changeTeam(senderId, 'spectator');
                    }
                    player.socket.emit('chatMessage', {
                        playerName: 'SİSTEM',
                        message: '✅ AFk modu kapatıldı. Artık takımlara girebilirsiniz.',
                        system: true
                    });
                } else {
                    // Toggle on AFK
                    player.afk = true;
                    player.afkMatchesLeft = 2;
                    // Move to spectator if in a team
                    if (player.team !== 'spectator') {
                        this.changeTeam(senderId, 'spectator');
                    }
                    player.socket.emit('chatMessage', {
                        playerName: 'SİSTEM',
                        message: '💤 Başarıyla 2 maç boyunca AFK oldunuz. Tekrar /afk yazarak iptal edebilirsiniz.',
                        system: true
                    });
                }
                // Broadcast updated player list
                this.broadcast('roomUpdate', { players: this.getPlayerList() });
                break;
            case '/komut':
            case '/komutlar':
                let helpText = "📜 Komutlar:\n";
                helpText += "👤 /avatar [yazı] - Formandaki yazıyı/emojiyi değiştirir (Max 2 harf)\n";
                helpText += "🎲 /avatar random - 1 ile 99 arasında rastgele forma numarası verir\n";
                helpText += "💤 /afk - 2 maç boyunca AFK modunu aç/kapat\n";
                
                if (player.isAdmin) {
                    helpText += "\n👑 Admin Komutları:\n";
                    helpText += "🎨 /colors (takım) (açı) (yazı rengi) (renk1) (renk2) (renk3) - Takım renklerini değiştirir\n";
                    helpText += "🔓 /clear_bans - Tüm yasaklamaları (banları) kaldırır\n";
                }

                player.socket.emit('chatMessage', {
                    playerName: 'SİSTEM',
                    message: helpText,
                    system: true
                });
                break;
            case '/clear_bans':
                if (player.isAdmin) {
                    this.bannedIPs.clear();
                    player.socket.emit('chatMessage', {
                        playerName: 'System',
                        message: 'All bans cleared',
                        system: true
                    });
                }
                break;
            default:
                player.socket.emit('chatMessage', {
                    playerName: 'System',
                    message: 'Unknown command: ' + command,
                    system: true
                });
        }
    }

    /**
     * Decrement AFK match counters for all AFK players
     */
    _decrementAfkCounters() {
        for (const player of this.players.values()) {
            if (player.afk && player.afkMatchesLeft > 0) {
                player.afkMatchesLeft--;
                if (player.afkMatchesLeft <= 0) {
                    player.afk = false;
                    player.socket.emit('chatMessage', {
                        playerName: 'SİSTEM',
                        message: '✅ AFK süreniz doldu. Artık takımlara girebilirsiniz.',
                        system: true
                    });
                }
            }
        }
    }

    getTeamPlayers(team) {
        return [...this.players.values()].filter(p => p.team === team);
    }

    getPlayerList() {
        return [...this.players.values()].map(p => p.toJSON());
    }

    getRoomData() {
        return {
            id: this.id,
            adminId: this.hostId,
            creatorId: this.creatorId,
            name: this.name,
            players: this.getPlayerList(),
            teamsLocked: this.teamsLocked,
            stadium: this.stadium,
            mapId: this.mapId,
            mapHash: this.mapHash,
            teamColors: this.teamColors,
            roomType: this.roomType,
            playerSpeedMultiplier: this.playerSpeedMultiplier,
            game: this.game.getInfo(),
            chatHistory: this.chatHistory.slice()
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            hasPassword: !!this.password,
            playerCount: this.players.size,
            maxPlayers: this.maxPlayers,
            stadiumName: this.stadium.name || 'Classic',
            mapId: this.mapId,
            gameState: this.game.state,
            scoreRed: this.game.scoreRed,
            scoreBlue: this.game.scoreBlue,
            roomType: this.roomType
        };
    }

    isEmpty() {
        return this.players.size === 0;
    }
}
