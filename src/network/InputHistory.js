/** Client input history used to discard host-acknowledged inputs and replay the rest. */
export class InputHistory {
    constructor(limit = 120) {
        this.limit = limit;
        this.entries = [];
        this.acknowledgedSeq = 0;
    }

    push(seq, input) {
        if (!Number.isFinite(seq) || seq <= this.acknowledgedSeq) return;
        const last = this.entries[this.entries.length - 1];
        if (last && seq <= last.seq) return;
        this.entries.push({ seq, input: { ...input } });
        if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    }

    acknowledge(seq) {
        if (!Number.isFinite(seq) || seq <= this.acknowledgedSeq) return;
        this.acknowledgedSeq = seq;
        this.entries = this.entries.filter((entry) => entry.seq > seq);
    }

    unconfirmed() { return this.entries; }

    reset(acknowledgedSeq = 0) {
        this.entries = [];
        this.acknowledgedSeq = Number.isFinite(acknowledgedSeq) ? acknowledgedSeq : 0;
    }
}
