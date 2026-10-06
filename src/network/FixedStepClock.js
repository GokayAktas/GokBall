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

    advance(now, onStep) {
        if (this.lastTime == null) {
            this.lastTime = now;
            return 0;
        }
        this.accumulator += Math.max(0, now - this.lastTime);
        this.lastTime = now;
        const dueSteps = Math.floor((this.accumulator + 1e-7) / this.stepMs);
        let steps = 0;
        while (this.accumulator + 1e-7 >= this.stepMs) {
            onStep(steps, dueSteps);
            this.accumulator -= this.stepMs;
            steps++;
        }
        return steps;
    }
}
