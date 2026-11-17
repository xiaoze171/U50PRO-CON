import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBatteryTime, batteryTimeReason, batteryModeText } from '../src/utils/battery-presentation.js';

test('time text keeps zero distinct from unavailable minutes', () => {
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 0 }), '0 分钟');
  for (const minutes of [null, undefined, '', '0', NaN, Infinity, -1]) {
    assert.equal(formatBatteryTime({ state: 'estimated', minutes }), '—');
  }
  assert.equal(formatBatteryTime(null), '—');
});

test('positive estimates below five minutes avoid a precise countdown', () => {
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 0.1 }), '少于 5 分钟');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 4.999 }), '少于 5 分钟');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 5 }), '约 5 分钟');
});

test('estimated total time rounds to five minutes before splitting hours', () => {
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 57 }), '约 55 分钟');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 58 }), '约 1 小时');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 62 }), '约 1 小时');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 63 }), '约 1 小时 5 分钟');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 600 }), '约 10 小时');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 240 }), '约 4 小时');
});

test('the 72-hour limit uses original minutes before display rounding', () => {
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 4319 }), '约 72 小时');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 4320 }), '约 72 小时');
  assert.equal(formatBatteryTime({ state: 'estimated', minutes: 4320.01 }), '超过 72 小时');
});

test('battery states override obsolete numerical estimates', () => {
  const states = {
    'not-applicable': '—', collecting: '采集中', 'low-current': '待估算',
    tapering: '缓充中', confirming: '满充确认中', full: '已充满',
    external: '—', 'low-battery': '请尽快充电', unknown: '—', unavailable: '—'
  };
  for (const [state, expected] of Object.entries(states)) {
    assert.equal(formatBatteryTime({ state, minutes: 600 }), expected, state);
  }
  assert.equal(formatBatteryTime({ state: 'unsupported', minutes: 600 }), '—');
  assert.equal(formatBatteryTime({ state: 'constructor', minutes: 600 }), '—');
  assert.equal(formatBatteryTime({ state: '__proto__', minutes: 600 }), '—');
});

test('independent inactive fields show their short applicable reason', () => {
  for (const reason of ['未充电', '未净充电', '充电中', '外接供电', '拔电后估算', '满充确认中']) {
    assert.equal(batteryTimeReason({ state: 'not-applicable', reason }), reason);
  }
  assert.equal(batteryTimeReason({ state: 'estimated', minutes: 600, reason: '' }), '');
  assert.equal(batteryTimeReason({ state: 'external', targetPercent: 100 }), '外接供电');
  assert.equal(batteryTimeReason({ state: 'external', targetPercent: 0 }), '拔电后估算');
});

test('state hints remain compact and discard interface error details', () => {
  assert.equal(batteryTimeReason({ state: 'tapering' }), '充满时间随电流变化');
  assert.equal(batteryTimeReason({ state: 'collecting' }), '等待有效采样');
  assert.equal(batteryTimeReason({ state: 'low-current' }), '电流较低');
  assert.equal(batteryTimeReason({ state: 'unknown' }), '状态待确认');
  assert.equal(batteryTimeReason({ state: 'unavailable', reason: '接口读取失败：HTTP 503 http://private/state.json' }), '读数不可用');
  assert.equal(batteryTimeReason({ state: 'unavailable', reason: '待刷新' }), '待刷新');
  assert.equal(batteryTimeReason(null), '读数不可用');
  assert.equal(batteryTimeReason({ state: 'full' }), '');
  assert.equal(batteryTimeReason({ state: 'confirming' }), '');
  assert.equal(batteryTimeReason({ state: 'low-battery' }), '');
});

test('power connection does not replace net discharge mode', () => {
  assert.equal(batteryModeText({ mode: 'charging', externalPower: true }), '充电中');
  assert.equal(batteryModeText({ mode: 'discharging', externalPower: false }), '放电中');
  assert.equal(batteryModeText({ mode: 'discharging', externalPower: true }), '插电 · 仍在放电');
  assert.equal(batteryModeText({ mode: 'external', externalPower: true }), '外接供电');
});

test('full label requires confirmation in the current normalized measurement', () => {
  assert.equal(batteryModeText({ mode: 'full', fullConfirmed: false, fullAnchorValid: true }), '满充确认中');
  assert.equal(batteryModeText({ mode: 'full', fullConfirmed: true }), '已充满');
  assert.equal(batteryModeText({ mode: 'full', fullConfirmed: null }), '满充确认中');
  assert.equal(batteryModeText({ mode: 'confirming', fullConfirmed: true }), '满充确认中');
});

test('invalid normalized modes do not expose raw device status text', () => {
  assert.equal(batteryModeText(null), '暂无读数');
  assert.equal(batteryModeText({ mode: 'unknown' }), '状态待确认');
  assert.equal(batteryModeText({ mode: 'unsupported', externalPower: true }), '状态待确认');
});
