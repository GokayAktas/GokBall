/** Accumulates elapsed time and runs every due fixed simulation step. */
export class FixedStepClock {
    constructor(stepMs = 1000 / 60) {
        this.stepMs = stepMs;
        this.accumulator = 0;
        this.lastTime = null;
    }

    reset(now = null) {
        this.accumulator = 0;
        this.lastTime = now;
    }

    advance(now, onStep, maxSteps = Infinity) {
        if (this.lastTime == null) {
            this.lastTime = now;
            return 0;
        }
        this.accumulator += Math.max(0, now - this.lastTime);
        this.lastTime = now;
        const availableSteps = Math.floor((this.accumulator + 1e-7) / this.stepMs);
        const stepLimit = Number.isFinite(maxSteps) ? Math.max(1, Math.floor(maxSteps)) : availableSteps;
        const dueSteps = Math.min(availableSteps, stepLimit);
        let steps = 0;
        while (steps < dueSteps) {
            onStep(steps, dueSteps);
            this.accumulator -= this.stepMs;
            steps++;
        }
        // Prediction is disposable: replaying a long hidden-tab backlog can
        // starve rendering. Keep only the fractional remainder and catch up to
        // the latest authority snapshots on the next frames.
        if (availableSteps > dueSteps) this.accumulator %= this.stepMs;
        return steps;
    }
}
