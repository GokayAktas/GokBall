/**
 * Snapshot interpolation for remote discs. Snapshot time is the local receive
 * time, so no clock synchronization between the host and guest is required.
 */

const MAX_EXTRAPOLATION_MS = 80;
const FIXED_STEP_MS = 1000 / 60;

export class SnapshotBuffer {
    constructor(interpolationDelay = 50) {
        this.buffer = [];
        this.interpolationDelay = interpolationDelay;
        this.maxBufferSize = 20;
        this._averageInterval = FIXED_STEP_MS;
        this._arrivalJitter = 0;
    }

    /** Add a newer host snapshot; stale unordered packets are ignored. */
    addSnapshot(receivedAt, state) {
        if (!state?.physics?.discs) return false;

        const tick = Number.isFinite(state.tick) ? state.tick : null;
        const latest = this.buffer[this.buffer.length - 1];
        if (tick !== null && latest?.tick !== null && latest?.tick !== undefined && tick <= latest.tick) {
            return false;
        }

        if (latest) {
            const interval = receivedAt - latest.time;
            if (interval >= 8 && interval <= 250) {
                this._arrivalJitter += (Math.abs(interval - this._averageInterval) - this._arrivalJitter) / 8;
                this._averageInterval += (interval - this._averageInterval) / 16;
                this.interpolationDelay = Math.max(30, Math.min(120,
                    this._averageInterval * 2 + this._arrivalJitter * 3));
            }
        }

        this.buffer.push({ time: receivedAt, tick, state });
        while (this.buffer.length > this.maxBufferSize) this.buffer.shift();
        return true;
    }

    /** Return a state at local time minus the interpolation safety delay. */
    getInterpolatedState(localTime) {
        if (this.buffer.length === 0) return null;
        const renderTime = localTime - this.interpolationDelay;
        const first = this.buffer[0];
        if (this.buffer.length === 1) {
            if (renderTime <= first.time) return first.state;
            const elapsed = Math.min(renderTime - first.time, MAX_EXTRAPOLATION_MS);
            return this._extrapolateState(first.state, elapsed / FIXED_STEP_MS);
        }

        const latest = this.buffer[this.buffer.length - 1];

        // At startup or directly after a state transition, begin at the oldest
        // available point instead of jumping ahead to the newest snapshot.
        if (renderTime <= first.time) return first.state;

        for (let i = 0; i < this.buffer.length - 1; i++) {
            const prev = this.buffer[i];
            const next = this.buffer[i + 1];
            if (prev.time <= renderTime && next.time >= renderTime) {
                const timeDiff = next.time - prev.time;
                if (timeDiff <= 0) return next.state;
                const t = Math.max(0, Math.min(1, (renderTime - prev.time) / timeDiff));
                return this._interpolateStates(prev.state, next.state, t);
            }
        }

        if (renderTime > latest.time) {
            const elapsed = Math.min(renderTime - latest.time, MAX_EXTRAPOLATION_MS);
            return this._extrapolateState(latest.state, elapsed / FIXED_STEP_MS);
        }
        return latest.state;
    }

    getLatestState() {
        return this.buffer.length ? this.buffer[this.buffer.length - 1].state : null;
    }

    getDelay() {
        return this.interpolationDelay;
    }

    adjustDelay(jitter) {
        this.interpolationDelay = Math.max(20, jitter * 2 + 10);
    }

    _interpolateStates(stateA, stateB, t) {
        const result = {
            ...stateB,
            physics: {
                ...stateB.physics,
                discs: []
            }
        };

        const discsA = stateA.physics.discs;
        const discsB = stateB.physics.discs;
        const prevById = new Map();
        for (const disc of discsA) {
            if (disc.isPlayer && disc.id != null) prevById.set(disc.id, disc);
        }

        for (let i = 0; i < discsB.length; i++) {
            const current = discsB[i];
            const previous = current.isPlayer && current.id != null
                ? prevById.get(current.id)
                : (!current.isPlayer ? discsA[i] : null);

            if (!previous) {
                result.physics.discs.push({ ...current });
                continue;
            }

            result.physics.discs.push({
                ...current,
                x: previous.x + (current.x - previous.x) * t,
                y: previous.y + (current.y - previous.y) * t,
                sx: previous.sx + (current.sx - previous.sx) * t,
                sy: previous.sy + (current.sy - previous.sy) * t
            });
        }

        return result;
    }

    _extrapolateState(state, ticks) {
        if (ticks <= 0 || !state?.physics?.discs) return state;
        return {
            ...state,
            physics: {
                ...state.physics,
                discs: state.physics.discs.map((disc) => ({
                    ...disc,
                    x: disc.x + (disc.sx || 0) * ticks,
                    y: disc.y + (disc.sy || 0) * ticks
                }))
            }
        };
    }

    clear() {
        this.buffer = [];
    }
}
