<template>
  <view class="app-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <view class="brand-block">
        <view class="brand-mark">M</view>
        <view>
          <text class="brand-title">MU5120</text>
          <text class="brand-subtitle">移动网络控制台</text>
        </view>
      </view>

      <view class="connection-card">
        <view class="connection-line">
          <view class="status-dot" :class="connected ? 'online' : 'offline'"></view>
          <text>{{ connected ? '路由器已连接' : connectionMessage }}</text>
        </view>
        <text class="connection-address">{{ config.routerUrl }}</text>
      </view>

      <view class="nav-list">
        <button
          v-for="item in tabs"
          :key="item.id"
          class="nav-button"
          :class="{ active: activeTab === item.id }"
          @click="switchTab(item.id)"
        >
          <component :is="item.icon" :size="19" :stroke-width="1.9" />
          <text>{{ item.label }}</text>
          <text v-if="item.badge" class="nav-badge">{{ item.badge }}</text>
        </button>
      </view>

      <view class="sidebar-footer">
        <text>每秒自动刷新</text>
        <text>{{ clock }}</text>
      </view>
    </aside>

    <view v-if="menuOpen" class="sidebar-mask" @click="menuOpen = false"></view>

    <main class="main-area">
      <header class="topbar">
        <button class="icon-button mobile-menu" aria-label="打开菜单" @click="menuOpen = true">
          <Menu :size="21" />
        </button>
        <view class="page-heading">
          <text class="eyebrow">MU5120 ROUTER</text>
          <text class="page-title">{{ activeTabInfo.label }}</text>
        </view>
        <view class="top-actions">
          <text class="last-update">{{ refreshing ? '正在刷新…' : `更新于 ${lastUpdate}` }}</text>
          <button class="icon-button" aria-label="立即刷新" @click="refresh(true)">
            <RefreshCw :size="19" :class="{ spinning: refreshing }" />
          </button>
        </view>
      </header>

      <scroll-view class="content-scroll" scroll-y>
        <view class="content-wrap">
          <view v-if="errorMessage" class="error-banner">
            <CircleAlert :size="18" />
            <text>{{ errorMessage }}</text>
          </view>

          <template v-if="activeTab === 'overview'">
            <view class="hero-grid">
              <section class="hero-panel network-hero">
                <view class="hero-top">
                  <view>
                    <text class="hero-kicker">当前蜂窝网络</text>
                    <text class="network-name">{{ networkType }}</text>
                    <text class="operator-name">{{ operator }}</text>
                  </view>
                  <view class="signal-bars" aria-label="信号强度">
                    <view v-for="index in 5" :key="index" :class="{ on: index <= signalBars }" :style="{ height: `${6 + index * 5}px` }"></view>
                  </view>
                </view>
                <view class="hero-metrics">
                  <view><text>RSRP</text><b>{{ withUnit(currentRsrp, ' dBm') }}</b></view>
                  <view><text>SINR</text><b>{{ withUnit(currentSinr, ' dB') }}</b></view>
                  <view><text>CA</text><b>{{ caState }}</b></view>
                </view>
              </section>

              <section class="hero-panel speed-hero">
                <view class="speed-column download">
                  <ArrowDown :size="18" />
                  <text>实时下载</text>
                  <b>{{ bytesPerSecond(status.realtime_rx_thrpt) }}</b>
                </view>
                <view class="speed-column upload">
                  <ArrowUp :size="18" />
                  <text>实时上传</text>
                  <b>{{ bytesPerSecond(status.realtime_tx_thrpt) }}</b>
                </view>
                <AppChart :option="speedChartOption" height="94px" class="speed-chart" />
              </section>
            </view>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">设备快照</text>
                  <text class="panel-subtitle">网络、设备与本月用量</text>
                </view>
                <text class="panel-tag">{{ status.wa_inner_version || login.firmware || '固件信息等待中' }}</text>
              </view>
              <MetricGrid :items="snapshotMetrics" />
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">信号波动</text>
                  <text class="panel-subtitle">最近 120 秒的 RSRP、SINR 与 RSRQ</text>
                </view>
              </view>
              <AppChart :option="signalChartOption" height="280px" />
            </section>

            <view class="two-column health-grid">
              <section class="panel">
                <view class="panel-header compact">
                  <view>
                    <text class="panel-title">温度</text>
                    <text class="panel-subtitle">仅显示固件实际返回的传感器</text>
                  </view>
                  <Thermometer :size="20" />
                </view>
                <MetricGrid :items="temperatureMetrics" />
              </section>
              <section v-if="resourceItems.length" class="panel">
                <view class="panel-header compact">
                  <view>
                    <text class="panel-title">CPU 与内存</text>
                    <text class="panel-subtitle">不显示空字段</text>
                  </view>
                  <Cpu :size="20" />
                </view>
                <DataList :items="resourceItems" />
              </section>
            </view>
          </template>

          <template v-else-if="activeTab === 'radio'">
            <view class="radio-overview-grid">
              <section class="panel compact-panel">
                <view class="panel-header compact"><text class="panel-title">当前网络信息</text><RadioTower :size="19" /></view>
                <DataList :items="networkDetails" />
              </section>
              <section class="panel compact-panel">
                <view class="panel-header compact"><text class="panel-title">服务小区</text><MapPin :size="19" /></view>
                <DataList :items="servingCellDetails" />
              </section>
              <section class="panel compact-panel">
                <view class="panel-header compact"><text class="panel-title">辅载波与 NR CA</text><Layers3 :size="19" /></view>
                <DataList :items="secondaryCellDetails" empty-text="当前未检测到辅载波或 CA" />
              </section>
            </view>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">邻小区信息</text>
                  <text class="panel-subtitle">候选小区按 RSRP 从强到弱排序</text>
                </view>
                <view class="neighbor-tools">
                  <view class="search-box"><Search :size="15" /><input v-model="neighborQuery" placeholder="搜索 PCI、ARFCN、Band" /></view>
                  <button class="secondary-button" @click="scanNeighbors"><Radar :size="17" />重新扫描</button>
                </view>
              </view>
              <view class="candidate-list">
                <button
                  v-for="(candidate, index) in displayedCandidates"
                  :key="candidate.key"
                  class="candidate-card"
                  :class="{ selected: selectedCellKey === candidate.key }"
                  @click="selectCandidate(candidate)"
                >
                  <view class="candidate-rank">{{ index + 1 }}</view>
                  <view class="candidate-main">
                    <text>{{ candidate.serving ? '当前服务小区' : `${candidate.rat} 候选小区` }}</text>
                    <b>{{ candidate.rat === 'NR' ? 'n' : 'B' }}{{ candidate.band }} · PCI {{ candidate.pci }} · ARFCN {{ candidate.arfcn }}</b>
                  </view>
                  <view class="candidate-signal">
                    <b>{{ candidate.rsrp ?? '—' }} dBm</b>
                    <text>RSRQ {{ candidate.rsrq ?? '—' }} dB</text>
                  </view>
                </button>
                <view v-if="!displayedCandidates.length" class="empty-state">没有匹配的候选小区，请调整搜索或重新扫描。</view>
              </view>
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">锁小区联动</text>
                  <text class="panel-subtitle">默认使用最强候选值，只改变小区锁定，不修改当前频段</text>
                </view>
                <text class="panel-tag accent">{{ selectedCandidate ? `最强 ${selectedCandidate.rsrp ?? '—'} dBm` : '暂无候选' }}</text>
              </view>
              <view class="lock-form-grid">
                <label><text>制式</text><input :value="selectedCandidate?.rat || ''" disabled /></label>
                <label><text>PCI</text><input v-model="lockForm.pci" type="number" /></label>
                <label><text>ARFCN</text><input v-model="lockForm.arfcn" type="number" /></label>
                <label><text>Band</text><input v-model="lockForm.band" type="number" /></label>
                <label v-if="selectedCandidate?.rat === 'NR'"><text>SCS</text><input v-model="lockForm.scs" type="number" /></label>
              </view>
              <view class="action-row">
                <button class="primary-button" :disabled="!selectedCandidate || actionBusy" @click="lockSelectedCell"><LockKeyhole :size="17" />锁定所选小区</button>
                <button class="secondary-button" :disabled="!selectedCandidate || actionBusy" @click="unlockSelectedCell"><LockOpen :size="17" />解除对应锁定</button>
                <text class="action-result">{{ radioActionResult }}</text>
              </view>
            </section>

            <section class="panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">频段锁定</text>
                  <text class="panel-subtitle">保留原有 LTE、5G SA 与 5G NSA 独立设置</text>
                </view>
              </view>
              <view class="band-groups">
                <view class="band-group">
                  <text class="band-title">LTE</text>
                  <view class="band-options"><label v-for="band in lteBands" :key="band" :class="{ checked: selectedLteBands.includes(band) }"><checkbox :value="String(band)" :checked="selectedLteBands.includes(band)" @click="toggleBand('lte', band)" />B{{ band }}</label></view>
                  <button class="secondary-button" @click="saveBands('lte')">保存 LTE 频段</button>
                </view>
                <view class="band-group">
                  <text class="band-title">5G SA</text>
                  <view class="band-options"><label v-for="band in nrBands" :key="band" :class="{ checked: selectedSaBands.includes(band) }"><checkbox :value="String(band)" :checked="selectedSaBands.includes(band)" @click="toggleBand('sa', band)" />n{{ band }}</label></view>
                  <button class="secondary-button" @click="saveBands('sa')">保存 SA 频段</button>
                </view>
                <view class="band-group">
                  <text class="band-title">5G NSA</text>
                  <view class="band-options"><label v-for="band in nrBands" :key="band" :class="{ checked: selectedNsaBands.includes(band) }"><checkbox :value="String(band)" :checked="selectedNsaBands.includes(band)" @click="toggleBand('nsa', band)" />n{{ band }}</label></view>
                  <button class="secondary-button" @click="saveBands('nsa')">保存 NSA 频段</button>
                </view>
              </view>
            </section>
          </template>

          <template v-else-if="activeTab === 'usage'">
            <MetricGrid :items="usageMetrics" />
            <view class="two-column section-gap">
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">当前会话</text><text class="panel-subtitle">实时速率与蜂窝连接时长</text></view></view>
                <DataList :items="realtimeUsageDetails" />
              </section>
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">每月用量</text><text class="panel-subtitle">统计月份 {{ formatMonth(status.date_month) }}</text></view></view>
                <DataList :items="monthlyUsageDetails" />
              </section>
            </view>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">实时吞吐波动</text><text class="panel-subtitle">最近 120 秒下载与上传速率</text></view></view>
              <AppChart :option="trafficChartOption" height="300px" />
            </section>
          </template>

          <template v-else-if="activeTab === 'battery'">
            <MetricGrid :items="batteryMetrics" />
            <section class="panel section-gap">
              <view class="panel-header"><view><text class="panel-title">续航趋势</text><text class="panel-subtitle">根据本机保存的充放电记录估算</text></view></view>
              <AppChart :option="batteryChartOption" height="280px" />
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">续航记录</text><text class="panel-subtitle">最近 {{ batterySamples.length }} 条</text></view></view>
              <view class="history-list">
                <view v-for="sample in batterySamples.slice().reverse()" :key="sample.timestamp" class="history-row">
                  <text>{{ formatDate(sample.timestamp) }}</text><b>{{ sample.percent }}%</b><text>{{ sample.charging ? '充电' : '放电' }}</text><text>{{ sample.temperature == null ? '—' : `${sample.temperature}°C` }}</text>
                </view>
                <view v-if="!batterySamples.length" class="empty-state">记录样本不足，应用会继续自动积累。</view>
              </view>
            </section>
          </template>

          <template v-else-if="activeTab === 'sms'">
            <section class="panel">
              <view class="panel-header">
                <view><text class="panel-title">发送短信</text><text class="panel-subtitle">通过路由器 SIM 卡发送</text></view>
                <button class="secondary-button" @click="loadSms"><RefreshCw :size="17" />刷新收件箱</button>
              </view>
              <view class="sms-compose">
                <input v-model="smsNumber" placeholder="手机号码" />
                <textarea v-model="smsMessage" maxlength="670" placeholder="短信内容"></textarea>
                <view class="compose-footer"><text>{{ smsMessage.length }} / 670</text><button class="primary-button" :disabled="actionBusy" @click="sendSms"><Send :size="17" />发送</button></view>
              </view>
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">短信列表</text><text class="panel-subtitle">{{ smsCapacity }}</text></view></view>
              <view class="sms-list">
                <view v-for="message in messages" :key="message.id || `${message.number}-${message.date}`" class="sms-card" :class="{ unread: String(message.tag) === '1' }">
                  <view class="sms-meta"><b>{{ message.number || '未知号码' }}</b><text>{{ formatSmsDate(message.date) }}</text></view>
                  <text class="sms-body">{{ message.content || '—' }}</text>
                </view>
                <view v-if="!messages.length" class="empty-state">当前没有短信。</view>
              </view>
            </section>
          </template>

          <template v-else-if="activeTab === 'clients'">
            <MetricGrid :items="clientMetrics" />
            <view class="two-column section-gap">
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">无线设备</text><text class="panel-subtitle">{{ stations.length }} 台</text></view><Wifi :size="20" /></view>
                <view class="client-list"><view v-for="client in stations" :key="client.mac_addr || client.macAddress || client.ip_addr" class="client-card"><view><b>{{ client.hostname || client.hostName || '未知设备' }}</b><text>{{ client.ip_addr || client.ipAddress || '—' }}</text></view><code>{{ client.mac_addr || client.macAddress || '—' }}</code></view><view v-if="!stations.length" class="empty-state">当前没有无线设备。</view></view>
              </section>
              <section class="panel">
                <view class="panel-header"><view><text class="panel-title">有线设备</text><text class="panel-subtitle">{{ cableStations.length }} 台</text></view><Cable :size="20" /></view>
                <view class="client-list"><view v-for="client in cableStations" :key="client.mac_addr || client.macAddress || client.ip_addr" class="client-card"><view><b>{{ client.hostname || client.hostName || '未知设备' }}</b><text>{{ client.ip_addr || client.ipAddress || '—' }}</text></view><code>{{ client.mac_addr || client.macAddress || '—' }}</code></view><view v-if="!cableStations.length" class="empty-state">当前没有有线设备。</view></view>
              </section>
            </view>
          </template>

          <template v-else-if="activeTab === 'settings'">
            <section class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">连接设置</text><text class="panel-subtitle">配置保存在应用本机，不上传到外部服务</text></view><Settings :size="20" /></view>
              <view class="settings-form">
                <label><text>路由器地址</text><input v-model="settingsForm.routerUrl" placeholder="http://192.168.0.1" /></label>
                <label><text>登录密码</text><input v-model="settingsForm.password" password /></label>
                <label><text>开发者密码</text><input v-model="settingsForm.developerPassword" password /></label>
                <label><text>刷新间隔</text><input value="1000 ms（固定）" disabled /></label>
              </view>
              <view class="action-row">
                <button class="primary-button" @click="saveSettings"><Save :size="17" />保存并登录</button>
                <button class="secondary-button" @click="testDeveloper"><Code2 :size="17" />验证开发者权限</button>
                <text class="action-result">{{ settingsResult }}</text>
              </view>
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">运行方式</text><text class="panel-subtitle">同一套功能用于浏览器预览和 Android App</text></view></view>
              <DataList :items="runtimeDetails" />
            </section>
          </template>
        </view>
      </scroll-view>
    </main>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  ArrowDown, ArrowUp, BatteryCharging, Cable, ChartNoAxesCombined, CircleAlert, Code2, Cpu, Gauge, Layers3,
  LayoutDashboard, LockKeyhole, LockOpen, MapPin, Menu, MessageSquareText, RadioTower, Radar, RefreshCw,
  Save, Search, Send, Settings, Smartphone, Thermometer, Wifi
} from 'lucide-vue-next';
import AppChart from '../../components/AppChart.vue';
import DataList from '../../components/DataList.vue';
import MetricGrid from '../../components/MetricGrid.vue';
import { routerApi } from '../../services/router-client.js';
import { buildCellCandidates } from '../../utils/cells.js';
import {
  bytesPerSecond, compactEntries, displayPci, firstValue, formatBytes, formatDate, formatDuration, formatHours,
  formatMonth, numeric, withUnit
} from '../../utils/format.js';

