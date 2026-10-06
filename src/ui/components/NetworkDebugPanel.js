export class NetworkDebugPanel {
    constructor(app) {
        this.app = app;
        this.root = document.createElement('aside');
        this.root.className = 'network-debug-panel';
        this.root.innerHTML = `
            <strong>Network debug</strong>
            <pre class="network-debug-values"></pre>
            <label>Latency <input data-net="latencyMs" type="range" min="0" max="250" value="0"><output>0 ms</output></label>
            <label>Jitter <input data-net="jitterMs" type="range" min="0" max="150" value="0"><output>0 ms</output></label>
            <label>Packet loss <input data-net="packetLoss" type="range" min="0" max="30" value="0"><output>0%</output></label>`;
        document.body.appendChild(this.root);
        this.values = this.root.querySelector('.network-debug-values');
        this.config = { latencyMs: 0, jitterMs: 0, packetLoss: 0 };
        for (const input of this.root.querySelectorAll('input[data-net]')) {
            input.addEventListener('input', () => {
                const key = input.dataset.net;
                this.config[key] = Number(input.value) / (key === 'packetLoss' ? 100 : 1);
                input.nextElementSibling.value = key === 'packetLoss' ? `${input.value}%` : `${input.value} ms`;
                this.app.network.setNetworkSimulation(this.config);
            });
        }
        this.timer = setInterval(() => this.render(), 200);
    }

    render() {
        const app = this.app;
        const localId = app.network.socket?.id;
        const localDisc = app.physics.discs.find((disc) => disc.id === localId);
        const authDisc = app._lastConfirmedServerState?.discs?.find((disc) => disc.id === localId);
        const remotes = app._snapshotBuffer.getLatestState()?.physics?.discs?.filter((disc) => disc.isPlayer && disc.id !== localId) || [];
        const lines = [
            `route: ${app.network._peerHostId ? 'WebRTC/relay' : 'host'} | ping ${fmt(app._peerHostRtt?.ping ?? app.network.ping)} ms`,
            `jitter ${fmt(app.network.jitter)} ms | loss ${fmt(app.network.packetLoss)}%`,
            `epoch ${app._matchEpoch || '-'} | host tick ${fmt(app._lastAuthorityTick)} | client tick ${fmt(app._physicsTickCount)}`,
            `input ${app.network.getInputSeqNum()} | ack ${app._lastConfirmedServerSeq} | buffer ${app._snapshotBuffer.getSize()} @ ${Math.round(app._snapshotBuffer.getDelay())} ms`,
            `reconcile error ${distance(localDisc?.pos, authDisc)}`,
            `local predicted ${point(localDisc?.pos)} | authoritative ${point(authDisc)} | render ${point(localDisc?._renderPosition)}`,
            `remote net/render ${remotes.map((disc) => `${disc.id}:${point(disc)} / ${point(app.physics.discs.find((d) => d.id === disc.id)?._renderPosition)}`).join(' ; ') || '-'}`
        ];
        this.values.textContent = lines.join('\n');
    }

    destroy() {
        clearInterval(this.timer);
        this.root.remove();
        this.app.network.setNetworkSimulation({});
    }
}

function fmt(value) { return Number.isFinite(value) ? Math.round(value) : '-'; }
function point(value) { return value && Number.isFinite(value.x) ? `${value.x.toFixed(1)},${value.y.toFixed(1)}` : '-'; }
function distance(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y).toFixed(2) : '-'; }
