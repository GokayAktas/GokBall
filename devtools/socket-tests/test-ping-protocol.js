/**
 * Ping / hostPing protocol test
 *
 * Run the server first (PORT=3011 ALLOW_ALL_ORIGINS=true npm run server),
 * then: node devtools/socket-tests/test-ping-protocol.js
 *
 * Verifies:
 *  - pong echoes the ping sequence number
 *  - only the host can broadcast hostPing, and it carries roomId/hostId
 *  - invalid ping values are rejected (no broadcast)
 *  - host leaving invalidates the host ping (ping: null)
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

host.on('hostPing', (d) => hostPings.push(d));
guest.on('hostPing', (d) => guestPings.push(d));

let pongSeq = null;
guest.on('pong', (d) => { pongSeq = d && d.n; });

host.on('connect', () => {
  host.emit('createRoom', { name: `ping-test-${Date.now()}`, playerName: 'Host' });
});

host.on('roomCreated', (data) => {
  roomId = data.roomId;
  guest.emit('joinRoom', { roomId, password: '', playerName: 'Guest' });
});

guest.on('roomJoined', () => setTimeout(runChecks, 300));

function runChecks() {
  // 1. pong must echo the sequence number
  guest.emit('ping', { n: 42 });

  // 2. host broadcasts a valid host ping
  host.emit('hostPing', { ping: 120 });

  // 3. non-host must NOT be able to broadcast
  guest.emit('hostPing', { ping: 999 });

  // 4. invalid values must be rejected
  host.emit('hostPing', { ping: 'abc' });
  host.emit('hostPing', { ping: -5 });
  host.emit('hostPing', { ping: 99999 });

  setTimeout(() => {
    check('pong echoes ping sequence', pongSeq === 42, `got n=${pongSeq}`);

    const valid = hostPings.filter((p) => p.ping === 120);
    check('host ping reaches the guest', guestPings.some((p) => p.ping === 120));
    check('host ping is room scoped', valid.length > 0 && valid.every((p) => p.roomId === roomId),
      JSON.stringify(valid[0]));
    check('host ping carries hostId', valid.length > 0 && valid.every((p) => p.hostId === host.id));

    check('non-host ping is ignored', !guestPings.some((p) => p.ping === 999));
    check('invalid ping values are ignored',
      !guestPings.some((p) => p.ping === -5 || p.ping === 99999 || typeof p.ping === 'string'));

    // 5. host leaving must invalidate the displayed value
    hostPings.length = 0;
    guestPings.length = 0;
    host.disconnect();

    setTimeout(() => {
      check('host leaving clears host ping', guestPings.some((p) => p.ping === null && p.reason === 'hostLeft'),
        JSON.stringify(guestPings));
      guest.disconnect();
      console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
      process.exit(failures === 0 ? 0 : 1);
    }, 600);
  }, 600);
}

host.on('connect_error', (err) => {
  console.error('connect error', err.message);
  process.exit(1);
});