const tabs = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'radio', label: '基站、CA 与锁定', icon: RadioTower },
  { id: 'usage', label: '流量与速率', icon: ChartNoAxesCombined },
  { id: 'battery', label: '电池与续航', icon: BatteryCharging },
  { id: 'sms', label: '短信', icon: MessageSquareText },
  { id: 'clients', label: '连接设备管理', icon: Smartphone },
  { id: 'settings', label: '设置', icon: Settings }
];

const activeTab = ref('overview');
const menuOpen = ref(false);
const refreshing = ref(false);
const actionBusy = ref(false);
const errorMessage = ref('');
const lastUpdate = ref('—');
const clock = ref('');
const data = ref({ status: {}, signal: {}, temperature: {}, resources: {}, locks: {}, stations: [], cableStations: [], neighbors: {}, battery: {}, login: {} });
const histories = reactive({ rsrp: [], sinr: [], rsrq: [], down: [], up: [] });
const selectedCellKey = ref('');
const neighborQuery = ref('');
const lockForm = reactive({ pci: '', arfcn: '', band: '', scs: 30 });
const radioActionResult = ref('');
const lteBands = [1, 3, 5, 7, 8, 20, 28, 34, 38, 39, 40, 41];
const nrBands = [1, 3, 5, 8, 28, 41, 77, 78];
const selectedLteBands = ref([]);
const selectedSaBands = ref([]);
const selectedNsaBands = ref([]);
const messages = ref([]);
const smsCapacity = ref('尚未读取');
const smsNumber = ref('');
const smsMessage = ref('');
const settingsResult = ref('');
const config = reactive(routerApi.getConfig());
const settingsForm = reactive({ ...config });
let pollTimer = null;
let clockTimer = null;

