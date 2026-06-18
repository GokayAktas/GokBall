/**
 * Server-side Room manager
 * Manages players, teams, admin, chat, and game lifecycle
 */
import { Player } from './Player.js';
import { Game } from './Game.js';

// Stadium Generator
function createStadium(name, fieldW, fieldH, spawnDist = 170) {
    const classicFieldW = 370;
    const classicFieldH = 170;
    const goalDepth = Math.round(fieldW * (40 / classicFieldW));
    const goalWidth = Math.round(fieldH * (64 / classicFieldH));
    const goalBackWidth = Math.round(goalWidth * (44 / 64));

    return {
        name,
        width: fieldW + goalDepth + 10,
        height: fieldH + 30,
        spawnDistance: spawnDist,
        bg: {
            type: "grass", width: fieldW, height: fieldH,
            kickOffRadius: 75, cornerRadius: 0,
            color: "59854C", stripeColor: "6B8954", bgColor: "718C5A",
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
            acceleration: 0.08, kickingAcceleration: 0.05, kickingDamping: 0.96, kickStrength: 5
        },
        ballPhysics: "disc0"
    };
}

const STADIUMS = {
    small: createStadium("Küçük", 250, 120, 120),
    classic: createStadium("Klasik", 370, 170, 170),
    futsal: {
        name: "Futsal 3v3",
        width: 480, height: 260, spawnDistance: 170,
        bg: { 
            type: "grass", width: 420, height: 220, 
            kickOffRadius: 75, cornerRadius: 0, 
            color: "4A4A4A", stripeColor: "4A4A4A", bgColor: "3A3A3A",
            lineColor: "FFFFFF", showCenterLine: true, showKickOffCircle: true,
            centerLineColor: "666666", useStarballImage: true
        },
        vertexes: [
            { x: -420, y: 220, bCoef: 0.1, cMask: ["ball"] }, // 0
            { x: -420, y: 75, bCoef: 0.1, cMask: ["ball"] },  // 1: Higher goal post
            { x: -420, y: -75, bCoef: 0.1, cMask: ["ball"] }, // 2: Higher goal post
            { x: -420, y: -220, bCoef: 0.1, cMask: ["ball"] }, // 3
            { x: 420, y: 220, bCoef: 0.1, cMask: ["ball"] },  // 4
            { x: 420, y: 75, bCoef: 0.1, cMask: ["ball"] },   // 5: Higher goal post
            { x: 420, y: -75, bCoef: 0.1, cMask: ["ball"] },  // 6: Higher goal post
            { x: 420, y: -220, bCoef: 0.1, cMask: ["ball"] }, // 7
            { x: 0, y: 220, bCoef: 0.1, cMask: [], cGroup: [] }, // 8
            { x: 0, y: -220, bCoef: 0.1, cMask: [], cGroup: [] }, // 9
            { x: -460, y: 75, bCoef: 0.1, cMask: ["ball"] },  // 10: Rectangular higher
            { x: -460, y: -75, bCoef: 0.1, cMask: ["ball"] }, // 11: Rectangular higher
            { x: 460, y: 75, bCoef: 0.1, cMask: ["ball"] },   // 12: Rectangular higher
            { x: 460, y: -75, bCoef: 0.1, cMask: ["ball"] }   // 13: Rectangular higher
        ],
        segments: [
            // Outer Lines (White)
            { v0: 0, v1: 8, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 8, v1: 4, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 3, v1: 9, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 9, v1: 7, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 0, v1: 1, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 2, v1: 3, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 4, v1: 5, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            { v0: 6, v1: 7, vis: true, color: "FFFFFF", bCoef: 1, cMask: ["ball"] },
            // Goals (Gray Rectangular - Sharp Corners)
            { v0: 1, v1: 10, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
            { v0: 10, v1: 11, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
            { v0: 11, v1: 2, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
            { v0: 5, v1: 12, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
            { v0: 12, v1: 13, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] },
            { v0: 13, v1: 6, curve: 0, vis: true, color: "666666", bCoef: 0.1, cMask: ["ball"] }
        ],
        goals: [
            { p0: [-420, 75], p1: [-420, -75], team: "red" },
            { p0: [420, 75], p1: [420, -75], team: "blue" }
        ],
        discs: [
            { pos: [0, 0], radius: 6.4, invMass: 1.6, bCoef: 0.4, damping: 0.99, color: "FFB82E", cMask: ["all"], cGroup: ["ball"] },
            // Posts (Red/Blue Dots)
            { pos: [-420, 75], radius: 4, invMass: 0, bCoef: 0.5, color: "c70000", cMask: ["all"] },
            { pos: [-420, -75], radius: 4, invMass: 0, bCoef: 0.5, color: "c70000", cMask: ["all"] },
            { pos: [420, 75], radius: 4, invMass: 0, bCoef: 0.5, color: "00008c", cMask: ["all"] },
            { pos: [420, -75], radius: 4, invMass: 0, bCoef: 0.5, color: "00008c", cMask: ["all"] }
        ],
        planes: [
            { normal: [0, 1], dist: -250, bCoef: 0.1, cMask: ["all"] }, // 220 + 2*15 (approx)
            { normal: [0, -1], dist: -250, bCoef: 0.1, cMask: ["all"] },
            { normal: [1, 0], dist: -500, bCoef: 0.1, cMask: ["all"] },
            { normal: [-1, 0], dist: -500, bCoef: 0.1, cMask: ["all"] }
        ],
        playerPhysics: {
            radius: 16.0, bCoef: 0.5, invMass: 0.5, damping: 0.96,
            acceleration: 0.1, kickingAcceleration: 0.07, kickingDamping: 0.96, kickStrength: 5.0
        },
        ballPhysics: "disc0"
    },
    big: createStadium("Büyük", 550, 270, 300),
    huge: createStadium("Devasa", 750, 370, 450)
};

let roomIdCounter = 1;

export class Room {
    constructor(options = {}) {
        this.id = 'room_' + (roomIdCounter++);
        this.name = options.name || 'GokBall Room';
        this.password = options.password || '';
        this.maxPlayers = Math.min(options.maxPlayers || 12, 24);
        this.roomType = options.roomType || 'cloud';
        this.players = new Map(); // socketId -> Player
        this.bannedIPs = new Set();
        this.hostId = null;
        this.creatorId = null; // The original room creator (important for local mode)
        this.teamsLocked = false;
        this._closing = false; // Flag to prevent recursive cleanup

        // Stadium Selection
        if (options.stadium && typeof options.stadium === 'string') {
            this.stadium = STADIUMS[options.stadium] || STADIUMS.classic;
        } else {
            this.stadium = options.stadium || STADIUMS.classic;
        }

        // Default team colors aligned with frontend "champions" theme.
        // Colors stored without # to be compatible with existing code paths.
        this.teamColors = options.teamColors || {
            red: { angle: 0, textColor: 'FFFFFF', colors: ['D32F2F'] },
            blue: { angle: 0, textColor: 'FFFFFF', colors: ['1565C0'] }
        };

        // Local-mode authority broadcast control: throttle admin state broadcasts
        // to avoid flooding the room when Admin is sending high-frequency updates.
        this._lastAuthorityBroadcast = 0;
        this._minAuthorityBroadcastMs = 50; // ~20Hz

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

        // === LOCAL MODE: If the creator leaves, close the entire room ===
        if (this.roomType === 'local' && socketId === this.creatorId && !this._closing) {
            this._closing = true;
            this.game.stop();

            // Kick all remaining players with a message
            for (const [id, p] of this.players) {
                if (id !== socketId) {
                    p.socket.emit('playerKicked', {
                        reason: 'Oda kurucusu ayrıldığı için oda kapatıldı.',
                        hostLeft: true
                    });
                    p.socket.disconnect();
                }
            }

            this.players.clear();
            return 0; // Signal to delete this room
        }

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

        // Transfer admin if host left (only for cloud mode — local mode creator exit already handled above)
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
        
        const teamSize = Math.floor(allPlayers.length / 2);
        
        for (let i = 0; i < allPlayers.length; i++) {
            const p = allPlayers[i];
            let targetTeam = 'spectator';
            if (i < teamSize) targetTeam = 'red';
            else if (i < teamSize * 2) targetTeam = 'blue';
            
            if (p.team !== targetTeam) {
                this.adminMovePlayer(adminId, p.id, targetTeam);
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
     * Change stadium
     */
    changeStadium(adminId, stadiumData) {
        const admin = this.players.get(adminId);
        if (!admin || !admin.isAdmin) return;
        if (this.game.state === 'playing') return;

        let finalStadium = stadiumData;
        if (typeof stadiumData === 'string' && STADIUMS[stadiumData]) {
            finalStadium = STADIUMS[stadiumData];
        }

        this.stadium = finalStadium;
        this.game.setStadium(finalStadium);
        this.broadcast('stadiumChanged', { stadium: finalStadium });
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
            case '/komut':
            case '/komutlar':
                let helpText = "📜 Komutlar:\n";
                helpText += "👤 /avatar [yazı] - Formandaki yazıyı/emojiyi değiştirir (Max 2 harf)\n";
                helpText += "🎲 /avatar random - 1 ile 99 arasında rastgele forma numarası verir\n";
                
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
            name: this.name,
            players: this.getPlayerList(),
            teamsLocked: this.teamsLocked,
            stadium: this.stadium,
            teamColors: this.teamColors,
            roomType: this.roomType,
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
