import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBatteryCsv } from '../src/utils/battery-csv.js';
import { batterySeries, lineOption, temperatureSeries } from '../src/utils/chart-options.js';

const historyModule = await import('../src/utils/device-history.js').catch(() => ({}));
const build = (csv, options) => {
  assert.equal(typeof historyModule.buildDeviceHistory, 'function', 'device history adapter is available');
  return historyModule.buildDeviceHistory(csv, options);
};

// Hand-written records describe the device contract without reading a live export.
const columns = ['ts_iso', 'ts', 'soc', 'voltage_mv', 'current_ma', 'power_w', 'temp_c', 'status',
  'usb_online', 'input_voltage_mv', 'input_current_ma', 'input_power_w', 'download_bps', 'upload_bps',
  'net_interval_s', 'cpu_temp_c', 'modem_temp_c', 'pa_temp_c', 'network_type', 'lte_rsrp_dbm',
  'lte_rsrq_db', 'lte_snr_db', 'nr_rsrp_dbm', 'nr_rsrq_db', 'nr_sinr_db'];
const sample = {
  ts_iso: '2026-11-18 13:50:36', ts: 1795009836, soc: 91.8434, voltage_mv: 4173.017,
  current_ma: -350.952, power_w: -1.464529, temp_c: 23.1, status: 'Discharging', usb_online: 0,
  download_bps: 1557.082107, upload_bps: 1863.788027, net_interval_s: 61.14,
  cpu_temp_c: 27.3, modem_temp_c: 27.9, pa_temp_c: 24.05, network_type: 'SA',
  nr_rsrp_dbm: -92, nr_rsrq_db: -11, nr_sinr_db: 16.5
};
const line = values => columns.map(name => values[name] ?? '').join(',');
const csv = rows => parseBatteryCsv(columns.join(',') + '\n' + rows.map(row => row === null ? 'invalid' : line(row)).join('\n'));
const endpoint = 'http://name:secret@router.test:88/backup/battery-log.csv?fresh=1#history';
const stamp = Date.UTC(2026, 10, 18, 13, 50, 36);

test('history parsing retains independent telemetry when battery fields are missing or malformed', () => {
  for (const field of ['soc', 'voltage_mv', 'current_ma', 'power_w', 'temp_c', 'status']) {
    for (const value of ['', ...(field === 'status' ? [] : ['bad'])]) {
      const text = columns.join(',') + '\n' + line({ ...sample, [field]: value });
      assert.equal(parseBatteryCsv(text).rows[0], null, 'estimator remains strict');
      const history = build(parseBatteryCsv(text, { history: true }), { endpoint });
      assert.equal(history.snapshotCount, 1, field);
      assert.equal(history.deviceTimestamp, 1795009836, field);
      assert.equal(history.chart.down[0][1], 1557.082107, field);
      assert.equal(history.chart.temperatures.cpu_temp[0][1], 27.3, field);
      assert.equal(history.chart.signals.nr_rsrp[0][1], -92, field);
    }
  }
});

test('missing device battery percentages remain a gap between valid samples', () => {
  const text = columns.join(',') + '\n' + [sample,
    { ...sample, ts_iso: '2026-11-18 13:51:36', ts: 1795009896, soc: '' },
    { ...sample, ts_iso: '2026-11-18 13:52:36', ts: 1795009956, soc: 91 }
  ].map(line).join('\n');
  const history = build(parseBatteryCsv(text, { history: true }), { endpoint });
  const series = batterySeries(history.battery);
  assert.deepEqual(series[0].data.map(point => point[1]), [91.8434, null, 91]);
  const option = lineOption(series, false, {}, { now: stamp + 120000, windowMs: 180000 });
  assert.deepEqual(option.series[0].data.map(point => point.value[1]), [91.8434, null, 91]);
  assert.equal(option.series[0].connectNulls, false);
});

