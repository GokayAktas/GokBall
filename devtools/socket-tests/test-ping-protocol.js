/**
 * Ping / handicap protocol test (HaxBall style: the authority measures)
 *
 * Run the server first:
 *   PORT=3011 ALLOW_ALL_ORIGINS=true npm run server
 * then:
 *   node devtools/socket-tests/test-ping-protocol.js
 *
 * Verifies:
 *  - the server probes and measures the round trip itself
 *  - every 2s it publishes a quantized ping per player (null until measured)
 *  - /handicap changes the handicap and produces the equal input delay
 */
import { io } from 'socket.io-client';

const URL = process.env.TEST_SERVER_URL || 'http://localhost:3011';
const opts = { transports: ['polling', 'websocket'] };

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failures++;
}

const host = io(URL, opts);
const guest = io(URL, opts);

let roomId = null;
const hostPings = [];
const guestPings = [];
const guestChats = [];
const guestRoomUpdates = [];

// Emulate the app client: answer the server's latency probe immediately.
function answerProbes(socket, label) {
  socket.on('netProbe', (d) => {
    if (d && typeof d.n === 'number') socket.emit('netProbeAck', { n: d.n });
  });
  socket.on('connect', () => console.log(`${label} connected`, socket.id));
}

host.on('playerPings', (d) => hostPings.push(d));
guest.on('playerPings', (d) => guestPings.push(d));
guest.on('chatMessage', (m) => guestChats.push(m));
guest.on('roomUpdate', (d) => guestRoomUpdates.push(d));

host.on('connect', () => {
  host.emit('createRoom', { name: `ping-test-${Date.now()}`, playerName: 'Host' });
});

answerProbes(host, 'host');
answerProbes(guest, 'guest');

host.on('roomCreated', (data) => {
  roomId = data.roomId;
  guest.emit('joinRoom', { roomId, password: '', playerName: 'Guest' });
});

guest.on('roomJoined', () => {
  // Wait for at least two probe rounds so a measurement exists
  setTimeout(runChecks, 5000);
});

function runChecks() {
  const measured = guestPings.filter(d =>
    d.pings.some(p => p.id === guest.id && p.ping !== null));
  check('server measures and publishes pings', measured.length > 0,
    JSON.stringify(guestPings[guestPings.length - 1]));

  const entry = guestPings[guestPings.length - 1]?.pings.find(p => p.id === guest.id);
  check('published ping is a 16 ms step', entry && entry.ping != null && entry.ping % 16 === 0,
    `ping=${entry?.ping}`);
  check('ping list covers every player',
    guestPings[guestPings.length - 1]?.pings.length === 2);

  // /handicap: adds lag to the player and the same delay to everyone else
  guest.emit('chatMessage', '/handicap 50');
  setTimeout(() => {
    const after = guestPings[guestPings.length - 1]?.pings || [];
    const g = after.find(p => p.id === guest.id);
    const h = after.find(p => p.id === host.id);
    check('handicap is stored on the player', g && g.handicap === 50, `handicap=${g?.handicap}`);
    check('handicapper pays the handicap', g && g.inputDelay === 50, `inputDelay=${g?.inputDelay}`);
    check('others pay the same delay (fairness)', h && h.inputDelay === 50, `inputDelay=${h?.inputDelay}`);
    check('player list carries the handicap', guestRoomUpdates.some(d =>
      d.players && d.players.some(p => p.handicap === 50)));

    // Reset
    guest.emit('chatMessage', '/handicap 0');
    setTimeout(() => {
      const reset = guestPings[guestPings.length - 1]?.pings.find(p => p.id === guest.id);
      check('handicap can be removed', reset && reset.handicap === 0 && reset.inputDelay === 0,
        `handicap=${reset?.handicap} inputDelay=${reset?.inputDelay}`);

      guest.disconnect();
      host.disconnect();
      console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
      process.exit(failures === 0 ? 0 : 1);
    }, 3000);
  }, 3000);
}

host.on('connect_error', (err) => {
  console.error('connect error', err.message);
  process.exit(1);
});