const status = computed(() => data.value.status || {});
const signal = computed(() => data.value.signal || {});
const temperature = computed(() => data.value.temperature || {});
const resources = computed(() => data.value.resources || {});
const login = computed(() => data.value.login || {});
const stations = computed(() => data.value.stations || []);
const cableStations = computed(() => data.value.cableStations || []);
const battery = computed(() => data.value.battery || {});
const batterySamples = computed(() => battery.value.samples || []);
const activeTabInfo = computed(() => tabs.find(tab => tab.id === activeTab.value) || tabs[0]);
const connected = computed(() => login.value.loggedIn || status.value.loginfo === 'ok');
const connectionMessage = computed(() => login.value.message || '连接失败');
const networkType = computed(() => firstValue(signal.value.network_type, status.value.network_type));
const operator = computed(() => firstValue(signal.value.network_provider, signal.value.Operator, '未知运营商'));
const currentRsrp = computed(() => numeric(firstValue(signal.value.Z5g_rsrp, signal.value.lte_rsrp, signal.value.rssi)));
const currentSinr = computed(() => numeric(firstValue(signal.value.Z5g_SINR, signal.value.Z5g_snr, signal.value.lte_snr)));
const signalBars = computed(() => currentRsrp.value == null ? 0 : currentRsrp.value >= -80 ? 5 : currentRsrp.value >= -90 ? 4 : currentRsrp.value >= -100 ? 3 : currentRsrp.value >= -110 ? 2 : 1);
const caState = computed(() => {
  if (signal.value.nr_ca_dl_state || signal.value.nr_multi_ca_scell_info) return 'NR CA';
  return signal.value.wan_lte_ca === 'ca_activated' ? 'LTE CA ON' : 'OFF';
});
const candidates = computed(() => buildCellCandidates(data.value));
const displayedCandidates = computed(() => {
  const query = neighborQuery.value.trim().toLowerCase();
  if (!query) return candidates.value;
  return candidates.value.filter(item => `${item.rat} ${item.band} ${item.pci} ${item.arfcn} ${item.rsrp} ${item.rsrq}`.toLowerCase().includes(query));
});
const selectedCandidate = computed(() => candidates.value.find(item => item.key === selectedCellKey.value) || candidates.value[0]);

