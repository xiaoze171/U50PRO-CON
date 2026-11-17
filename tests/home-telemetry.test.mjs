import assert from 'node:assert/strict';
import { test } from 'node:test';

let telemetry = {};
try { telemetry = await import('../src/utils/home-telemetry.js'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const panels = (...args) => {
  assert.equal(typeof telemetry.buildHomeSignalPanels, 'function');
  return telemetry.buildHomeSignalPanels(...args);
};
const temperatures = (...args) => {
  assert.equal(typeof telemetry.buildHomeTemperatureMetrics, 'function');
  return telemetry.buildHomeTemperatureMetrics(...args);
};
const values = panel => Object.fromEntries(panel.metrics.map(item => [item.key, item.value]));
const details = panel => Object.fromEntries(panel.details.map(item => [item.label, item.value]));

test('LTE ignores residual NR fields and never substitutes RSSI for RSRP', () => {
  const [panel] = panels({ network_type: 'LTE', Z5g_rsrp: -75, Z5g_SINR: 25,
    nr5g_action_band: '78', nr5g_pci: '1A', lte_rsrq: '-13', lte_snr: '8', rssi: '-70',
    lte_ca_pcell_band: '3', lte_pci: '21', lte_ca_pcell_arfcn: '1300', lte_ca_pcell_bandwidth: '20' });
  assert.equal(panel.key, 'lte');
  assert.deepEqual(values(panel), { rsrp: '—', rsrq: '-13', sinr: '8', rssi: '-70' });
  assert.deepEqual(details(panel), { '频段': 'B3', PCI: '21', ARFCN: '1300', '带宽': '20 MHz', CA: '—' });
  assert.equal(panel.metrics[0].percent, null);
});

test('SA selects a complete NR group and ignores residual LTE and NSA bandwidth', () => {
  const result = panels({ network_type: 'NR5G-SA', Z5g_rsrp: '-91.5', Z5g_rsrq: '-10',
    Z5g_SINR: '', Z5g_snr: '12', Z5g_rssi: '-65', lte_rsrp: '-60', lte_snr: '30',
    nr5g_action_band: 'n78', nr5g_pci: '0x1a', nr5g_action_channel: 'bad', Z5g_dlEarfcn: '630000',
    nr5g_nsa_bandwidth: '100', lte_ca_pcell_bandwidth: '20', bandwidth: '20', wan_lte_ca: 'ca_activated' });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'nr');
  assert.deepEqual(values(result[0]), { rsrp: '-91.5', rsrq: '-10', sinr: '12', rssi: '-65' });
  assert.deepEqual(details(result[0]), { '频段': 'n78', PCI: '26', ARFCN: '630000', '带宽': '—', CA: '—' });
});

test('NSA is matched before SA and keeps NR and LTE anchor readings separate', () => {
  const result = panels({ network_type: 'NR5G_NSA', Z5g_rsrp: '-90', Z5g_SINR: '20',
    lte_rsrp: '-105', lte_snr: '3', nr5g_action_band: '78', nr5g_nsa_bandwidth: '100',
    lte_ca_pcell_band: '1', lte_ca_pcell_bandwidth: '15', wan_lte_ca: 'ca_activated',
    nr_multi_ca_scell_info: '1' });
  assert.deepEqual(result.map(panel => panel.key), ['nr', 'lte']);
  assert.equal(result[1].label, 'LTE 锚点');
  assert.equal(values(result[0]).rsrp, '-90');
  assert.equal(values(result[1]).rsrp, '-105');
  assert.equal(details(result[0])['带宽'], '100 MHz');
  assert.equal(details(result[1])['带宽'], '15 MHz');
  assert.equal(details(result[0]).CA, '—');
  assert.equal(details(result[1]).CA, 'LTE CA');
});

test('NR PCI hex containing e is not mistaken for decimal scientific notation', () => {
  assert.equal(details(panels({ network_type: 'SA', nr5g_pci: '1e2' })[0]).PCI, '482');
  assert.equal(details(panels({ network_type: 'SA', nr5g_pci: 'FF' })[0]).PCI, '255');
  assert.equal(details(panels({ network_type: 'SA', nr5g_pci: '26junk' })[0]).PCI, '—');
});

test('each fallback validates complete decimals and preserves a real zero', () => {
  const [nr] = panels({ network_type: 'NR5G', Z5g_rsrp: 0, Z5g_rsrq: '0', Z5g_SINR: '0', Z5g_snr: '15',
    Z5g_rssi: '-65dBm', nr5g_pci: '0', nr5g_action_channel: '0', Z5g_dlEarfcn: '1' });
  assert.deepEqual(values(nr), { rsrp: '0', rsrq: '0', sinr: '0', rssi: '—' });
  assert.equal(details(nr).PCI, '0');
  assert.equal(details(nr).ARFCN, '0');
  const [lte] = panels({ lte_rssi: 'bad', rssi: '-82.5', lte_rsrp: false, lte_rsrq: '0x10', lte_snr: 'NaN',
    lte_ca_pcell_band: 'bad', wan_active_band: 'B7', lte_ca_pcell_arfcn: '10junk', wan_active_channel: '0',
    lte_ca_pcell_bandwidth: true, bandwidth: '0' }, { network: '4G' });
  assert.deepEqual(values(lte), { rsrp: '—', rsrq: '—', sinr: '—', rssi: '-82.5' });
  assert.equal(details(lte)['频段'], 'B7');
  assert.equal(details(lte).ARFCN, '0');
  assert.equal(details(lte)['带宽'], '0 MHz');
  assert.equal(values(panels({ network_type: 'SA', Z5g_SINR: '12junk', Z5g_snr: '-2.5' })[0]).sinr, '-2.5');
});

test('unknown RAT never infers service from residual fields or lock and neighbor settings', () => {
  for (const network_type of ['', 'No Service', 'WCDMA', 'UNKNOWN']) {
    const result = panels({ network_type, Z5g_rsrp: '-70', lte_rsrp: '-80', rssi: '-50',
      nr5g_cell_lock: '1,630000,78,30', nr5g_sa_band_lock: '78', lte_band_lock: '3',
      sa_ngbr_cell_manual_result_ext: '1,630000,-70,-10,78' });
    assert.equal(result[0].key, 'unknown');
    assert.ok(result[0].metrics.every(item => item.value === '—' && item.percent === null));
    assert.ok(result[0].details.every(item => item.value === '—'));
  }
});

test('inactive live data masks all metrics and serving-cell details without changing the RAT panels', () => {
  const result = panels({ network_type: 'NSA', Z5g_rsrp: '-80', lte_rsrp: '-90',
    nr5g_action_band: '78', wan_lte_ca: 'ca_activated' }, { live: false });
  assert.deepEqual(result.map(panel => panel.key), ['nr', 'lte']);
  assert.ok(result.every(panel => panel.metrics.every(item => item.value === '—' && item.percent === null)));
  assert.ok(result.every(panel => panel.details.every(item => item.value === '—')));
});

test('CA empty and firmware sentinel flags cannot activate either RAT', () => {
  for (const sentinel of [undefined, null, '', '0', '1', '—', '--', 'broken']) {
    const result = panels({ network_type: 'NSA', nr_multi_ca_scell_info: sentinel,
      nr_ca_dl_state: '1', nr_ca_ul_state: '0', lte_multi_ca_scell_info: sentinel,
      lte_ca_scell_band: '1', lte_ca_scell_arfcn: '1' });
    assert.ok(result.every(panel => details(panel).CA === '—'), String(sentinel));
  }
  const result = panels({ network_type: 'NSA', nr_multi_ca_scell_info: '78,630000,100;41,510000,60',
    wan_lte_ca: 'ca_deactivated' });
  assert.equal(details(result[0]).CA, 'NR CA');
  assert.equal(details(result[1]).CA, '未启用');
});

test('quality bars clamp independently while retaining numeric readings and units separately', () => {
  const [panel] = panels({ network_type: 'LTE', lte_rsrp: '-150', lte_rsrq: '-5', lte_snr: '0', lte_rssi: '-60' });
  assert.deepEqual(panel.metrics.map(item => item.percent), [0, 100, 29, 100]);
  assert.deepEqual(panel.metrics.map(item => item.unit), ['dBm', 'dB', 'dB', 'dBm']);
  assert.deepEqual(panel.metrics.map(item => item.level), ['bad', 'excellent', 'fair', 'excellent']);
  assert.equal(panel.metrics[0].value, '-150');
});

test('temperature whitelist retains abnormal sensors while omitting missing and thermal protection flags', () => {
  const raw = { battery_temp: '80', wifi_chip_temp: '0', wifi_temp_level_1: '', wifi_temp_level_2: '-80',
    pm_sensor_pa1: 'bad', pm_sensor_mdm: null, therm_pa_level: '3', OOM_TEMP_PRO: '1', unknown_temp: '40' };
  const result = temperatures(raw, { batteryReading: { value: 32.5, state: 'valid', raw: '32.5' } });
  assert.deepEqual(result.map(item => [item.key, item.value, item.state]), [
    ['battery_temp', '32.5', 'valid'], ['wifi_chip_temp', '0', 'valid'],
    ['wifi_temp_level_2', '—', 'invalid'], ['pm_sensor_pa1', '—', 'invalid']
  ]);
  assert.ok(result.every(item => item.unit === '°C'));
  assert.equal(result.find(item => item.key === 'pm_sensor_pa1').note, '读数异常');
  assert.equal(raw.battery_temp, '80');
});

test('battery temperature uses only its selected-source reading including invalid and missing', () => {
  assert.deepEqual(temperatures({ battery_temp: '35' }), []);
  assert.deepEqual(temperatures({ battery_temp: '35' }, { batteryReading: { value: null, state: 'missing', raw: '' } }), []);
  const [invalid] = temperatures({ battery_temp: '35' }, { batteryReading: { value: null, state: 'invalid', raw: '-80' } });
  assert.equal(invalid.value, '—');
  assert.equal(invalid.state, 'invalid');
  const [zero] = temperatures({}, { batteryReading: { value: 0, state: 'valid', raw: '0' } });
  assert.equal(zero.value, '0');
});

test('CPU aliases choose one valid sensor reading and retain an anomaly when neither alias is valid', () => {
  const result = temperatures({ cpu_temp: 'bad', cpu_temperature: '44', soc_temp: '41' });
  assert.deepEqual(result.map(item => [item.key, item.value]), [['cpu_temp', '44'], ['soc_temp', '41']]);
  const invalid = temperatures({ cpu_temp: '-80', cpu_temperature: 'bad' });
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].state, 'invalid');
});

test('non-live temperature values are hidden and absent records remain safe', () => {
  assert.deepEqual(temperatures({ cpu_temp: '40', wifi_chip_temp: '35' }, {
    batteryReading: { value: 33, state: 'valid' }, live: false
  }), []);
  assert.deepEqual(temperatures(null), []);
  assert.equal(panels(null)[0].key, 'unknown');
});
