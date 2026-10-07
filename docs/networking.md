# Online networking

## Authority and match timeline

The room host's browser owns the match. Its Dedicated Worker is the only place that advances physics, match time, score, goals, kickoff resets, and match statistics. The main thread captures the host's input and renders the worker's snapshots; guest windows predict only their own disc and reconcile it with host acknowledgements.

Host and guests use the same epoch and physics-tick snapshots. A monotonically increasing snapshot sequence distinguishes repeated control states at a frozen physics tick, such as pause and full-state responses. Guests interpolate remote discs on that tick timeline and discard old epochs, ticks, and snapshot sequences.

## Transport and protocol

Protocol version 2 is used by room signaling, real-time packets, and full-state transfers. Inputs include a match epoch and increasing per-player sequence. Snapshots include the match epoch, physics tick, snapshot sequence, scores, elapsed match time, pause/state flags, physics, and last-processed input acknowledgements.

Each guest connects directly to the room host over one unordered WebRTC DataChannel configured with no retransmissions. Socket.IO manages rooms, chat, moderation, WebRTC signaling, full-state requests, and reliable unicast full-state replies. While a peer connection is unavailable or under relay fallback, the server forwards validated volatile input and snapshot packets only between the host and a member of that room. Direct and relayed traffic use the same versioned packet validator.

TURN is optional and configured with `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL`. TURN credentials are delivered to clients through ICE configuration; use short-lived credentials in production. Without TURN or a direct path, Socket.IO relay remains available.

## Join, recovery, and authority loss

A guest does not begin prediction until it receives a valid full host state. It requests another full state when its stream stalls or its epoch becomes inconsistent. The host answers with a new snapshot sequence over the reliable Socket.IO unicast path. Reconnect tickets preserve room membership for 20 seconds; if the host does not return, the room closes.

The server validates room membership, host identity, peer pairing, protocol version, packet size, and full-state destination. It does not simulate physics or decide match outcomes.

## Browser limitations and checks

Worker timers reduce main-thread contention but cannot prevent a browser from throttling or freezing a hidden tab. The host must remain available for this browser-host topology. A guarantee while the host browser is frozen requires moving authority to an always-on server.

Run `npm test` for protocol, signaling authorization, room lifecycle, fixed-step, input history, snapshot buffering, full-state validation, and sync checks. Run `npm run build` to validate the production Worker bundle. Direct WebRTC, TURN, relay transitions, reconnects, and browser tab throttling need multi-browser testing; Node tests cannot model ICE/NAT behavior or browser scheduling.
