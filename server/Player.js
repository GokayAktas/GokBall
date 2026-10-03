/**
 * Server-side Player class
 */
import { PING_SAMPLE_COUNT, effectivePing } from './utils/ping.js';

export class Player {
    constructor(socket, name) {
        this.id = socket.id;
        this.socket = socket;
        this.name = name || 'Player';
        this.team = 'spectator'; // 'red' | 'blue' | 'spectator'
        this.isAdmin = false;
        this.avatar = '';
        this.input = { up: false, down: false, left: false, right: false, kick: false };
        this.discIndex = -1; // Index in physics.discs
        this.typing = false;
        this.afk = false; // AFK flag
        this.afkMatchesLeft = 0; // Matches remaining as AFK

        // Latency, measured by the server (never self-reported)
        this.pingSamples = []; // raw round trips, newest last
        this.ping = null; // quantized effective ping, null until measured
        this.pingLoss = 0; // probes lost in the last round
        this.handicap = 0; // /handicap in ms, 0 = disabled
    }

    /**
     * Add a measured round trip and refresh the displayed ping.
     */
    addPingSample(rtt) {
        if (!Number.isFinite(rtt) || rtt < 0) return;
        this.pingSamples.push(rtt);
        if (this.pingSamples.length > PING_SAMPLE_COUNT) this.pingSamples.shift();
        this.ping = effectivePing(this.pingSamples);
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            team: this.team,
            isAdmin: this.isAdmin,
            avatar: this.avatar,
            typing: this.typing,
            afk: this.afk,
            ping: this.ping,
            pingLoss: this.pingLoss,
            handicap: this.handicap
        };
    }
}
