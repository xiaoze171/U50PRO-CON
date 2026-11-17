import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { importBatteryProfileClient } from './helpers/battery-profile-client.mjs';

// Only the Android transport boundary is mocked. Production authentication,
// request serialization, encoding, validation, retries and UI actions execute.
async function createClient(t, options = {}) {
  const originalWindow = globalThis.window;
  const originalUni = globalThis.uni;
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) =>
    realSetTimeout(callback, ms <= 500 ? 0 : ms, ...args));
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network access forbidden in API contract tests'); });
  t.after(() => { globalThis.window = originalWindow; globalThis.uni = originalUni; });
  const storage = new Map([['mu5120-config', {
    routerUrl: 'http://router.invalid', password: 'fixture-password'
  }]]);
  const requests = [];
  const smsSnapshots = [];
  const state = {
    fields: { loginfo: 'ok', developer_option_loginfo: 'ok', wa_inner_version: 'fixture-fw',
      cr_version: 'fixture-cr', LD: 'fixture-login-token', lte_band_lock: '0',
      nr5g_sa_band_lock: '', nr5g_nsa_band_lock: '', ...options.fields },
    rd: 0,
    smsStatus: { 1: ['3'], 4: ['3'], 6: ['3'], ...options.smsStatus },
    messages: options.messages || [],
    capacity: { sms_nv_total: '500', sms_nv_rev_total: '2', sms_nv_send_total: '1', sms_nv_draftbox_total: '0' }
  };
  const defaultReply = request => {
    if (request.method === 'POST') {
      if (request.form.goformId === 'LOGIN') state.fields.loginfo = 'ok';
      if (request.form.goformId === 'DEVELOPER_OPTION_LOGIN') state.fields.developer_option_loginfo = 'ok';
      return { result: 'success' };
    }
    if (request.url.pathname === '/index.html') return '<html>fixture</html>';
    if (request.command === 'sms_cmd_status_info') {
      const statuses = state.smsStatus[request.query.sms_cmd];
      assert.ok(statuses, 'unexpected SMS command');
      return { sms_cmd_status_result: statuses.length > 1 ? statuses.shift() : statuses[0] };
    }
    if (request.command === 'sms_data_total') return { messages: state.messages };
    if (request.command === 'sms_capacity_info') return state.capacity;
    if (request.command === 'RD') return { RD: `fixture-write-token-${++state.rd}` };
    assert.equal(request.url.pathname, '/goform/goform_get_cmd_process');
    return Object.fromEntries(request.command.split(',').map(field => [field, state.fields[field] ?? '']));
  };
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    request() { throw new Error('Browser transport forbidden in API contract tests'); }
  };
  globalThis.window = { AndroidRouter: {
    updateBackgroundSms(raw) { smsSnapshots.push(JSON.parse(raw)); },
    request(id, raw) {
      const payload = JSON.parse(raw);
      const url = new URL(payload.url);
      assert.equal(url.origin, 'http://router.invalid');
      const request = { ...payload, url, command: url.searchParams.get('cmd') || '',
        query: Object.fromEntries(url.searchParams), form: Object.fromEntries(new URLSearchParams(payload.body)) };
      requests.push(request);
      const body = options.reply?.(request, state) ?? defaultReply(request);
      const envelope = body instanceof Error
        ? { ok: false, status: 503, error: body.message }
        : { ok: true, status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) };
      queueMicrotask(() => window.__mu5120NativeResponse(id, JSON.stringify(envelope)));
    }
  } };
  const { routerApi: api } = await importBatteryProfileClient('factory');
  return { api, state, requests, smsSnapshots,
    writes: () => requests.filter(request => request.method === 'POST'),
    commands: command => requests.filter(request => request.command === command) };
}