const snapshotMetrics = computed(() => [
  { label: 'LAN IP', value: firstValue(status.value.lan_ipaddr) },
  { label: 'WAN IP', value: firstValue(status.value.wan_ipaddr) },
  { label: '运行模式', value: firstValue(status.value.opms_wan_mode) },
  { label: '接入数', value: `${stations.value.length + cableStations.value.length} 台` },
  { label: 'IMEI', value: firstValue(status.value.imei), className: 'wide' },
  { label: '联网时间', value: formatDuration(status.value.realtime_time), className: 'wide' },
  { label: '月下行', value: formatBytes(status.value.monthly_rx_bytes) },
  { label: '月上行', value: formatBytes(status.value.monthly_tx_bytes) },
  { label: '电池电量', value: withUnit(firstValue(status.value.battery_vol_percent, status.value.battery_value), '%') },
  { label: '充电状态', value: battery.value.charging ? '正在充电' : '电池供电' }
]);

const temperatureNames = { battery_temp: '电池温度', wifi_chip_temp: 'Wi-Fi 芯片', wifi_temp_level_1: 'Wi-Fi 传感器 1', wifi_temp_level_2: 'Wi-Fi 传感器 2', pm_sensor_pa1: '射频 PA', pm_sensor_mdm: 'Modem', pm_modem_5g: '5G Modem', cpu_temp: 'CPU 温度', cpu_temperature: 'CPU 温度', soc_temp: 'SoC 温度', board_temp: '主板温度', modem_temp: 'Modem 温度' };
const temperatureMetrics = computed(() => Object.entries(temperature.value).filter(([key, value]) => /temp|sensor|temperature/i.test(key) && !/level|oom_temp_pro/i.test(key) && value !== '' && value != null).map(([key, value]) => ({ label: temperatureNames[key] || key, value: withUnit(value, '°C') })));
const resourceItems = computed(() => compactEntries(resources.value).map(([label, value]) => ({ label, value })));

