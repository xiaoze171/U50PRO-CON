// 局域网设备发现（桌面端）。UDP 广播信标 + 监听，维护 peer 表。
// 用 tokenFP 过滤非同一路由器/家庭（或密码不同）的信标；peer TTL 15s。
// 与安卓 DiscoveryBeacon.java 行为一一对应。
const dgram = require('dgram');

const DISCOVERY_PORT = 51201;
const APP_TAG = 'u50pro-sync';
const BEACON_INTERVAL_MS = 5000;
const PEER_TTL_MS = 15000;

let socket = null;
let timer = null;
let beacon = {
  app: APP_TAG, v: 1, id: '', name: '', platform: 'desktop',
  httpPort: 51200, role: 'auto', collecting: false, tokenFP: ''
};
const peers = new Map();

function setBeacon(fields) {
  if (fields && typeof fields === 'object') beacon = { ...beacon, ...fields, app: APP_TAG };
}

// 返回存活 peer（顺带清理过期项）。
function getPeers() {
  const now = Date.now();
  const alive = [];
  for (const [id, peer] of peers) {
    if (now - peer.lastSeen > PEER_TTL_MS) { peers.delete(id); continue; }
    alive.push(peer);
  }
  return alive;
}

function broadcast() {
  if (!socket) return;
  try {
    const buffer = Buffer.from(JSON.stringify({ ...beacon, time: Date.now() }), 'utf8');
    socket.send(buffer, 0, buffer.length, DISCOVERY_PORT, '255.255.255.255');
  } catch { /* 广播失败静默重试 */ }
}

function start() {
  if (socket) return;
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', () => { stop(); });
  socket.on('message', (message, rinfo) => {
    let data;
    try { data = JSON.parse(message.toString('utf8')); } catch { return; }
    if (!data || data.app !== APP_TAG || !data.id) return;
    if (data.id === beacon.id) return;                                       // 忽略自身
    if (beacon.tokenFP && data.tokenFP && data.tokenFP !== beacon.tokenFP) return; // 非同一密码/家庭
    peers.set(data.id, {
      id: data.id,
      name: data.name || data.id,
      host: rinfo.address,
      port: data.httpPort || DISCOVERY_PORT - 1,
      platform: data.platform || '',
      role: data.role || 'auto',
      collecting: !!data.collecting,
      lastSeen: Date.now()
    });
  });
  socket.bind(DISCOVERY_PORT, () => {
    try { socket.setBroadcast(true); } catch {}
    broadcast();
    timer = setInterval(broadcast, BEACON_INTERVAL_MS);
  });
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (socket) { try { socket.close(); } catch {} socket = null; }
  peers.clear();
}

module.exports = { DISCOVERY_PORT, BEACON_INTERVAL_MS, PEER_TTL_MS, setBeacon, getPeers, start, stop };
