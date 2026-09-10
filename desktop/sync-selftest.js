// 局域网同步传输层的无头集成自测（不需 Electron/路由器/显示器）。
// 运行：node desktop/sync-selftest.js  —— 覆盖鉴权、切片、入站队列、LAN 白名单、UDP 发现与 tokenFP 过滤。
const http = require('http');
const dgram = require('dgram');
const syncServer = require('./sync-server');
const discovery = require('./discovery');

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 原生 HTTP GET（可自定义头），用于测试“未带令牌/错误令牌”被拒。
function rawGet(path, headers) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path, method: 'GET', headers: headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

const MIN = 60 * 1000;
const t0 = Math.floor(Date.now() / MIN) * MIN;

async function run() {
  console.log('== sync-server ==');
  const PASSWORD = 'router-pass-123';
  syncServer.setToken(PASSWORD);
  const fp = syncServer.tokenFingerprint();
  check('tokenFingerprint 长度为 8', fp.length === 8);
  check('token 为大写十六进制', /^[0-9A-F]{8}$/.test(fp));

  syncServer.setSelf({ id: 'desktop-self', name: 'Test PC', platform: 'desktop', version: '1.3.21', role: 'collector', collecting: true });
  syncServer.start();
  await sleep(150);

  // fetchPeer 自动注入正确令牌
  const hello = await syncServer.fetchPeer({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: '/sync/hello' });
  check('fetchPeer /sync/hello 成功', hello.ok && hello.status === 200);
  let helloBody = {};
  try { helloBody = JSON.parse(hello.body); } catch {}
  check('/sync/hello app 标签正确', helloBody.app === syncServer.APP_TAG);
  check('/sync/hello 回报本机身份', helloBody.id === 'desktop-self' && helloBody.platform === 'desktop');
  check('/sync/hello tokenFP 与服务端一致', helloBody.tokenFP === fp);

  // 未带令牌 / 错误令牌 → 403
  const noToken = await rawGet('/sync/hello', {});
  check('未带令牌被拒 (403)', noToken.status === 403);
  const wrongToken = await rawGet('/sync/hello', { 'X-Sync-Token': 'DEADBEEF' });
  check('错误令牌被拒 (403)', wrongToken.status === 403);

  // publish + /sync/live
  const live = { timestamp: Date.now(), signal: { rsrp: -95 }, status: { loginfo: 'ok' } };
  syncServer.publish({
    live,
    chart: {
      rsrp: [[t0 - 2 * MIN, -100], [t0 - MIN, -98], [t0, -95]],
      sinr: [[t0, 12]], rsrq: [], down: [[t0, 1000]], up: [[t0, 200]],
      temperatures: { cpu: [[t0 - MIN, 40], [t0, 42]] }
    },
    battery: [
      { timestamp: t0 - 2 * MIN, percent: 80, charging: false },
      { timestamp: t0, percent: 82, charging: true }
    ]
  });
  const liveResp = await syncServer.fetchPeer({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: '/sync/live' });
  const liveBody = JSON.parse(liveResp.body);
  check('/sync/live 返回已发布快照', liveBody.live && liveBody.live.signal.rsrp === -95);

  // /sync/history 全量
  const histFull = JSON.parse((await syncServer.fetchPeer({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: '/sync/history' })).body);
  check('/sync/history 全量返回全部 rsrp 桶', histFull.chart.rsrp.length === 3);
  check('/sync/history 全量返回温度序列', Array.isArray(histFull.chart.temperatures.cpu) && histFull.chart.temperatures.cpu.length === 2);
  check('/sync/history 全量返回电池', histFull.battery.length === 2);

  // /sync/history?since= 增量
  const histInc = JSON.parse((await syncServer.fetchPeer({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: `/sync/history?since=${t0 - MIN}` })).body);
  check('/sync/history?since 只返回新于 since 的 rsrp 桶', histInc.chart.rsrp.length === 1 && histInc.chart.rsrp[0][0] === t0);
  check('/sync/history?since 电池增量正确', histInc.battery.length === 1 && histInc.battery[0].timestamp === t0);
  check('/sync/history 回报 now 时间戳', Number.isFinite(Number(histInc.now)));

  // POST /sync/history → 入站队列
  const post = await syncServer.fetchPeer({
    host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: '/sync/history', method: 'POST',
    body: JSON.stringify({ from: 'phone-abc', chart: { rsrp: [[t0, -90]], sinr: [], rsrq: [], down: [], up: [], temperatures: {} }, battery: [{ timestamp: t0, percent: 77, charging: false }] })
  });
  check('POST /sync/history 返回 ok', post.ok && JSON.parse(post.body).ok === true);
  const drained = syncServer.drainInbound();
  check('drainInbound 返回 1 条入站片段', drained.length === 1 && drained[0].from === 'phone-abc');
  check('入站片段携带 chart 数据', drained[0].chart.rsrp[0][1] === -90);
  check('drainInbound 二次调用为空（已清空）', syncServer.drainInbound().length === 0);

  // LAN 白名单
  const wan = await syncServer.fetchPeer({ host: '8.8.8.8', port: 51200, path: '/sync/hello' });
  check('非局域网地址被拒绝', !wan.ok && /局域网/.test(wan.error || ''));

  // 关闭令牌 → 未启用
  syncServer.setToken('');
  const disabled = await syncServer.fetchPeer({ host: '127.0.0.1', port: syncServer.SYNC_HTTP_PORT, path: '/sync/hello' });
  check('无令牌时 fetchPeer 报“同步未启用”', !disabled.ok && /未启用/.test(disabled.error || ''));
  const afterClear = await rawGet('/sync/hello', { 'X-Sync-Token': 'DEADBEEF' });
  check('关闭令牌后服务端一律 403', afterClear.status === 403);
  syncServer.stop();

  console.log('== discovery ==');
  discovery.setBeacon({ id: 'self-1', name: 'Self', platform: 'desktop', httpPort: 51200, tokenFP: 'ABCD1234' });
  discovery.start();
  await sleep(150);

  const sender = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise(resolve => sender.bind(0, resolve));
  const beam = obj => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    sender.send(buf, 0, buf.length, discovery.DISCOVERY_PORT, '127.0.0.1');
  };
  // 合法对端
  beam({ app: 'u50pro-sync', v: 1, id: 'peer-2', name: 'Phone', platform: 'android', httpPort: 51200, role: 'viewer', collecting: false, tokenFP: 'ABCD1234', time: Date.now() });
  // 自身 id（应忽略）
  beam({ app: 'u50pro-sync', v: 1, id: 'self-1', name: 'Echo', platform: 'desktop', httpPort: 51200, tokenFP: 'ABCD1234', time: Date.now() });
  // tokenFP 不匹配（应过滤）
  beam({ app: 'u50pro-sync', v: 1, id: 'peer-x', name: 'Stranger', platform: 'android', httpPort: 51200, tokenFP: 'ZZZZ9999', time: Date.now() });
  // 非本应用信标（应忽略）
  beam({ app: 'other-app', v: 1, id: 'peer-y', name: 'Noise', tokenFP: 'ABCD1234', time: Date.now() });
  await sleep(300);

  const peers = discovery.getPeers();
  check('发现合法对端 peer-2', peers.some(p => p.id === 'peer-2' && p.platform === 'android'));
  check('对端 host 被记录为 127.0.0.1', peers.some(p => p.id === 'peer-2' && p.host === '127.0.0.1'));
  check('忽略自身信标 self-1', !peers.some(p => p.id === 'self-1'));
  check('过滤 tokenFP 不匹配的 peer-x', !peers.some(p => p.id === 'peer-x'));
  check('忽略非本应用信标 peer-y', !peers.some(p => p.id === 'peer-y'));

  sender.close();
  discovery.stop();

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) { console.log('SELFTEST_FAIL'); process.exit(1); }
  console.log('SELFTEST_ALL_PASS');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