const networkDetails = computed(() => toItems({
  '网络制式': networkType.value,
  '运营商': operator.value,
  'MCC / MNC': `${firstValue(signal.value.rmcc, signal.value.mdm_mcc)} / ${firstValue(signal.value.rmnc, signal.value.mdm_mnc)}`,
  '联网状态': firstValue(status.value.ppp_status, status.value.wan_connect_status),
  '运行模式': firstValue(status.value.opms_wan_mode),
  'WAN IPv4': firstValue(status.value.wan_ipaddr),
  'WAN IPv6': firstValue(status.value.ipv6_wan_ipaddr)
}));

const servingCellDetails = computed(() => toItems({
  RSRP: withUnit(firstValue(signal.value.Z5g_rsrp, signal.value.lte_rsrp), ' dBm'),
  RSRQ: withUnit(firstValue(signal.value.Z5g_rsrq, signal.value.lte_rsrq), ' dB'),
  SINR: withUnit(firstValue(signal.value.Z5g_SINR, signal.value.Z5g_snr, signal.value.lte_snr), ' dB'),
  RSSI: withUnit(firstValue(signal.value.Z5g_rssi, signal.value.lte_rssi, signal.value.rssi), ' dBm'),
  PCI: displayPci(signal.value.nr5g_pci, signal.value.lte_pci),
  'Cell ID': firstValue(signal.value.nr5g_cell_id, signal.value.Z5g_CELL_ID, signal.value.cell_id),
  '频段': firstValue(signal.value.nr5g_action_band, signal.value.lte_ca_pcell_band, signal.value.wan_active_band),
  '信道/ARFCN': firstValue(signal.value.nr5g_action_channel, signal.value.Z5g_dlEarfcn, signal.value.lte_ca_pcell_arfcn, signal.value.wan_active_channel),
  '带宽': firstValue(signal.value.nr5g_nsa_bandwidth, signal.value.lte_ca_pcell_bandwidth, signal.value.bandwidth)
}));

const secondaryCellDetails = computed(() => compactEntries({
  'LTE SCell Band': signal.value.lte_ca_scell_band,
  'LTE SCell BW': signal.value.lte_ca_scell_bandwidth,
  'LTE SCell ARFCN': signal.value.lte_ca_scell_arfcn,
  'LTE 多载波': signal.value.lte_multi_ca_scell_info,
  'LTE 辅载波信号': signal.value.lte_multi_ca_scell_sig_info,
  'NR 多载波': signal.value.nr_multi_ca_scell_info,
  'NR CA DL': signal.value.nr_ca_dl_state,
  'NR CA UL': signal.value.nr_ca_ul_state
}).map(([label, value]) => ({ label, value })));