test('device CPU records within one minute retain their null gap through adaptation and rendering', () => {
  const history = build(csv([
    { ...sample, ts_iso: '2026-11-18 12:00:30', ts: 1795003230, cpu_temp_c: 28 },
    { ...sample, ts_iso: '2026-11-18 12:01:00', ts: 1795003260, cpu_temp_c: '' },
    { ...sample, ts_iso: '2026-11-18 12:01:30', ts: 1795003290, cpu_temp_c: 29 }
  ]), { endpoint });
  const series = temperatureSeries(history.chart.temperatures);
  const cpu = series.find(item => item.id === 'cpu_temp');
  assert.deepEqual(cpu.data.map(point => point.slice(0, 2)), [
    [1795003230000, 28], [1795003260000, null], [1795003290000, 29]
  ]);
  const option = lineOption(series, false, {}, { now: 1795003290000, windowMs: 7200000, deviceTime: true });
  const rendered = option.series.find(item => item.id === 'cpu_temp');
  assert.deepEqual(rendered.data.map(point => point.value.slice(0, 2)), [
    [1795003230000, 28], [1795003260000, null], [1795003290000, 29]
  ]);
  assert.equal(rendered.connectNulls, false);
});

test('factory CPU alias merging still prefers canonical readings in the same minute', () => {
  const series = temperatureSeries({ cpu_temp: [[80000, 31, 'foreground']],
    cpu_temperature: [[60000, 30, 'background'], [120000, 32, 'background']] });
  assert.deepEqual(series.find(item => item.id === 'cpu_temp').data, [
    [80000, 31, 'foreground'], [120000, 32, 'background']
  ]);
});

test('25-column telemetry retains named fields and validates them without losing the battery', () => {
  const parsed = csv([{ ...sample, upload_bps: 'bad', cpu_temp_c: 'NaN', modem_temp_c: '0x20',
    pa_temp_c: 'Infinity', lte_snr_db: 'bad', download_bps: 0, nr_sinr_db: 0 }]);
  assert.equal(parsed.invalidRows, 0);
  assert.equal(parsed.rows[0].soc, 91.8434);
  assert.equal(parsed.rows[0].download_bps, 0);
  assert.equal(parsed.rows[0].nr_sinr_db, 0);
  for (const field of ['upload_bps', 'cpu_temp_c', 'modem_temp_c', 'pa_temp_c', 'lte_snr_db']) {
    assert.equal(parsed.rows[0][field], null, field);
  }
  assert.equal(parsed.rows[0].network_type, 'SA');
  assert.throws(() => parseBatteryCsv(columns.join(',') + ',download_bps\n'), /duplicate/i);
});

test('device history uses wall-clock ISO calendar time and preserves raw device seconds', () => {
  const history = build(csv([sample]), { endpoint });
  assert.deepEqual(history.chart.down[0].slice(0, 4), [stamp, 1557.082107, 'device', 'B/s']);
  assert.deepEqual(history.chart.up[0].slice(0, 4), [stamp, 1863.788027, 'device', 'B/s']);
  assert.deepEqual(history.sourceCounts, { device: 1 });
  assert.equal(history.snapshotCount, 1);
  assert.equal(history.latestTimestamp, stamp);
  assert.equal(history.deviceTimestamp, 1795009836);
  assert.equal(history.battery[0].deviceTimestamp, 1795009836);
  assert.equal(new Date(history.latestTimestamp).getUTCHours(), 13);
  assert.equal(new Date(history.latestTimestamp).getUTCMinutes(), 50);
  assert.equal(history.latestWallClock, '2026-11-18 13:50:36');
  assert.deepEqual(history.battery[0], {
    timestamp: stamp, wallClock: '2026-11-18 13:50:36', deviceTimestamp: 1795009836, percent: 91.8434, percentSource: 'gauge88',
    percentEndpoint: 'http://router.test:88/state.json', source: 'device', charging: false,
    temperature: 23.1, voltage: 4173.017, current: -350.952, chargeType: 'Discharging',
    externalPower: false, identity: history.chart.down[0][4]
  });
});

