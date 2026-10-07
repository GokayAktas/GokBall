import { NETWORK_PROTOCOL_VERSION } from '../src/network/Protocol.js';

/**
 * Room-side match lifecycle and settings. Physics is owned by the room host's
 * Dedicated Worker; this class never advances a match simulation.
 */
export class Game {
    constructor(room) {
        this.room = room;
        this.state = 'stopped';
        this.scoreRed = 0;
        this.scoreBlue = 0;
        this.timeElapsed = 0;
        this.scoreLimit = 3;
        this.timeLimit = 180;
        this.tickRate = 60;
        this.overtimeEnabled = true;
        this.paused = false;
        this.resuming = false;
        this.matchEpoch = null;
        this.stadiumData = null;
        this._resumeTimer = null;
    }

    setStadium(stadiumData) {
        this.stadiumData = stadiumData;
    }

    start() {
        if (this.state === 'playing') return;
        this.scoreRed = 0;
        this.scoreBlue = 0;
        this.timeElapsed = 0;
        this.matchEpoch = null;
        this.paused = false;
        this.resuming = false;
        this.state = 'playing';
        this.room.broadcast('gameStarted', {
            scoreRed: 0,
            scoreBlue: 0,
            roomData: this.room.getRoomData(),
            hostId: this.room.hostId,
            protocolVersion: NETWORK_PROTOCOL_VERSION
        });
        return { scoreRed: 0, scoreBlue: 0 };
    }

    stop() {
        this.state = 'stopped';
        this.paused = false;
        this.resuming = false;
        clearTimeout(this._resumeTimer);
        this._resumeTimer = null;
    }

    getInfo() {
        return {
            state: this.state,
            scoreRed: this.scoreRed,
            scoreBlue: this.scoreBlue,
            timeElapsed: this.timeElapsed,
            scoreLimit: this.scoreLimit,
            timeLimit: this.timeLimit,
            overtimeEnabled: this.overtimeEnabled,
            paused: this.paused,
            matchEpoch: this.matchEpoch
        };
    }
}