const usageMetrics = computed(() => [
  { label: '当前会话', value: formatBytes((numeric(status.value.realtime_rx_bytes) || 0) + (numeric(status.value.realtime_tx_bytes) || 0)) },
  { label: '本月合计', value: formatBytes((numeric(status.value.monthly_rx_bytes) || 0) + (numeric(status.value.monthly_tx_bytes) || 0)) },
  { label: '联网时长', value: formatDuration(status.value.realtime_time) },
  { label: '连接设备', value: `${stations.value.length + cableStations.value.length} 台` }
]);
const realtimeUsageDetails = computed(() => toItems({ '下载': formatBytes(status.value.realtime_rx_bytes), '上传': formatBytes(status.value.realtime_tx_bytes), '下载速度': bytesPerSecond(status.value.realtime_rx_thrpt), '上传速度': bytesPerSecond(status.value.realtime_tx_thrpt), '蜂窝联网时长': formatDuration(status.value.realtime_time), '整机开机时长': firstValue(resources.value.uptime, resources.value.sys_uptime, '固件未暴露'), '连接状态': firstValue(status.value.ppp_status, status.value.wan_connect_status) }));
const monthlyUsageDetails = computed(() => toItems({ '本月下载': formatBytes(status.value.monthly_rx_bytes), '本月上传': formatBytes(status.value.monthly_tx_bytes), '本月合计': formatBytes((numeric(status.value.monthly_rx_bytes) || 0) + (numeric(status.value.monthly_tx_bytes) || 0)), '累计联网': formatDuration(status.value.monthly_time), '统计月份': formatMonth(status.value.date_month) }));
const batteryMetrics = computed(() => [
  { label: '电池电量', value: withUnit(firstValue(battery.value.percent, status.value.battery_vol_percent, status.value.battery_value), '%') },
  { label: '充电状态', value: battery.value.charging ? '正在充电' : '电池供电' },
  { label: '电池温度', value: withUnit(firstValue(temperature.value.battery_temp), '°C') },
  { label: '预计时间', value: battery.value.remainingHours == null ? '数据不足' : formatHours(battery.value.remainingHours) },
  { label: '变化速率', value: battery.value.ratePerHour == null ? '数据不足' : `${battery.value.ratePerHour.toFixed(2)}%/小时` },
  { label: '充电类型', value: firstValue(status.value.battery_charg_type) },
  { label: '外部供电', value: status.value.external_charging_flag === '1' ? '是' : '否' },
  { label: '记录样本', value: `${batterySamples.value.length} 条` }
]);
const clientMetrics = computed(() => [
  { label: '无线设备', value: `${stations.value.length} 台` }, { label: '有线设备', value: `${cableStations.value.length} 台` }, { label: '合计', value: `${stations.value.length + cableStations.value.length} 台` }, { label: '主 Wi-Fi', value: firstValue(status.value.wifi_chip1_ssid1_ssid) }, { label: '副 Wi-Fi', value: firstValue(status.value.wifi_chip2_ssid1_ssid) }
]);
const runtimeDetails = computed(() => toItems({ 'H5 开发预览': 'Vite 代理访问路由器，避免浏览器跨域', 'Android App': '应用内直接访问路由器局域网地址', '登录': '使用保存密码与动态 LD 自动计算 SHA-256', '开发者写接口': '自动刷新主会话、LD 与动态 AD', '刷新频率': '1000 ms' }));

const signalChartOption = computed(() => lineOption([
  { name: 'RSRP', data: histories.rsrp, color: '#16836a' },
  { name: 'SINR', data: histories.sinr, color: '#c57a19', axis: 1 },
  { name: 'RSRQ', data: histories.rsrq, color: '#356cc5' }
], true));
const speedChartOption = computed(() => miniLineOption(histories.down, histories.up));
const trafficChartOption = computed(() => lineOption([{ name: '下载', data: histories.down, color: '#16836a' }, { name: '上传', data: histories.up, color: '#356cc5' }]));
const batteryChartOption = computed(() => lineOption([{ name: '电量', data: batterySamples.value.map(item => item.percent), color: '#16836a' }], false, { min: 0, max: 100 }));

function toItems(object) {
  return Object.entries(object).map(([label, value]) => ({ label, value: firstValue(value) }));
}

function pushHistory(list, value) {
  list.push(value);
  if (list.length > 120) list.splice(0, list.length - 120);
}

function captureHistory(payload) {
  const nextSignal = payload.signal || {};
  const nextStatus = payload.status || {};
  pushHistory(histories.rsrp, numeric(firstValue(nextSignal.Z5g_rsrp, nextSignal.lte_rsrp, nextSignal.rssi)));
  pushHistory(histories.sinr, numeric(firstValue(nextSignal.Z5g_SINR, nextSignal.Z5g_snr, nextSignal.lte_snr)));
  pushHistory(histories.rsrq, numeric(firstValue(nextSignal.Z5g_rsrq, nextSignal.lte_rsrq)));
  pushHistory(histories.down, numeric(nextStatus.realtime_rx_thrpt) || 0);
  pushHistory(histories.up, numeric(nextStatus.realtime_tx_thrpt) || 0);
}

