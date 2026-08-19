/**
 * Snapshot Interpolation Buffer
 * Buffers server snapshots and provides interpolated state for smooth rendering
 */

export class SnapshotBuffer {
    constructor(interpolationDelay = 100) {
        this.buffer = []; // Array of { time, state }
        this.interpolationDelay = interpolationDelay; // ms
        this.maxBufferSize = 20; // Keep last 20 snapshots
    }

    /**
     * Add a new snapshot to the buffer
     * @param {number} serverTime - Server timestamp in ms
     * @param {Object} state - Game state
     */
    addSnapshot(serverTime, state) {
        this.buffer.push({ time: serverTime, state });
        
        // Trim old snapshots
        while (this.buffer.length > this.maxBufferSize) {
            this.buffer.shift();
        }
    }

    /**
     * Get interpolated state for rendering
     * Returns the interpolated disc positions between two snapshots
     * @param {number} localTime - Current local time in ms
     * @returns {Object|null} Interpolated state or null if not enough data
     */
    getInterpolatedState(localTime) {
        if (this.buffer.length < 2) return null;

        const renderTime = localTime - this.interpolationDelay;
        
        // Find the two snapshots to interpolate between
        let prev = null;
        let next = null;
        
        for (let i = 0; i < this.buffer.length - 1; i++) {
            if (this.buffer[i].time <= renderTime && this.buffer[i + 1].time > renderTime) {
                prev = this.buffer[i];
                next = this.buffer[i + 1];
                break;
            }
        }
        
        // If we haven't found a pair, use the last two snapshots
        if (!prev || !next) {
            // If we're behind, use the latest snapshot directly
            const latest = this.buffer[this.buffer.length - 1];
            return latest ? latest.state : null;
        }

        // Calculate interpolation factor (0 to 1)
        const timeDiff = next.time - prev.time;
        if (timeDiff <= 0) return next.state;
        
        const t = Math.max(0, Math.min(1, (renderTime - prev.time) / timeDiff));
        
        // Interpolate disc positions
        return this._interpolateStates(prev.state, next.state, t);
    }

    /**
     * Get the latest snapshot (for non-interpolated use)
     */
    getLatestState() {
        if (this.buffer.length === 0) return null;
        return this.buffer[this.buffer.length - 1].state;
    }

    /**
     * Get the interpolation delay in ms
     */
    getDelay() {
        return this.interpolationDelay;
    }

    /**
     * Adjust interpolation delay based on jitter
     */
    adjustDelay(jitter) {
        // Set delay to 2x jitter + minimum
        this.interpolationDelay = Math.max(50, jitter * 2 + 30);
    }

    _interpolateStates(stateA, stateB, t) {
        const result = {
            state: stateB.state, // Use latest state enum
            physics: {
                kickOffReset: stateB.physics.kickOffReset,
                kickOffTeam: stateB.physics.kickOffTeam,
                discs: [],
            },
            scoreRed: stateB.scoreRed,
            scoreBlue: stateB.scoreBlue,
            time: stateB.time,
        };

        const discsA = stateA.physics.discs;
        const discsB = stateB.physics.discs;
        
        // Match discs by id
        const matchedA = new Map();
        const matchedB = new Map();
        
        for (const d of discsA) matchedA.set(d.id, d);
        for (const d of discsB) matchedB.set(d.id, d);
        
        // Interpolate all discs in B that also exist in A
        for (const dB of discsB) {
            const dA = matchedA.get(dB.id);
            
            if (dA) {
                // Interpolate position
                result.physics.discs.push({
                    ...dB,
                    x: dA.x + (dB.x - dA.x) * t,
                    y: dA.y + (dB.y - dA.y) * t,
                    sx: dA.sx + (dB.sx - dA.sx) * t,
                    sy: dA.sy + (dB.sy - dA.sy) * t,
                });
            } else {
                // New disc (no previous snapshot), use position as-is
                result.physics.discs.push({ ...dB });
            }
        }
        
        return result;
    }

    /**
     * Clear the buffer
     */
    clear() {
        this.buffer = [];
    }
}