const page = readFileSync(new URL('../src/pages/index/index.vue', import.meta.url), 'utf8');
const script = page.split('<script setup>')[1].split('</script>')[0];
const ast = parse(script, { sourceType: 'module' });
function pageAction(name, context) {
  const node = ast.program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} must remain an executable UI action`);
  return runInNewContext(`(${script.slice(node.start, node.end)})`, context);
}

test('neighbor scanning rejects firmware failure instead of announcing a sent command', async t => {
  const client = await createClient(t, { reply: request =>
    request.form.goformId === 'SCAN_NR5G_NEIGHBOR_CELL' ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.scanNeighbors(), /固件拒绝.*扫描/);
});

test('unlock all rejects when firmware refuses both radios and still attempts both', async t => {
  const client = await createClient(t, { reply: request =>
    /^(NR5G|LTE)_LOCK_CELL_SET$/.test(request.form.goformId) ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.unlockAllCellLocks(), /固件拒绝.*解除锁定/);
  assert.deepEqual(client.writes().map(request => request.form.goformId), ['NR5G_LOCK_CELL_SET', 'LTE_LOCK_CELL_SET']);
});

test('unlock all exposes partial firmware failure for the UI to display', async t => {
  const client = await createClient(t, { reply: request =>
    request.form.goformId === 'NR5G_LOCK_CELL_SET' ? { result: 'failure' } : undefined });
  const result = await client.api.unlockAllCellLocks();
  assert.equal(result.partial?.length, 1);
  assert.match(result.partial[0], /5G.*解除锁定/);
});

test('unlock UI reports partial completion without claiming both radios unlocked', async () => {
  let refreshes = 0;
  const context = { actionBusy: { value: false }, radioActionResult: { value: '' },
    routerApi: { unlockAllCellLocks: async () => ({ result: 'success', partial: ['5G 解除锁定失败'] }) },
    refresh: async () => { refreshes++; } };
  await pageAction('unlockAllCells', context)();
  assert.match(context.radioActionResult.value, /部分/);
  assert.match(context.radioActionResult.value, /5G 解除锁定失败/);
  assert.doesNotMatch(context.radioActionResult.value, /已解除小区锁定（5G 与 LTE）/);
  assert.equal(refreshes, 1);
  assert.equal(context.actionBusy.value, false);
});

test('SMS readiness prevents reading or replacing the saved message snapshot', async t => {
  const client = await createClient(t, { smsStatus: { 1: ['1'] } });
  const result = await client.api.listSms();
  assert.deepEqual(result, { ready: { sms_cmd_status_result: '1' }, messages: [], capacity: {} });
  assert.equal(client.commands('sms_data_total').length, 0);
  assert.equal(client.commands('sms_capacity_info').length, 0);
  assert.equal(client.smsSnapshots.length, 0);
});

test('SMS list decodes UTF-16 including surrogate pairs and preserves raw content and capacity', async t => {
  const encoded = '9A8C8BC17801003100320033003400200026D83DDE00';
  const client = await createClient(t, { messages: {
    first: { id: '7', number: '10086', content: encoded, date: '26,11,17,10,20,30' },
    second: { id: '8', number: '+15550123', content: 'plain text' }
  } });
  const result = await client.api.listSms();
  assert.deepEqual(result.messages.map(item => [item.id, item.content, item.rawContent]),
    [['7', '验证码1234 &😀', encoded], ['8', 'plain text', 'plain text']]);
  assert.equal(result.source, 'foreground');
  assert.equal(result.capacity.sms_nv_total, '500');
  assert.deepEqual(client.smsSnapshots[0], result);
  const query = client.commands('sms_data_total')[0].query;
  assert.deepEqual({ page: query.page, data_per_page: query.data_per_page, mem_store: query.mem_store,
    tags: query.tags, order_by: query.order_by },
  { page: '0', data_per_page: '500', mem_store: '1', tags: '10', order_by: 'order by id desc' });
});

test('SMS send encodes Unicode safely and waits for final modem success', async t => {
  const client = await createClient(t, { smsStatus: { 4: ['1', '1', '3'] } });
  const result = await client.api.sendSms(' +15550123456 ', '你好 &😀');
  assert.equal(result.result, 'success');
  const write = client.writes()[0];
  assert.equal(write.form.goformId, 'SEND_SMS');
  assert.equal(write.form.Number, '+15550123456');
  assert.equal(write.form.MessageBody, '4F60597D00200026D83DDE00');
  assert.equal(write.form.ID, '-1');
  assert.equal(write.form.encode_type, 'UNICODE');
  assert.match(write.form.sms_time, /^\d{2}(;\d{2}){5};[+-]\d+(\.\d+)?$/);
  assert.match(write.body, /Number=%2B15550123456/);
  assert.equal(client.commands('sms_cmd_status_info').length, 3);
  assert.ok(client.commands('sms_cmd_status_info').every(request => request.query.sms_cmd === '4'));
});

test('SMS send returns modem failure rather than premature submission success', async t => {
  const client = await createClient(t, { smsStatus: { 4: ['2'] } });
  assert.equal((await client.api.sendSms('10086', 'fixture')).result, 'failure');
  assert.equal(client.commands('sms_cmd_status_info').length, 1);
});

test('SMS send bounds pending-state polling and preserves a pending result', async t => {
  const client = await createClient(t, { smsStatus: { 4: ['1'] } });
  assert.deepEqual(await client.api.sendSms('10086', 'fixture'), { result: 'pending' });
  assert.equal(client.commands('sms_cmd_status_info').length, 12);
});

test('SMS submission rejection is returned without polling an unrelated send state', async t => {
  const client = await createClient(t, { reply: request =>
    request.form.goformId === 'SEND_SMS' ? { result: 'failure' } : undefined });
  assert.deepEqual(await client.api.sendSms('10086', 'fixture'), { result: 'failure' });
  assert.equal(client.commands('sms_cmd_status_info').length, 0);
});

test('invalid SMS recipients or content cause no write', async t => {
  const client = await createClient(t);
  for (const [number, message] of [['12', 'text'], ['abc', 'text'], ['10086', ''], ['10086', 'x'.repeat(671)]]) {
    await assert.rejects(client.api.sendSms(number, message), /手机号|内容长度/);
  }
  assert.equal(client.writes().length, 0);
});

test('SMS deletion normalizes IDs once and confirms the asynchronous result', async t => {
  const client = await createClient(t, { smsStatus: { 6: ['1', '3'] } });
  const result = await client.api.deleteSms([0, ' 7 ', '7', '8', '', null]);
  assert.equal(result.result, 'success');
  assert.equal(client.writes()[0].form.goformId, 'DELETE_SMS');
  assert.equal(client.writes()[0].form.msg_id, '0;7;8;');
  assert.equal(client.commands('sms_cmd_status_info').length, 2);
  assert.ok(client.commands('sms_cmd_status_info').every(request => request.query.sms_cmd === '6'));
});

test('SMS deletion reports modem failure and confirmation timeout', async t => {
  const client = await createClient(t, { smsStatus: { 6: ['2'] } });
  await assert.rejects(client.api.deleteSms('7'), /删除短信失败/);
  client.state.smsStatus[6] = ['1'];
  await assert.rejects(client.api.deleteSms('8'), /确认超时/);
  assert.equal(client.commands('sms_cmd_status_info').length, 21);
});

test('SMS deletion rejects invalid IDs and firmware rejection without false confirmation', async t => {
  const client = await createClient(t, { reply: request =>
    request.form.goformId === 'DELETE_SMS' ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.deleteSms([]), /选择/);
  await assert.rejects(client.api.deleteSms(['7;8']), /ID 格式/);
  assert.equal(client.writes().length, 0);
  await assert.rejects(client.api.deleteSms('7'), /固件拒绝.*删除短信/);
  assert.equal(client.commands('sms_cmd_status_info').length, 0);
});

test('traffic plan writes firmware units, switches and rounded thresholds', async t => {
  const client = await createClient(t);
  await client.api.setTrafficPlan({ enabled: true, sizeGb: 12.34, alertPercent: 80.4, autoClear: true, clearDate: ' 15 ' });
  const { AD, ...form } = client.writes()[0].form;
  assert.deepEqual(form, { isTest: 'false', goformId: 'DATA_LIMIT_SETTING',
    data_volume_limit_switch: '1', data_volume_limit_unit: 'data', data_volume_limit_size: '12.34_1024',
    data_volume_alert_percent: '80', wan_auto_clear_flow_data_switch: 'on', traffic_clear_date: '15' });
  assert.match(AD, /^[A-F0-9]{64}$/);
  await client.api.setTrafficPlan({ enabled: false, sizeGb: 0, alertPercent: 0, autoClear: false, clearDate: '' });
  const disabled = client.writes()[1].form;
  assert.equal(disabled.data_volume_limit_switch, '0');
  assert.equal(disabled.data_volume_limit_size, '0_1024');
  assert.equal(disabled.wan_auto_clear_flow_data_switch, 'off');
  assert.equal(disabled.traffic_clear_date, '1');
});

test('traffic calibration converts fractional GB to bytes and permits a zero reset', async t => {
  const client = await createClient(t);
  await client.api.calibrateTraffic({ gigabytes: 1.5 });
  const { AD, ...form } = client.writes()[0].form;
  assert.deepEqual(form, { isTest: 'false', goformId: 'FLOW_CALIBRATION_MANUAL', calibration_way: 'data', data: '1610612736', time: '0' });
  await client.api.calibrateTraffic({ gigabytes: 0 });
  assert.equal(client.writes()[1].form.data, '0');
});

test('traffic validation and firmware errors cannot be reported as saved', async t => {
  const client = await createClient(t, { reply: request =>
    ['DATA_LIMIT_SETTING', 'FLOW_CALIBRATION_MANUAL'].includes(request.form.goformId) ? { result: 'failure' } : undefined });
  const valid = { enabled: true, sizeGb: 100, alertPercent: 80, clearDate: '1' };
  for (const invalid of [{ sizeGb: -1 }, { sizeGb: 'bad' }, { alertPercent: 101 }, { clearDate: '32' }, { clearDate: '1.5' }]) {
    await assert.rejects(client.api.setTrafficPlan({ ...valid, ...invalid }), /套餐流量|提醒百分比|清零日期/);
  }
  await assert.rejects(client.api.calibrateTraffic({ gigabytes: -1 }), /已用流量必须/);
  await assert.rejects(client.api.calibrateTraffic({ gigabytes: Infinity }), /已用流量必须/);
  assert.equal(client.writes().length, 0);
  await assert.rejects(client.api.setTrafficPlan(valid), /固件拒绝.*流量设置/);
  await assert.rejects(client.api.calibrateTraffic({ gigabytes: 1 }), /固件拒绝.*校准/);
});

test('LTE band masks preserve high bits, deduplicate selections and use zero to unlock', async t => {
  const client = await createClient(t, { fields: { lte_band_lock: '0x0000010000000005' } });
  await client.api.setLteBands([1, 3, 41, 3]);
  assert.equal(client.writes()[0].form.goformId, 'BAND_SELECT');
  assert.equal(client.writes()[0].form.lte_band_mask, '0x0000010000000005');
  assert.equal(client.writes()[0].form.is_lte_band, '1');
  assert.equal(client.writes()[0].form.gw_band_mask, '0');
  client.state.fields.lte_band_lock = '';
  await client.api.setLteBands([]);
  assert.equal(client.writes()[1].form.lte_band_mask, '0x0000000000000000');
  assert.equal(client.writes()[1].form.is_lte_band, '1');
});

test('LTE band write retries once and rejects a readback that never matches', async t => {
  const client = await createClient(t, { fields: { lte_band_lock: '0x0' } });
  await assert.rejects(client.api.setLteBands([1]), /未确认 LTE/);
  assert.equal(client.writes().filter(request => request.form.goformId === 'BAND_SELECT').length, 2);
  assert.equal(client.commands('lte_band_lock').length, 6);
});

test('NR band selection distinguishes SA and NSA and accepts supported firmware bands outside UI presets', async t => {
  const client = await createClient(t, { fields: { nr5g_sa_band_lock: 'n229;n78;n78', nr5g_nsa_band_lock: '41,78' } });
  await client.api.setNrBands('sa', [78, 229, 78]);
  await client.api.setNrBands('nsa', [41, 78]);
  const writes = client.writes();
  assert.equal(writes[0].form.goformId, 'WAN_PERFORM_NR5G_SANSA_BAND_LOCK');
  assert.equal(writes[0].form.nr5g_band_mask, '78,229');
  assert.equal(writes[0].form.type, '0');
  assert.equal(writes[1].form.nr5g_band_mask, '41,78');
  assert.equal(writes[1].form.type, '1');
});

test('NR band lock falls back to the legacy endpoint after modern firmware rejection', async t => {
  const client = await createClient(t, { fields: { nr5g_sa_band_lock: '78' }, reply: request =>
    request.form.goformId === 'WAN_PERFORM_NR5G_SANSA_BAND_LOCK' ? { result: 'failure' } : undefined });
  await client.api.setNrBands('sa', [78]);
  assert.deepEqual(client.writes().map(request => request.form.goformId),
    ['WAN_PERFORM_NR5G_SANSA_BAND_LOCK', 'WAN_PERFORM_NR5G_SANSA_BAND_LOCK', 'WAN_PERFORM_NR5G_BAND_LOCK']);
  assert.equal(client.writes()[2].form.nr5g_band_mask, '78');
  assert.equal(client.writes()[2].form.type, undefined);
});

test('NR unlock treats an empty mode-specific field as unlocked despite the capability list', async t => {
  const client = await createClient(t, { fields: { nr5g_sa_band_lock: '', nr5g_band_lock: '1,3,41,78' } });
  await client.api.setNrBands('sa', []);
  assert.equal(client.writes().length, 1);
  assert.equal(client.writes()[0].form.nr5g_band_mask, '0');
});

test('unsupported LTE and NR bands reject before sending any request', async t => {
  const client = await createClient(t);
  await assert.rejects(client.api.setLteBands([2]), /频段不支持/);
  await assert.rejects(client.api.setNrBands('sa', [262]), /频段不支持/);
  assert.equal(client.requests.length, 0);
});

test('linked cell lock writes only the selected radio without changing band restrictions', async t => {
  const client = await createClient(t);
  await client.api.linkedCellLock({ rat: 'NR', pci: 0, arfcn: 627264, band: 'n78', scs: 30 });
  await client.api.linkedCellLock({ rat: 'LTE', pci: 503, arfcn: 1650 });
  const forms = client.writes().map(({ form: { AD, ...form } }) => form);
  assert.deepEqual(forms, [
    { isTest: 'false', goformId: 'NR5G_LOCK_CELL_SET', nr5g_cell_lock: '0,627264,78,30' },
    { isTest: 'false', goformId: 'LTE_LOCK_CELL_SET', lte_pci_lock: '503', lte_earfcn_lock: '1650' }
  ]);
});

test('individual cell unlocks use the firmware sentinels without candidate data', async t => {
  const client = await createClient(t);
  await client.api.setNrCellLock({ unlock: true });
  await client.api.setLteCellLock({ unlock: true });
  assert.equal(client.writes()[0].form.nr5g_cell_lock, '1,1,1,1');
  assert.equal(client.writes()[1].form.lte_pci_lock, '');
  assert.equal(client.writes()[1].form.lte_earfcn_lock, '');
});

test('cell lock validates numeric bounds and rejects firmware failures', async t => {
  const client = await createClient(t, { reply: request =>
    /^(NR5G|LTE)_LOCK_CELL_SET$/.test(request.form.goformId) ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.linkedCellLock({ rat: 'NR', pci: 1008, arfcn: 627264, band: 78, scs: 30 }), /5G PCI/);
  await assert.rejects(client.api.setNrCellLock({ pci: 1, arfcn: 800001, band: 78, scs: 30 }), /NR-ARFCN/);
  await assert.rejects(client.api.setLteCellLock({ pci: 504, arfcn: 1 }), /LTE PCI/);
  assert.equal(client.writes().length, 0);
  await assert.rejects(client.api.setNrCellLock({ pci: 1, arfcn: 627264, band: 78, scs: 30 }), /固件拒绝.*5G/);
  await assert.rejects(client.api.setLteCellLock({ pci: 1, arfcn: 1650 }), /固件拒绝.*LTE/);
});

test('unlock all attempts the other radio after a transport failure and retains its label', async t => {
  const client = await createClient(t, { reply: request =>
    request.form.goformId === 'NR5G_LOCK_CELL_SET' ? new Error('fixture network failure') : undefined });
  const result = await client.api.unlockAllCellLocks();
  assert.equal(client.writes().length, 2);
  assert.equal(client.writes()[1].form.lte_pci_lock, '');
  assert.match(result.partial[0], /5G.*fixture network failure/);
});

test('device actions serialize writes with a fresh RD-derived token for every command', async t => {
  const client = await createClient(t);
  const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();
  await Promise.all(['wifi-on', 'wifi-off', 'reboot', 'shutdown'].map(action => client.api.controlDevice(action)));
  assert.deepEqual(client.writes().map(request => request.form.goformId),
    ['SET_WIFI_INFO', 'SET_WIFI_INFO', 'REBOOT_DEVICE', 'SHUTDOWN_DEVICE']);
  assert.deepEqual(client.writes().slice(0, 2).map(request => request.form.wifiEnabled), ['1', '0']);
  assert.equal(client.commands('wa_inner_version,cr_version').length, 1);
  const tokenAndWrite = client.requests.filter(request => request.command === 'RD' || request.method === 'POST');
  assert.deepEqual(tokenAndWrite.map(request => request.command || request.form.goformId),
    ['RD', 'SET_WIFI_INFO', 'RD', 'SET_WIFI_INFO', 'RD', 'REBOOT_DEVICE', 'RD', 'SHUTDOWN_DEVICE']);
  for (const [index, request] of client.writes().entries()) {
    assert.equal(request.form.AD, hash(hash('fixture-fwfixture-cr') + `fixture-write-token-${index + 1}`));
    assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
    assert.equal(request.headers['X-Requested-With'], 'XMLHttpRequest');
  }
});

test('missing write token and unknown device actions cannot issue a control POST', async t => {
  const client = await createClient(t, { reply: request => request.command === 'RD' ? {} : undefined });
  await assert.rejects(client.api.controlDevice('unsupported'), /不支持/);
  await assert.rejects(client.api.controlDevice('reboot'), /动态令牌 RD/);
  assert.equal(client.writes().length, 0);
});

test('write queue remains usable after a failed transport request', async t => {
  let first = true;
  const client = await createClient(t, { reply: request => {
    if (request.form.goformId === 'SET_WIFI_INFO' && first) { first = false; return new Error('fixture transport failure'); }
  } });
  await assert.rejects(client.api.controlDevice('wifi-on'), /fixture transport failure/);
  assert.equal((await client.api.controlDevice('wifi-on')).result, 'success');
  assert.equal(client.writes().length, 2);
  assert.notEqual(client.writes()[0].form.AD, client.writes()[1].form.AD);
});

test('expired main authentication refreshes the login before an operation is allowed', async t => {
  const client = await createClient(t, { fields: { loginfo: '' } });
  await client.api.controlDevice('wifi-on');
  const writes = client.writes();
  assert.deepEqual(writes.map(request => request.form.goformId), ['LOGIN', 'SET_WIFI_INFO']);
  const hash = value => createHash('sha256').update(value).digest('hex').toUpperCase();
  assert.equal(writes[0].form.password, hash(hash('fixture-password') + 'fixture-login-token'));
  assert.equal(writes[0].form.AD, undefined);
  assert.equal(client.requests[1].url.pathname, '/index.html');
});

test('failed main authentication prevents the requested destructive action', async t => {
  const client = await createClient(t, { fields: { loginfo: '' }, reply: request =>
    request.form.goformId === 'LOGIN' ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.controlDevice('shutdown'), /登录失败/);
  assert.deepEqual(client.writes().map(request => request.form.goformId), ['LOGIN']);
});

test('missing developer authentication restores main and developer sessions before locking', async t => {
  const client = await createClient(t, { fields: { developer_option_loginfo: '' } });
  await client.api.setLteCellLock({ pci: 1, arfcn: 1650 });
  assert.deepEqual(client.writes().map(request => request.form.goformId),
    ['LOGIN', 'DEVELOPER_OPTION_LOGIN', 'LTE_LOCK_CELL_SET']);
  assert.match(client.writes()[1].form.AD, /^[A-F0-9]{64}$/);
  assert.equal(client.writes()[1].form.password, client.writes()[0].form.password);
});

test('unconfirmed developer authentication cannot write a cell lock', async t => {
  const client = await createClient(t, { fields: { developer_option_loginfo: '' }, reply: request =>
    request.form.goformId === 'DEVELOPER_OPTION_LOGIN' ? { result: 'failure' } : undefined });
  await assert.rejects(client.api.setLteCellLock({ pci: 1, arfcn: 1650 }), /开发者认证失败/);
  assert.ok(client.writes().every(request => request.form.goformId !== 'LTE_LOCK_CELL_SET'));
});

test('unlock UI only announces full completion after both radios succeed', async () => {
  const context = { actionBusy: { value: false }, radioActionResult: { value: '' },
    routerApi: { unlockAllCellLocks: async () => ({ result: 'success' }) }, refresh: async () => {} };
  await pageAction('unlockAllCells', context)();
  assert.match(context.radioActionResult.value, /已解除.*5G 与 LTE/);
  context.routerApi.unlockAllCellLocks = async () => { throw new Error('fixture unlock rejection'); };
  await pageAction('unlockAllCells', context)();
  assert.equal(context.radioActionResult.value, 'fixture unlock rejection');
  assert.equal(context.actionBusy.value, false);
});

test('scan UI surfaces firmware rejection without scheduling a success refresh', async () => {
  const context = { actionBusy: { value: false }, radioActionResult: { value: '' },
    routerApi: { scanNeighbors: async () => { throw new Error('fixture scan rejection'); } },
    setTimeout() { assert.fail('failed scan must not schedule a success refresh'); } };
  await pageAction('scanNeighbors', context)();
  assert.equal(context.radioActionResult.value, 'fixture scan rejection');
  assert.equal(context.actionBusy.value, false);
});

test('destructive device UI waits for confirmation and reports firmware rejection', async () => {
  let calls = 0;
  const context = { actionBusy: { value: false }, deviceActionResult: { value: '' },
    confirmAction: async () => false,
    routerApi: { controlDevice: async () => { calls++; return { result: 'failure' }; } } };
  for (const action of ['wifi-off', 'reboot', 'shutdown']) await pageAction('runDeviceAction', context)(action);
  assert.equal(calls, 0);
  context.confirmAction = async () => true;
  await pageAction('runDeviceAction', context)('shutdown');
  assert.equal(calls, 1);
  assert.match(context.deviceActionResult.value, /failure/);
  assert.doesNotMatch(context.deviceActionResult.value, /命令已执行/);
  assert.equal(context.actionBusy.value, false);
});
