# Online networking

## Authority and traffic

The room creator's browser owns the match simulation. A Dedicated Worker runs the shared `Physics` engine with a fixed 60 Hz accumulator. The main page renders worker snapshots and handles UI, audio, scoring display, and room controls. Guests predict their own disc locally and reconcile against host snapshots.

Each guest opens one unordered WebRTC DataChannel to the room host with `maxRetransmits: 0`. Inputs carry the protocol version, match epoch, and monotonically increasing sequence. Host snapshots carry the epoch and simulation tick plus per-player processed-input acknowledgements. Guests discard old epochs and snapshots. A reliable Socket.IO request/response supplies a full host snapshot for initial join and resync.

Socket.IO owns room membership, chat, moderation, signaling, and temporary resume tickets. When a WebRTC channel is unavailable or falls back, the server relays only versioned input/state/ping packets between the room host and a member of the same room. Relay packets are volatile so stale positions do not queue behind current traffic. A short room-scoped resume token keeps a disconnected player's membership for 20 seconds; an unrecovered host closes the room after that window.

## TURN

STUN is configured by default. An operator can add TURN with deployment environment variables:

```text
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_USERNAME=...
TURN_CREDENTIAL=...
```

The TURN credentials are sent to clients as part of WebRTC ICE configuration, so deploy short-lived credentials from a TURN provider where possible. Do not store production credentials in this repository.

## Background tabs

Moving host physics to a Worker avoids contention with rendering, but browsers still throttle or freeze background pages and worker timers. A hidden host page can therefore fall behind and catch up in batches; this architecture cannot promise continuous 60 Hz while the browser freezes the page. A guarantee across a frozen host page requires a separate always-on server authority.

## Verification

Run `npm test` for protocol, relay authorization, room lifecycle, snapshot, input-history, and sync checks. Run `npm run build` to validate Vite's module-worker output. Direct peer, TURN, fallback, reconnect, and background-tab behavior still requires a multi-browser network test; the Node suite cannot model browser ICE/NAT or throttling behavior.