test('LTE and NR remain independent and temperature columns use existing chart keys', () => {
  const history = build(csv([{ ...sample, network_type: 'NSA', lte_rsrp_dbm: -110,
    lte_rsrq_db: -16, lte_snr_db: 8, nr_rsrp_dbm: -90, nr_rsrq_db: -10, nr_sinr_db: 18 }]), { endpoint });
  assert.deepEqual(Object.keys(history.chart.signals), ['lte_rsrp', 'lte_rsrq', 'lte_snr', 'nr_rsrp', 'nr_rsrq', 'nr_sinr']);
  for (const [key, expected] of Object.entries({ lte_rsrp: -110, lte_rsrq: -16, lte_snr: 8,
    nr_rsrp: -90, nr_rsrq: -10, nr_sinr: 18 })) assert.equal(history.chart.signals[key][0][1], expected, key);
  for (const [key, expected] of Object.entries({ battery_temp: 23.1, cpu_temp: 27.3,
    pm_sensor_mdm: 27.9, pm_sensor_pa1: 24.05 })) assert.equal(history.chart.temperatures[key][0][1], expected, key);
});

test('8 and 12 column legacy records have battery history and null telemetry', () => {
  for (const count of [8, 12]) {
    const legacy = parseBatteryCsv(columns.slice(0, count).join(',') + '\n'
      + columns.slice(0, count).map(name => sample[name] ?? '').join(','));
    const history = build(legacy, { endpoint });
    assert.equal(history.battery.length, 1);
    assert.equal(history.battery[0].percent, 91.8434);
    assert.equal(history.chart.down[0][1], null);
    assert.equal(history.chart.up[0][1], null);
    assert.equal(history.chart.temperatures.cpu_temp[0][1], null);
    assert.equal(history.chart.signals.nr_rsrp[0][1], null);
  }
});

test('zero telemetry is retained while negative rates or invalid intervals remain missing', () => {
  const history = build(csv([
    { ...sample, download_bps: 0, upload_bps: 0, nr_sinr_db: 0 },
    { ...sample, ts_iso: '2026-11-18 13:51:36', ts: 1795009896, download_bps: -1 },
    { ...sample, ts_iso: '2026-11-18 13:52:36', ts: 1795009956, net_interval_s: 0 }
  ]), { endpoint });
  assert.deepEqual(history.chart.down.map(point => point[1]), [0, null, null]);
  assert.deepEqual(history.chart.up.map(point => point[1]), [0, 1863.788027, null]);
  assert.equal(history.chart.signals.nr_sinr[0][1], 0);
});

test('a later duplicate replaces the whole atomic record including missing telemetry', () => {
  const history = build(csv([sample, { ...sample, soc: 90, current_ma: -100, download_bps: '',
    network_type: 'LTE', nr_rsrp_dbm: '', nr_rsrq_db: '', nr_sinr_db: '', lte_rsrp_dbm: -105 }]), { endpoint });
  assert.equal(history.snapshotCount, 1);
  assert.equal(history.battery[0].percent, 90);
  assert.equal(history.battery[0].current, -100);
  assert.equal(history.chart.down[0][1], null);
  assert.equal(history.chart.signals.nr_rsrp[0][1], null);
  assert.equal(history.chart.signals.lte_rsrp[0][1], -105);
  assert.equal(history.diagnostics.duplicateRows, 1);
});

test('invalid rows and a missing interval create continuity boundaries without invented timestamps', () => {
  const history = build(csv([sample, null,
    { ...sample, ts_iso: '2026-11-18 13:51:36', ts: 1795009896 },
    { ...sample, ts_iso: '2026-11-18 13:55:36', ts: 1795010136 }
  ]), { endpoint });
  assert.deepEqual(history.chart.down.map(point => point[0]), [stamp,
    Date.UTC(2026, 10, 18, 13, 51, 36), Date.UTC(2026, 10, 18, 13, 55, 36)]);
  assert.notEqual(history.chart.down[0][4], history.chart.down[1][4]);
  assert.notEqual(history.chart.down[1][4], history.chart.down[2][4]);
  assert.equal(history.diagnostics.invalidRows, 1);
  assert.equal(history.diagnostics.droppedRows, 1);
});

