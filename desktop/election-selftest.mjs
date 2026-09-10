// 采集器选举的纯逻辑自测（无需 Electron/路由器/显示器）。
// 运行：node desktop/election-selftest.mjs
// 覆盖：确定性收敛（两台设备算出同一赢家）、平台优先级、id 平局、首选钉住/离线兜底、
//       浏览器(h5)不参与采集、离线兜底转本地采集。
import { electCollector, platformRank } from '../src/utils/election.js';

let passed = 0, failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}

const PC_A = { id: 'exe-aaa', platform: 'desktop' };
const PC_B = { id: 'exe-bbb', platform: 'desktop' };
const PHONE = { id: 'and-777', platform: 'android' };
const H5 = { id: 'h5-999', platform: 'h5' };

console.log('== election ==');

// 平台优先级
check('platformRank desktop < android < 其他', platformRank('desktop') < platformRank('android') && platformRank('android') < platformRank('h5'));

// self 缺失 → direct
check('无本机身份 → direct', electCollector({ self: null }).role === 'direct');

// 单机：只有自己 → 采集器
check('仅本机 → collector 且指向自己', (() => {
  const r = electCollector({ self: PC_A, peers: [] });
  return r.role === 'collector' && r.collectorId === PC_A.id;
})());

// EXE + 手机：EXE 作采集器；手机作查看端且 hub=EXE
check('EXE 视角：EXE + 手机 → EXE 采集', (() => {
  const r = electCollector({ self: PC_A, peers: [PHONE] });
  return r.role === 'collector' && r.collectorId === PC_A.id;
})());
check('手机视角：EXE + 手机 → 手机查看，hub=EXE', (() => {
  const r = electCollector({ self: PHONE, peers: [PC_A] });
  return r.role === 'viewer' && r.collectorId === PC_A.id;
})());

// 确定性收敛：两台设备各自独立计算，赢家一致（无脑裂）
check('确定性收敛：两端算出同一采集器', (() => {
  const fromA = electCollector({ self: PC_A, peers: [PHONE] });
  const fromPhone = electCollector({ self: PHONE, peers: [PC_A] });
  const winnerFromA = fromA.role === 'collector' ? PC_A.id : fromA.collectorId;
  const winnerFromPhone = fromPhone.role === 'collector' ? PHONE.id : fromPhone.collectorId;
  return winnerFromA === winnerFromPhone && winnerFromA === PC_A.id;
})());

// 双 EXE：同级按 id 升序取最小
check('双 EXE：id 较小者(exe-aaa)为采集器', (() => {
  const fromA = electCollector({ self: PC_A, peers: [PC_B] });
  const fromB = electCollector({ self: PC_B, peers: [PC_A] });
  return fromA.role === 'collector' && fromA.collectorId === 'exe-aaa'
    && fromB.role === 'viewer' && fromB.collectorId === 'exe-aaa';
})());

// 三设备：EXE-A + EXE-B + 手机 → 全体一致指向 exe-aaa
check('三设备一致收敛到 exe-aaa', (() => {
  const winners = [
    electCollector({ self: PC_A, peers: [PC_B, PHONE] }),
    electCollector({ self: PC_B, peers: [PC_A, PHONE] }),
    electCollector({ self: PHONE, peers: [PC_A, PC_B] })
  ].map(r => r.role === 'collector' ? undefined : r.collectorId);
  // 采集器本人 collectorId 指向自己；查看端指向 exe-aaa
  const c0 = electCollector({ self: PC_A, peers: [PC_B, PHONE] });
  return c0.role === 'collector' && c0.collectorId === 'exe-aaa'
    && winners[1] === 'exe-aaa' && winners[2] === 'exe-aaa';
})());

// 浏览器(h5) 不具备服务能力：不应被选为采集器
check('h5 对端不参与采集（手机 + h5 → 手机采集）', (() => {
  const r = electCollector({ self: PHONE, peers: [H5] });
  return r.role === 'collector' && r.collectorId === PHONE.id;
})());
check('本机是 h5 但有 EXE → h5 作查看端 hub=EXE', (() => {
  const r = electCollector({ self: H5, peers: [PC_A] });
  return r.role === 'viewer' && r.collectorId === PC_A.id;
})());

// 首选采集器钉住
check('钉住自己 → collector', (() => {
  const r = electCollector({ self: PHONE, peers: [PC_A], preferredCollector: PHONE.id });
  return r.role === 'collector' && r.collectorId === PHONE.id;
})());
check('钉住在线对端 → viewer 指向它', (() => {
  const r = electCollector({ self: PHONE, peers: [PC_A, PC_B], preferredCollector: PC_B.id });
  return r.role === 'viewer' && r.collectorId === PC_B.id;
})());
check('钉住的采集器离线 → 本机顶上采集（不空转）', (() => {
  const r = electCollector({ self: PHONE, peers: [PC_A], preferredCollector: 'exe-ghost' });
  return r.role === 'collector' && r.collectorId === PHONE.id;
})());

// 离线兜底：手机原为查看端，采集器信标消失（peers 空）→ 转本地采集
check('采集器离线（peers 空）→ 手机转本地采集', (() => {
  const r = electCollector({ self: PHONE, peers: [] });
  return r.role === 'collector' && r.collectorId === PHONE.id;
})());

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) { console.log('ELECTION_SELFTEST_FAIL'); process.exit(1); }
console.log('ELECTION_SELFTEST_ALL_PASS');
