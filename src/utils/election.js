// 采集器选举（纯函数，无副作用、无运行时依赖）。前端 services/sync.js 与自测共享同一份。
//
// 设计：每台设备用**相同的候选集合**（本机 + 可服务对端）跑**相同的确定性排序**，
// 因此各自独立算出的赢家必然一致 —— 天然收敛、无脑裂。排序键：
//   1) 平台优先级：desktop(EXE, 常驻最稳)=0 < android=1 < 其他=2
//   2) 同级再按 id 升序（字典序）取最小
// 可在设置里“钉住首选采集器”覆盖自动选举；首选离线时本机顶上，避免无人采集。

export function platformRank(platform) {
  if (platform === 'desktop') return 0; // EXE 优先作采集器（常驻 PC 最稳）
  if (platform === 'android') return 1;
  return 2;
}

// self: { id, platform }；peers: [{ id, platform, ... }]；preferredCollector: string。
// 返回 { role: 'direct'|'collector'|'viewer', collectorId: string }。
// 仅做策略判定，不解析 peer 对象、不触碰网络——调用方据 collectorId 找回 hub。
export function electCollector({ self, peers = [], preferredCollector = '' } = {}) {
  if (!self || !self.id) return { role: 'direct', collectorId: '' };
  const list = Array.isArray(peers) ? peers : [];

  if (preferredCollector) {
    if (preferredCollector === self.id) return { role: 'collector', collectorId: self.id };
    const pinned = list.find(peer => peer && peer.id === preferredCollector);
    if (pinned) return { role: 'viewer', collectorId: pinned.id };
    return { role: 'collector', collectorId: self.id }; // 首选采集器离线 → 本机顶上
  }

  const candidates = [
    { id: self.id, platform: self.platform, isSelf: true },
    ...list.filter(peer => peer && (peer.platform === 'desktop' || peer.platform === 'android'))
  ];
  candidates.sort((left, right) =>
    platformRank(left.platform) - platformRank(right.platform)
    || String(left.id).localeCompare(String(right.id)));
  const winner = candidates[0];
  if (!winner || winner.isSelf) return { role: 'collector', collectorId: self.id };
  return { role: 'viewer', collectorId: winner.id };
}
