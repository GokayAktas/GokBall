/**
 * AudioManager - Handles sound effects using Web Audio API
 * Generates Haxball-like sounds without needing external files
 */
export class AudioManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.enabled = true;

        window.addEventListener('setVolume', (e) => {
            if (e.detail && e.detail.volume !== undefined) {
                this.setVolume(parseFloat(e.detail.volume));
            }
        });
    }

    _init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.masterGain.gain.value = 0.3; // Default volume
    }

    setVolume(value) {
        if (!this.ctx) this._init();
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, value));
        }
    }

    /**
     * Plays a short 'thud' sound similar to Haxball's kick
     */
    playKick() {
        if (!this.enabled) return;
        this._init();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    /**
     * Plays a 'whistle' and crowd cheering sound for goals
     */
    playGoal() {
        if (!this.enabled) return;
        this._init();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const playTone = (freq, duration, delay) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
            gain.gain.setValueAtTime(0, this.ctx.currentTime + delay);
            gain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + delay + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + delay + duration);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(this.ctx.currentTime + delay);
            osc.stop(this.ctx.currentTime + delay + duration);
        };

        // Whistle - Removed per user request
        // playTone(880, 0.4, 0);
        // playTone(660, 0.3, 0.1);
        // playTone(1100, 0.5, 0.2);

        // Crowd Roar (White Noise)
        const bufferSize = 2 * this.ctx.sampleRate;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 2);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0, this.ctx.currentTime);
        noiseGain.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.2);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 2.5);

        whiteNoise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        whiteNoise.start(this.ctx.currentTime);
        whiteNoise.stop(this.ctx.currentTime + 2.5);
    }

    /**
     * Plays a subtle wall bounce sound
     */
    playWall() {
        if (!this.enabled) return;
        this._init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.05);
    }
}