function lineOption(series, dualAxis = false, range = {}) {
  return {
    animationDuration: 250,
    color: series.map(item => item.color),
    grid: { left: 14, right: dualAxis ? 14 : 8, top: 34, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(18,29,43,.94)', borderWidth: 0, textStyle: { color: '#fff', fontSize: 11 } },
    legend: { top: 0, right: 6, textStyle: { color: '#667085', fontSize: 11 } },
    xAxis: { type: 'category', boundaryGap: false, data: Array.from({ length: Math.max(0, ...series.map(item => item.data.length)) }, (_, index) => index + 1), axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#d9dee7' } } },
    yAxis: dualAxis ? [
      { type: 'value', scale: true, axisLabel: { color: '#667085', fontSize: 10 }, splitLine: { lineStyle: { color: '#edf0f4' } } },
      { type: 'value', scale: true, axisLabel: { color: '#a76513', fontSize: 10 }, splitLine: { show: false } }
    ] : [{ type: 'value', scale: range.min == null, min: range.min, max: range.max, axisLabel: { color: '#667085', fontSize: 10 }, splitLine: { lineStyle: { color: '#edf0f4' } } }],
    series: series.map(item => ({ name: item.name, type: 'line', data: item.data, yAxisIndex: item.axis || 0, showSymbol: false, smooth: 0.28, connectNulls: false, lineStyle: { width: 2 }, areaStyle: item.name === '下载' ? { opacity: 0.08 } : undefined }))
  };
}

function miniLineOption(download, upload) {
  return {
    animationDuration: 200,
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: 'category', boundaryGap: false, data: Array.from({ length: Math.max(download.length, upload.length) }, (_, index) => index), show: false },
    yAxis: { type: 'value', show: false },
    series: [
      { type: 'line', data: download, showSymbol: false, smooth: 0.28, lineStyle: { width: 1.7, color: '#16836a' }, areaStyle: { color: 'rgba(22,131,106,.12)' } },
      { type: 'line', data: upload, showSymbol: false, smooth: 0.28, lineStyle: { width: 1.7, color: '#356cc5' } }
    ]
  };
}

function applyInitialBands() {
  const locks = data.value.locks || {};
  if (!selectedSaBands.value.length) selectedSaBands.value = parseBandText(locks.nr5g_sa_band_lock || locks.nr5g_band_lock);
  if (!selectedNsaBands.value.length) selectedNsaBands.value = parseBandText(locks.nr5g_nsa_band_lock);
  if (!selectedLteBands.value.length && locks.lte_band_lock) selectedLteBands.value = lteBands.filter(band => isBandInMask(locks.lte_band_lock, band));
}

function parseBandText(value) {
  return String(value || '').split(',').map(item => Number(String(item).replace(/\D/g, ''))).filter(Number.isFinite);
}

function isBandInMask(raw, band) {
  const map = { 1: 0x1n, 3: 0x4n, 5: 0x10n, 7: 0x40n, 8: 0x80n, 20: 0x80000n, 28: 0x8000000n, 34: 0x200000000n, 38: 0x2000000000n, 39: 0x4000000000n, 40: 0x8000000000n, 41: 0x10000000000n };
  try { return (BigInt(raw) & map[band]) !== 0n; } catch { return false; }
}

function syncCandidate() {
  const candidate = selectedCandidate.value;
  if (!candidate) return;
  if (!selectedCellKey.value || !candidates.value.some(item => item.key === selectedCellKey.value)) selectedCellKey.value = candidates.value[0].key;
  const current = candidates.value.find(item => item.key === selectedCellKey.value) || candidates.value[0];
  lockForm.pci = current.pci;
  lockForm.arfcn = current.arfcn;
  lockForm.band = current.band;
  lockForm.scs = current.scs || 30;
}

async function refresh(manual = false) {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const payload = await routerApi.dashboard();
    const merged = mergeDashboard(data.value, payload);
    data.value = merged;
    captureHistory(merged);
    applyInitialBands();
    syncCandidate();
    errorMessage.value = '';
    lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (error) {
    errorMessage.value = error.message;
    if (manual) uni.showToast({ title: error.message, icon: 'none', duration: 2600 });
  } finally {
    refreshing.value = false;
  }
}

function mergeDashboard(previous, incoming) {
  const mergeRecord = (oldValue, newValue) => {
    const result = { ...(oldValue || {}) };
    Object.entries(newValue || {}).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) result[key] = value;
    });
    return result;
  };
  return {
    ...previous,
    ...incoming,
    login: mergeRecord(previous?.login, incoming?.login),
    status: mergeRecord(previous?.status, incoming?.status),
    signal: mergeRecord(previous?.signal, incoming?.signal),
    temperature: mergeRecord(previous?.temperature, incoming?.temperature),
    resources: mergeRecord(previous?.resources, incoming?.resources),
    locks: mergeRecord(previous?.locks, incoming?.locks),
    neighbors: mergeRecord(previous?.neighbors, incoming?.neighbors),
    battery: mergeRecord(previous?.battery, incoming?.battery),
    stations: Array.isArray(incoming?.stations) ? incoming.stations : (previous?.stations || []),
    cableStations: Array.isArray(incoming?.cableStations) ? incoming.cableStations : (previous?.cableStations || [])
  };
}