test('signal identities change at a network mode boundary', () => {
  const history = build(csv([sample,
    { ...sample, ts_iso: '2026-11-18 13:51:36', ts: 1795009896, network_type: 'NSA' }
  ]), { endpoint });
  assert.notEqual(history.chart.signals.nr_rsrp[0][4], history.chart.signals.nr_rsrp[1][4]);
  assert.equal(history.chart.down[0][4], history.chart.down[1][4]);
});

test('strict calendar validation drops malformed ISO rows while breaking valid neighbors', () => {
  const invalid = ['2026-02-30 13:50:36', '2026-11-18T13:50:36Z', '2026-11-18 24:00:00',
    '2026-11-18 13:60:00', '2026-11-18 13:50:60', '', '2026-11-18 13:50:36junk'];
  for (const ts_iso of invalid) {
    const history = build(csv([sample, { ...sample, ts_iso, ts: 1795009896 },
      { ...sample, ts_iso: '2026-11-18 13:52:36', ts: 1795009956 }
    ]), { endpoint });
    assert.equal(history.snapshotCount, 2, ts_iso);
    assert.notEqual(history.chart.down[0][4], history.chart.down[1][4], ts_iso);
    assert.equal(history.diagnostics.invalidTimestampRows, 1, ts_iso);
  }
});

test('clock reversal retains only the last monotonic suffix rather than sorting old history into it', () => {
  const history = build(csv([
    { ...sample, ts_iso: '2026-11-18 13:49:36', ts: 1795009776 }, sample,
    { ...sample, ts_iso: '2026-11-18 12:50:36', ts: 1795006236, soc: 88 },
    { ...sample, ts_iso: '2026-11-18 12:51:36', ts: 1795006296, soc: 87 }
  ]), { endpoint });
  assert.equal(history.snapshotCount, 2);
  assert.deepEqual(history.battery.map(row => row.percent), [88, 87]);
  assert.deepEqual(history.chart.down.map(point => point[0]), [Date.UTC(2026, 10, 18, 12, 50, 36),
    Date.UTC(2026, 10, 18, 12, 51, 36)]);
  assert.equal(history.latestTimestamp, Date.UTC(2026, 10, 18, 12, 51, 36));
  assert.equal(history.deviceTimestamp, 1795006296);
  assert.equal(history.diagnostics.reversedRows, 1);
  assert.equal(history.diagnostics.droppedRows, 2);
});

test('raw device clock reversal also bounds history even when calendar text increases', () => {
  const history = build(csv([sample,
    { ...sample, ts_iso: '2026-11-18 13:51:36', ts: 1795006000 }
  ]), { endpoint });
  assert.equal(history.snapshotCount, 1);
  assert.equal(history.deviceTimestamp, 1795006000);
  assert.equal(history.diagnostics.reversedRows, 1);
});

test('charging is tri-state and never guessed from Full or unfamiliar device status', () => {
  const history = build(csv(['Charging', 'Discharging', 'Full', 'Not charging', 'Balancing'].map((status, index) => ({
    ...sample, status, ts_iso: `2026-11-18 13:${50 + index}:36`, ts: 1795009836 + index * 60
  }))), { endpoint });
  assert.deepEqual(history.battery.map(row => row.charging), [true, false, null, null, null]);
});

test('empty histories expose no fabricated latest time or source counts', () => {
  const history = build(parseBatteryCsv(columns.join(',')), { endpoint });
  assert.equal(history.latestTimestamp, null);
  assert.equal(history.deviceTimestamp, null);
  assert.deepEqual(history.sourceCounts, { device: 0 });
  assert.equal(history.snapshotCount, 0);
  assert.deepEqual(history.battery, []);
  assert.deepEqual(history.chart.down, []);
});

test('missing USB state stays unknown rather than fabricating disconnected external power', () => {
  const history = build(csv([{ ...sample, usb_online: '' }]), { endpoint });
  assert.equal(history.battery[0].externalPower, null);
});
