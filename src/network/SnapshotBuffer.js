/**
 * Snapshot interpolation for remote discs. Host simulation ticks define the
 * timeline; local receive times only anchor that timeline to the render clock.
 */

const FIXED_STEP_MS = 1000 / 60;
const MAX_EXTRAPOLATION_MS = 80;
const MIN_INTERPOLATION_DELAY_MS = 50;
const MAX_INTERPOLATION_DELAY_MS = 180;

export class SnapshotBuffer {
    constructor(interpolationDelay = MIN_INTERPOLATION_DELAY_MS) {
        this.buffer = [];
        this.initialInterpolationDelay = Math.max(MIN_INTERPOLATION_DELAY_MS, interpolationDelay);
        this.interpolationDelay = this.initialInterpolationDelay;
        this.maxBufferSize = 20;
        this._arrivalJitter = 0;
    }

    /** Add a newer host snapshot; stale unordered packets are ignored. */
    addSnapshot(receivedAt, state) {
        if (!state?.physics?.discs) return false;

        const tick = Number.isFinite(state.tick) ? state.tick : null;
        const timelineTick = Number.isFinite(state.physicsTick) ? state.physicsTick : tick;
        let latest = this.buffer[this.buffer.length - 1];
        if (latest && (timelineTick === null) !== (latest.timelineTick === null)) {
            // Do not mix local receive timestamps from a control snapshot with
            // the host-tick timeline used for gameplay snapshots.
            this.clear();
            latest = null;
        }
        if (tick !== null && latest?.tick !== null && latest?.tick !== undefined && tick <= latest.tick) {
            return false;
        }

        const time = timelineTick !== null ? timelineTick * FIXED_STEP_MS : receivedAt;
        if (latest) {
            const arrivalInterval = receivedAt - latest.receivedAt;
            const tickInterval = timelineTick !== null && latest.timelineTick !== null
                ? (timelineTick - latest.timelineTick) * FIXED_STEP_MS
                : arrivalInterval;
            if (arrivalInterval > 0 && arrivalInterval <= 1000 && tickInterval > 0 && tickInterval <= 1000) {
                // Compare receive cadence with the host's simulation ticks. If
                // packets were skipped, receive time alone compresses several
                // host frames into one client frame and makes players jump.
                const deviation = Math.abs(arrivalInterval - tickInterval);
                this._arrivalJitter += (deviation - this._arrivalJitter) / 8;
                this.interpolationDelay = Math.max(
                    MIN_INTERPOLATION_DELAY_MS,
                    Math.min(MAX_INTERPOLATION_DELAY_MS, FIXED_STEP_MS * 3 + this._arrivalJitter * 2)
                );
            }
        }

        this.buffer.push({ time, receivedAt, tick, timelineTick, state });
        while (this.buffer.length > this.maxBufferSize) this.buffer.shift();
        return true;
    }

    /** Return the host-tick state at local render time minus the safety delay. */
    getInterpolatedState(localTime) {
        if (this.buffer.length === 0) return null;
        const latest = this.buffer[this.buffer.length - 1];
        const elapsed = latest.state.paused ? 0 : Math.max(0, localTime - latest.receivedAt);
        const estimatedHostTime = latest.time + elapsed;
        const renderTime = estimatedHostTime - this.interpolationDelay;
        const first = this.buffer[0];
        if (this.buffer.length === 1) {
            if (renderTime <= first.time) return first.state;
            const elapsed = Math.min(renderTime - first.time, MAX_EXTRAPOLATION_MS);
            return this._extrapolateState(first.state, elapsed / FIXED_STEP_MS);
        }

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
        this.interpolationDelay = Math.max(
            MIN_INTERPOLATION_DELAY_MS,
            Math.min(MAX_INTERPOLATION_DELAY_MS, jitter * 2 + MIN_INTERPOLATION_DELAY_MS)
        );
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
        this._arrivalJitter = 0;
        this.interpolationDelay = this.initialInterpolationDelay;
    }
}