function switchTab(id) {
  activeTab.value = id;
  menuOpen.value = false;
  if (id === 'sms' && !messages.value.length) loadSms();
}

function selectCandidate(candidate) {
  selectedCellKey.value = candidate.key;
  lockForm.pci = candidate.pci;
  lockForm.arfcn = candidate.arfcn;
  lockForm.band = candidate.band;
  lockForm.scs = candidate.scs || 30;
}

async function scanNeighbors() {
  actionBusy.value = true;
  radioActionResult.value = '正在扫描邻区…';
  try {
    await routerApi.scanNeighbors();
    radioActionResult.value = '扫描命令已发送，正在等待结果';
    setTimeout(() => refresh(true), 2500);
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

async function lockSelectedCell() {
  const selected = selectedCandidate.value;
  if (!selected) return;
  actionBusy.value = true;
  radioActionResult.value = '正在锁定小区…';
  try {
    await routerApi.linkedCellLock({ ...selected, ...lockForm });
    radioActionResult.value = '小区锁定成功，当前频段保持不变';
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

async function unlockSelectedCell() {
  const selected = selectedCandidate.value;
  if (!selected) return;
  actionBusy.value = true;
  radioActionResult.value = '正在解除锁定…';
  try {
    if (selected.rat === 'NR') await routerApi.setNrCellLock({ unlock: true });
    else await routerApi.setLteCellLock({ unlock: true });
    radioActionResult.value = '已解除小区锁定';
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

function toggleBand(group, band) {
  const target = group === 'lte' ? selectedLteBands : group === 'sa' ? selectedSaBands : selectedNsaBands;
  target.value = target.value.includes(band) ? target.value.filter(item => item !== band) : [...target.value, band].sort((a, b) => a - b);
}

async function saveBands(group) {
  actionBusy.value = true;
  radioActionResult.value = '正在保存频段…';
  try {
    if (group === 'lte') await routerApi.setLteBands(selectedLteBands.value);
    else await routerApi.setNrBands(group, group === 'sa' ? selectedSaBands.value : selectedNsaBands.value);
    radioActionResult.value = `${group.toUpperCase()} 频段保存成功`;
    await refresh();
  } catch (error) {
    radioActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
}

async function loadSms() {
  try {
    const result = await routerApi.listSms();
    messages.value = result.messages || [];
    const capacity = result.capacity || {};
    const used = (numeric(capacity.sms_nv_rev_total) || 0) + (numeric(capacity.sms_nv_send_total) || 0) + (numeric(capacity.sms_nv_draftbox_total) || 0);
    smsCapacity.value = capacity.sms_nv_total ? `${used}/${capacity.sms_nv_total}` : `状态 ${result.ready?.sms_cmd_status_result || '—'}`;
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function sendSms() {
  actionBusy.value = true;
  try {
    const result = await routerApi.sendSms(smsNumber.value, smsMessage.value);
    uni.showToast({ title: result.result === 'success' ? '发送成功' : `发送状态：${result.result}`, icon: result.result === 'success' ? 'success' : 'none' });
    if (result.result === 'success') {
      smsMessage.value = '';
      await loadSms();
    }
  } catch (error) {
    uni.showToast({ title: error.message, icon: 'none', duration: 2600 });
  } finally {
    actionBusy.value = false;
  }
}

function formatSmsDate(raw) {
  if (!raw) return '—';
  const parts = String(raw).split(',');
  return parts.length < 6 ? raw : `20${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}

async function saveSettings() {
  Object.assign(config, routerApi.updateConfig({ ...settingsForm, pollIntervalMs: 1000 }));
  settingsResult.value = '正在重新登录…';
  const result = await routerApi.login(true);
  settingsResult.value = result.message;
  await refresh(true);
}

async function testDeveloper() {
  settingsResult.value = '正在验证开发者权限…';
  try {
    const result = await routerApi.developerLogin();
    settingsResult.value = result.message;
  } catch (error) {
    settingsResult.value = error.message;
  }
}

onMounted(() => {
  refresh();
  pollTimer = setInterval(refresh, 1000);
  const updateClock = () => { clock.value = new Date().toLocaleString('zh-CN', { hour12: false }); };
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
});

onLoad(options => {
  if (tabs.some(tab => tab.id === options?.tab)) {
    activeTab.value = options.tab;
    if (options.tab === 'sms') setTimeout(loadSms, 0);
  }
});

onBeforeUnmount(() => {
  clearInterval(pollTimer);
  clearInterval(clockTimer);
});
</script>

<style scoped src="./index.css"></style>
