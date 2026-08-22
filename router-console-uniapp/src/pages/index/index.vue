<template>
  <view class="app-shell">
    <aside class="sidebar" :class="{ open: menuOpen }">
      <view class="brand-block">
        <view class="brand-mark"><RouterIcon :size="22" :stroke-width="1.8" /></view>
        <view>
          <text class="brand-title">U50 PRO</text>
          <text class="brand-subtitle">移动网络控制台</text>
        </view>
      </view>

      <view class="connection-card">
        <view class="connection-line">
          <view class="status-dot" :class="connected ? 'online' : 'offline'"></view>
          <text>{{ connected ? '路由器已连接' : connectionMessage }}</text>
        </view>
        <text class="connection-address">{{ connectionAddress }}</text>
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
        <text>v{{ APP_VERSION }} · 开发者 晓泽</text>
        <text>{{ clock }}</text>
      </view>
    </aside>

    <view v-if="menuOpen" class="sidebar-mask" @click="menuOpen = false"></view>

    <main class="main-area">
      <header class="topbar">
        <view class="page-heading">
          <text class="eyebrow">U50 PRO ROUTER</text>
          <text class="page-title">{{ activeTabInfo.label }}</text>
        </view>
        <view class="top-actions">
          <text class="last-update">更新于 {{ lastUpdate }}</text>
          <button class="icon-button" aria-label="立即刷新" @click="refresh(true)">
            <RefreshCw :size="19" />
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

            <section class="panel temperature-overview">
              <view class="panel-header compact">
                <view>
                  <text class="panel-title">设备温度</text>
                  <text class="panel-subtitle">最近 24 小时温度记录，本地自动保存</text>
                </view>
                <Thermometer :size="20" />
              </view>
              <view class="temperature-overview-grid">
                <MetricGrid :items="temperatureMetrics" />
                <AppChart :option="temperatureChartOption" height="230px" />
              </view>
            </section>

            <view class="health-grid">
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
              <section class="panel">
                <view class="panel-header compact">
                  <view>
                    <text class="panel-title">设备信息</text>
                    <text class="panel-subtitle">仅保留设备自身标识</text>
                  </view>
                  <RouterIcon :size="20" />
                </view>
                <DataList :items="deviceIdentityDetails" />
              </section>
            </view>
          </template>

          <template v-else-if="activeTab === 'radio'">
            <view class="radio-overview-grid">
              <section class="panel compact-panel radio-info-panel">
                <view class="panel-header compact"><text class="panel-title">当前网络信息</text><RadioTower :size="19" /></view>
                <DataList class="radio-data-list" :items="networkDetails" />
              </section>
              <section class="panel compact-panel radio-info-panel">
                <view class="panel-header compact"><text class="panel-title">服务小区</text><MapPin :size="19" /></view>
                <DataList class="radio-data-list" :items="servingCellDetails" />
              </section>
              <section class="panel compact-panel radio-info-panel secondary-info-panel">
                <view class="panel-header compact"><text class="panel-title">辅载波与 NR CA</text><Layers3 :size="19" /></view>
                <DataList class="radio-data-list" :items="secondaryCellDetails" empty-text="当前未检测到辅载波或 CA" />
              </section>
            </view>

            <section class="panel signal-trend-panel">
              <view class="panel-header">
                <view>
                  <text class="panel-title">无线质量趋势</text>
                  <text class="panel-subtitle">最近 24 小时 RSRP、SINR 与 RSRQ，仅保存在本机</text>
                </view>
              </view>
              <AppChart :option="signalChartOption" height="260px" />
            </section>

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
                  <view class="band-group-header">
                    <view><text class="band-title">LTE 频段</text><text class="band-count">已选择 {{ selectedLteBands.length }} 个</text></view>
                    <text class="band-network-tag">4G</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in lteBands" :key="band" class="band-chip" :class="{ checked: selectedLteBands.includes(band) }" @click="toggleBand('lte', band)">
                      <Check v-if="selectedLteBands.includes(band)" :size="14" :stroke-width="2.5" /><text>B{{ band }}</text>
                    </button>
                  </view>
                  <button class="band-save-button" @click="saveBands('lte')"><Save :size="16" />保存 LTE 频段</button>
                </view>
                <view class="band-group">
                  <view class="band-group-header">
                    <view><text class="band-title">5G SA 频段</text><text class="band-count">已选择 {{ selectedSaBands.length }} 个</text></view>
                    <text class="band-network-tag sa">SA</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in nrBands" :key="band" class="band-chip" :class="{ checked: selectedSaBands.includes(band) }" @click="toggleBand('sa', band)">
                      <Check v-if="selectedSaBands.includes(band)" :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                  </view>
                  <button class="band-save-button" @click="saveBands('sa')"><Save :size="16" />保存 SA 频段</button>
                </view>
                <view class="band-group">
                  <view class="band-group-header">
                    <view><text class="band-title">5G NSA 频段</text><text class="band-count">已选择 {{ selectedNsaBands.length }} 个</text></view>
                    <text class="band-network-tag nsa">NSA</text>
                  </view>
                  <view class="band-options">
                    <button v-for="band in nrBands" :key="band" class="band-chip" :class="{ checked: selectedNsaBands.includes(band) }" @click="toggleBand('nsa', band)">
                      <Check v-if="selectedNsaBands.includes(band)" :size="14" :stroke-width="2.5" /><text>n{{ band }}</text>
                    </button>
                  </view>
                  <button class="band-save-button" @click="saveBands('nsa')"><Save :size="16" />保存 NSA 频段</button>
                </view>
              </view>
            </section>
          </template>

          <template v-else-if="activeTab === 'usage'">
            <MetricGrid :items="usageSummaryMetrics" />
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">实时吞吐波动</text><text class="panel-subtitle">最近 24 小时下载与上传速率，本地自动保存</text></view></view>
              <AppChart :option="trafficChartOption" height="300px" />
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">用量明细</text><text class="panel-subtitle">当前会话与 {{ formatMonth(status.date_month) }} 月统计</text></view></view>
              <DataList :items="usageDetails" />
            </section>
          </template>

          <template v-else-if="activeTab === 'battery'">
            <MetricGrid :items="batteryMetrics" />
            <section class="panel section-gap">
              <view class="panel-header"><view><text class="panel-title">续航趋势</text><text class="panel-subtitle">最近 24 小时电量记录，可拖动查看</text></view></view>
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
            <view class="two-column">
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
              <view class="panel-header"><view><text class="panel-title">路由器连接</text><text class="panel-subtitle">手机连接 U50 Pro Wi-Fi 后直接访问 192.168.0.1</text></view><Settings :size="20" /></view>
              <view class="settings-form">
                <label><text>路由器地址</text><input v-model="settingsForm.routerUrl" placeholder="http://192.168.0.1" /></label>
                <label><text>登录与开发者密码</text><input v-model="settingsForm.password" password /></label>
                <label><text>刷新间隔</text><input value="1000 ms（固定）" disabled /></label>
              </view>
              <view class="action-row">
                <button class="primary-button" @click="saveSettings"><Save :size="17" />保存并登录</button>
                <button class="secondary-button" @click="testDeveloper"><Code2 :size="17" />验证开发者权限</button>
                <text class="action-result">{{ settingsResult }}</text>
              </view>
            </section>
            <section class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">悬浮监测</text><text class="panel-subtitle">在其他应用上层显示实时速率、电量与电池温度</text></view><Layers3 :size="20" /></view>
              <view class="overlay-setting-row">
                <view class="overlay-setting-copy">
                  <b>显示悬浮窗</b>
                  <text>{{ overlayStateText }}</text>
                </view>
                <switch :checked="overlayState.enabled" :disabled="!overlayState.available" color="#2563eb" @change="toggleOverlay" />
              </view>
            </section>
            <section class="panel settings-panel">
              <view class="panel-header"><view><text class="panel-title">设备控制</text><text class="panel-subtitle">Wi-Fi 关闭后当前连接会立即中断，需要手动重新连接设备</text></view><Power :size="20" /></view>
              <view class="device-control-grid">
                <button class="secondary-button" :disabled="actionBusy" @click="runDeviceAction('wifi-on')"><Wifi :size="17" />开启 Wi-Fi</button>
                <button class="secondary-button danger-outline" :disabled="actionBusy" @click="runDeviceAction('wifi-off')"><WifiOff :size="17" />关闭 Wi-Fi</button>
                <button class="secondary-button" :disabled="actionBusy" @click="runDeviceAction('reboot')"><RotateCw :size="17" />重启设备</button>
                <button class="danger-button" :disabled="actionBusy" @click="runDeviceAction('shutdown')"><PowerOff :size="17" />关闭设备</button>
              </view>
              <text class="action-result control-result">{{ deviceActionResult }}</text>
            </section>
            <section class="panel">
              <view class="panel-header"><view><text class="panel-title">运行方式</text><text class="panel-subtitle">同一套功能用于浏览器预览和 Android App</text></view></view>
              <DataList :items="runtimeDetails" />
            </section>
          </template>
        </view>
      </scroll-view>
    </main>

    <view class="mobile-bottom-nav">
      <button
        v-for="item in mobileTabs"
        :key="item.id"
        class="mobile-nav-button"
        :class="{ active: activeTab === item.id }"
        @click="switchTab(item.id)"
      >
        <component :is="item.icon" :size="21" :stroke-width="activeTab === item.id ? 2.2 : 1.8" />
        <text>{{ item.label }}</text>
      </button>
      <button class="mobile-nav-button" :class="{ active: moreOpen || moreTabs.some(item => item.id === activeTab) }" @click="moreOpen = !moreOpen">
        <Apps :size="21" :stroke-width="moreOpen ? 2.2 : 1.8" />
        <text>更多</text>
      </button>
    </view>

    <view v-if="moreOpen" class="more-sheet-mask" @click="moreOpen = false"></view>
    <view v-if="moreOpen" class="more-sheet">
      <view class="more-sheet-handle"></view>
      <view class="more-sheet-title"><text>更多功能</text><button class="more-sheet-close" aria-label="关闭更多功能" @click="moreOpen = false"><X :size="18" /></button></view>
      <view class="more-grid">
        <button v-for="item in moreTabs" :key="item.id" class="more-item" @click="switchTab(item.id)">
          <view class="more-item-icon"><component :is="item.icon" :size="21" :stroke-width="1.9" /></view>
          <text>{{ item.label }}</text>
        </button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import {
  IconAlertCircle as CircleAlert, IconApps as Apps, IconAntennaBars5 as RadioTower, IconArrowDown as ArrowDown,
  IconArrowUp as ArrowUp, IconBatteryCharging as BatteryCharging, IconPlugConnected as Cable,
  IconChartLine as ChartNoAxesCombined, IconCheck as Check, IconCode as Code2, IconCpu as Cpu,
  IconDeviceFloppy as Save, IconDevices as Smartphone, IconGauge as Gauge,
  IconLayersIntersect as Layers3, IconLayoutDashboard as LayoutDashboard, IconLock as LockKeyhole,
  IconLockOpen as LockOpen, IconMapPin as MapPin, IconMessage as MessageSquareText,
  IconPower as Power, IconCircleOff as PowerOff, IconRadar as Radar, IconRefresh as RefreshCw,
  IconRotateClockwise as RotateCw, IconRouter as RouterIcon, IconSearch as Search, IconSend as Send,
  IconSettings as Settings, IconTemperature as Thermometer, IconWifi as Wifi,
  IconWifiOff as WifiOff, IconX as X
} from '@tabler/icons-vue';
import AppChart from '../../components/AppChart.vue';
import DataList from '../../components/DataList.vue';
import MetricGrid from '../../components/MetricGrid.vue';
import { routerApi } from '../../services/router-client.js';
import { buildCellCandidates } from '../../utils/cells.js';
import {
  bytesPerSecond, compactEntries, displayPci, firstValue, formatBytes, formatDate, formatDuration, formatHours,
  formatMonth, numeric, operatorName, withUnit
} from '../../utils/format.js';

const APP_VERSION = '1.3.17';
const CHART_HISTORY_KEY = 'mu5120-chart-history-v1';
const METRIC_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATTERY_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const CHART_HISTORY_SAMPLE_MS = 60 * 1000;
const CHART_HISTORY_MAX_POINTS = Math.ceil(METRIC_HISTORY_WINDOW_MS / CHART_HISTORY_SAMPLE_MS) + 5;

const tabs = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'radio', label: '基站、CA 与锁定', icon: RadioTower },
  { id: 'usage', label: '流量与速率', icon: ChartNoAxesCombined },
  { id: 'battery', label: '电池与续航', icon: BatteryCharging },
  { id: 'sms', label: '短信', icon: MessageSquareText },
  { id: 'clients', label: '连接设备管理', icon: Smartphone },
  { id: 'settings', label: '设置', icon: Settings }
];

const mobileTabs = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'radio', label: '基站', icon: RadioTower },
  { id: 'usage', label: '流量', icon: ChartNoAxesCombined },
  { id: 'battery', label: '电池', icon: BatteryCharging }
];
const moreTabs = [
  { id: 'sms', label: '短信', icon: MessageSquareText },
  { id: 'clients', label: '连接设备', icon: Smartphone },
  { id: 'settings', label: '设置与控制', icon: Settings }
];

const activeTab = ref('overview');
const menuOpen = ref(false);
const moreOpen = ref(false);
const refreshing = ref(false);
const actionBusy = ref(false);
const errorMessage = ref('');
const lastUpdate = ref('—');
const clock = ref('');
const data = ref({ status: {}, signal: {}, temperature: {}, resources: {}, locks: {}, stations: [], cableStations: [], neighbors: {}, battery: {}, login: {} });
const histories = reactive(loadChartHistory());
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
const deviceActionResult = ref('');
const config = reactive(routerApi.getConfig());
const settingsForm = reactive({ ...config });
const overlayState = reactive(routerApi.getOverlayState());
let pollTimer = null;
let clockTimer = null;
let lastChartHistorySave = 0;

const status = computed(() => data.value.status || {});
const signal = computed(() => data.value.signal || {});
const connectionAddress = computed(() => config.routerUrl);
const temperature = computed(() => data.value.temperature || {});
const resources = computed(() => data.value.resources || {});
const login = computed(() => data.value.login || {});
const stations = computed(() => data.value.stations || []);
const cableStations = computed(() => data.value.cableStations || []);
const battery = computed(() => data.value.battery || {});
const batterySamples = computed(() => battery.value.samples || []);
const activeTabInfo = computed(() => tabs.find(tab => tab.id === activeTab.value) || tabs[0]);
const connected = computed(() => !data.value.stale && (login.value.loggedIn || status.value.loginfo === 'ok'));
const overlayStateText = computed(() => {
  if (!overlayState.available) return '仅 Android App 支持悬浮窗';
  if (!overlayState.enabled) return '已关闭';
  return overlayState.permitted ? '已开启，可拖动调整位置' : '已开启，等待系统悬浮窗权限';
});
const connectionMessage = computed(() => data.value.stale ? '服务器缓存数据' : (login.value.message || '连接失败'));
const networkType = computed(() => firstValue(signal.value.network_type, status.value.network_type));
const operator = computed(() => operatorName(
  firstValue(signal.value.network_provider, signal.value.Operator, ''),
  firstValue(signal.value.rmcc, signal.value.mdm_mcc, ''),
  firstValue(signal.value.rmnc, signal.value.mdm_mnc, '')
));
const currentRsrp = computed(() => numeric(firstValue(signal.value.Z5g_rsrp, signal.value.lte_rsrp, signal.value.rssi)));
const currentSinr = computed(() => numeric(firstValue(signal.value.Z5g_SINR, signal.value.Z5g_snr, signal.value.lte_snr)));
const caState = computed(() => {
  if (signal.value.nr_ca_dl_state || signal.value.nr_multi_ca_scell_info) return 'NR CA';
  return signal.value.wan_lte_ca === 'ca_activated' ? 'LTE CA ON' : 'OFF';
});
const signalBars = computed(() => currentRsrp.value == null ? 0 : currentRsrp.value >= -80 ? 5 : currentRsrp.value >= -90 ? 4 : currentRsrp.value >= -100 ? 3 : currentRsrp.value >= -110 ? 2 : 1);
const candidates = computed(() => buildCellCandidates(data.value));
const displayedCandidates = computed(() => {
  const query = neighborQuery.value.trim().toLowerCase();
  if (!query) return candidates.value;
  return candidates.value.filter(item => `${item.rat} ${item.band} ${item.pci} ${item.arfcn} ${item.rsrp} ${item.rsrq}`.toLowerCase().includes(query));
});
const selectedCandidate = computed(() => candidates.value.find(item => item.key === selectedCellKey.value) || candidates.value[0]);

const temperatureNames = { battery_temp: '电池温度', wifi_chip_temp: 'Wi-Fi 芯片', wifi_temp_level_1: 'Wi-Fi 传感器 1', wifi_temp_level_2: 'Wi-Fi 传感器 2', pm_sensor_pa1: '射频 PA', pm_sensor_mdm: 'Modem', pm_modem_5g: '5G Modem', cpu_temp: 'CPU 温度', cpu_temperature: 'CPU 温度', soc_temp: 'SoC 温度', board_temp: '主板温度', modem_temp: 'Modem 温度' };
const temperatureMetrics = computed(() => Object.entries(temperature.value).filter(([key, value]) => /temp|sensor|temperature/i.test(key) && !/level|oom_temp_pro/i.test(key) && value !== '' && value != null).map(([key, value]) => ({ label: temperatureNames[key] || key, value: withUnit(value, '°C') })));
const resourceItems = computed(() => compactEntries(resources.value).map(([label, value]) => ({ label, value })));
const deviceIdentityDetails = computed(() => toItems({
  'IMEI': firstValue(status.value.imei),
  '固件版本': firstValue(status.value.wa_inner_version, login.value.firmware),
  'LAN IP': firstValue(status.value.lan_ipaddr)
}));

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

const usageSummaryMetrics = computed(() => [
  { label: '当前会话', value: formatBytes((numeric(status.value.realtime_rx_bytes) || 0) + (numeric(status.value.realtime_tx_bytes) || 0)) },
  { label: '本月合计', value: formatBytes((numeric(status.value.monthly_rx_bytes) || 0) + (numeric(status.value.monthly_tx_bytes) || 0)) }
]);
const usageDetails = computed(() => toItems({
  '会话下载': formatBytes(status.value.realtime_rx_bytes),
  '会话上传': formatBytes(status.value.realtime_tx_bytes),
  '会话时长': formatDuration(status.value.realtime_time),
  '本月下载': formatBytes(status.value.monthly_rx_bytes),
  '本月上传': formatBytes(status.value.monthly_tx_bytes),
  '累计联网': formatDuration(status.value.monthly_time)
}));
const batteryMetrics = computed(() => [
  { label: '电池电量', value: withUnit(firstValue(battery.value.percent, status.value.battery_vol_percent, status.value.battery_value), '%') },
  { label: '充电状态', value: battery.value.charging ? '正在充电' : '电池供电' },
  { label: '电池温度', value: withUnit(firstValue(temperature.value.battery_temp), '°C') },
  { label: '预计时间', value: battery.value.remainingHours == null ? '数据不足' : formatHours(battery.value.remainingHours) },
  { label: '变化速率', value: battery.value.ratePerHour == null ? '数据不足' : `${battery.value.ratePerHour.toFixed(2)}%/小时` },
  { label: '记录样本', value: `${batterySamples.value.length} 条` }
]);
const runtimeDetails = computed(() => toItems({
  '当前数据通道': '局域网直连',
  'H5 开发预览': '通过本机代理访问路由器',
  'Android App': '原生 HTTP 直连路由器',
  '登录': '使用保存密码与动态 LD 自动计算 SHA-256',
  '历史记录': '电池 12 小时，其他指标 24 小时，仅保存在本机',
  '软件版本': `v${APP_VERSION}`,
  '开发者': '晓泽',
  '开发者写接口': '自动刷新主会话、LD 与动态 AD',
  '刷新频率': '1000 ms'
}));

const signalChartOption = computed(() => lineOption([
  { name: 'RSRP', data: histories.rsrp, color: '#5b8def' },
  { name: 'SINR', data: histories.sinr, color: '#f5a524' },
  { name: 'RSRQ', data: histories.rsrq, color: '#2dd4bf' }
], false, { min: -140, max: 50 }, {
  animation: false,
  axisWindowStepMs: CHART_HISTORY_SAMPLE_MS
}));

const throughputBuckets = computed(() => {
  const down = stableTimeBuckets(histories.down, 720);
  const up = stableTimeBuckets(histories.up, 720);
  return { down, up, axisMax: niceAxisMax([...down, ...up].map(item => item[1])) };
});
const speedChartOption = computed(() => miniLineOption(throughputBuckets.value.down, throughputBuckets.value.up, throughputBuckets.value.axisMax));
const trafficChartOption = computed(() => lineOption([
  { name: '下载', data: throughputBuckets.value.down, color: '#5b8def', bucketed: true, area: true, emptyValue: 0 },
  { name: '上传', data: throughputBuckets.value.up, color: '#2dd4bf', bucketed: true, area: true, emptyValue: 0 }
], false, { min: 0, max: throughputBuckets.value.axisMax }, { axisWindowStepMs: CHART_HISTORY_SAMPLE_MS }));
const temperatureChartOption = computed(() => {
  const colors = ['#fb923c', '#34d399', '#5b8def', '#a78bfa', '#f472b6', '#2dd4bf'];
  const series = Object.entries(histories.temperatures || {})
    .filter(([, values]) => Array.isArray(values) && values.length)
    .map(([key, values], index) => ({ name: temperatureNames[key] || key, data: smoothSeries(values, 3), color: colors[index % colors.length] }));
  return lineOption(series);
});
const batteryChartOption = computed(() => {
  const cutoff = Date.now() - BATTERY_HISTORY_WINDOW_MS;
  const points = batterySamples.value
    .filter(item => Number(item.timestamp) >= cutoff)
    .map(item => [Number(item.timestamp), numeric(item.percent)]);
  return lineOption([{ name: '电量', data: points, color: '#34d399', area: true }], false, { min: 0, max: 100 }, { windowMs: BATTERY_HISTORY_WINDOW_MS });
});

function toItems(object) {
  return Object.entries(object).map(([label, value]) => ({ label, value: firstValue(value) }));
}

function normalizePointList(value, cutoff) {
  if (!Array.isArray(value)) return [];
  const buckets = new Map();
  value.forEach(item => {
    const timestamp = Number(item?.[0]);
    const pointValue = numeric(item?.[1]);
    if (!Number.isFinite(timestamp) || timestamp < cutoff || pointValue == null) return;
    const bucketTime = Math.floor(timestamp / CHART_HISTORY_SAMPLE_MS) * CHART_HISTORY_SAMPLE_MS;
    buckets.set(bucketTime, [bucketTime, pointValue]);
  });
  return [...buckets.values()]
    .sort((left, right) => left[0] - right[0])
    .slice(-CHART_HISTORY_MAX_POINTS);
}

function loadChartHistory() {
  const cutoff = Date.now() - METRIC_HISTORY_WINDOW_MS;
  const stored = uni.getStorageSync(CHART_HISTORY_KEY) || {};
  const temperatures = {};
  Object.entries(stored.temperatures || {}).forEach(([key, values]) => {
    const normalized = normalizePointList(values, cutoff);
    if (normalized.length) temperatures[key] = normalized;
  });
  return {
    rsrp: normalizePointList(stored.rsrp, cutoff),
    sinr: normalizePointList(stored.sinr, cutoff),
    rsrq: normalizePointList(stored.rsrq, cutoff),
    down: normalizePointList(stored.down, cutoff),
    up: normalizePointList(stored.up, cutoff),
    temperatures
  };
}

function persistChartHistory(force = false) {
  const now = Date.now();
  if (!force && now - lastChartHistorySave < 5000) return;
  lastChartHistorySave = now;
  uni.setStorageSync(CHART_HISTORY_KEY, {
    rsrp: histories.rsrp,
    sinr: histories.sinr,
    rsrq: histories.rsrq,
    down: histories.down,
    up: histories.up,
    temperatures: histories.temperatures
  });
}

function pushHistory(list, timestamp, value) {
  if (value == null) return;
  const bucketTime = Math.floor(timestamp / CHART_HISTORY_SAMPLE_MS) * CHART_HISTORY_SAMPLE_MS;
  const last = list.at(-1);
  if (last?.[0] === bucketTime) last[1] = value;
  else list.push([bucketTime, value]);
  pruneHistory(list, timestamp);
}

function pruneHistory(list, timestamp) {
  const cutoff = timestamp - METRIC_HISTORY_WINDOW_MS;
  while (list.length && list[0][0] < cutoff) list.shift();
  if (list.length > CHART_HISTORY_MAX_POINTS) list.splice(0, list.length - CHART_HISTORY_MAX_POINTS);
}

function captureHistory(payload) {
  const timestamp = Number(payload.timestamp) || Date.now();
  const nextSignal = payload.signal || {};
  const nextStatus = payload.status || {};
  const nextTemperature = payload.temperature || {};
  pushHistory(histories.rsrp, timestamp, numeric(firstValue(nextSignal.Z5g_rsrp, nextSignal.lte_rsrp, nextSignal.rssi)));
  pushHistory(histories.sinr, timestamp, numeric(firstValue(nextSignal.Z5g_SINR, nextSignal.Z5g_snr, nextSignal.lte_snr)));
  pushHistory(histories.rsrq, timestamp, numeric(firstValue(nextSignal.Z5g_rsrq, nextSignal.lte_rsrq)));
  pushHistory(histories.down, timestamp, numeric(nextStatus.realtime_rx_thrpt));
  pushHistory(histories.up, timestamp, numeric(nextStatus.realtime_tx_thrpt));
  Object.entries(nextTemperature).forEach(([key, value]) => {
    if (!/temp|sensor|temperature/i.test(key) || /level|oom_temp_pro/i.test(key)) return;
    const number = numeric(value);
    if (number == null) return;
    if (!Array.isArray(histories.temperatures[key])) histories.temperatures[key] = [];
    pushHistory(histories.temperatures[key], timestamp, number);
  });
  Object.values(histories.temperatures).forEach(values => pruneHistory(values, timestamp));
  persistChartHistory();
}

function stableTimeBuckets(values, maximum = 720, windowMs = METRIC_HISTORY_WINDOW_MS) {
  if (!Array.isArray(values) || !values.length) return [];
  const bucketMs = Math.max(1000, Math.ceil(windowMs / maximum / 1000) * 1000);
  const buckets = new Map();
  values.forEach(point => {
    const timestamp = Number(point?.[0]);
    const value = numeric(point?.[1]);
    if (!Number.isFinite(timestamp) || value == null) return;
    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStart) || { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count += 1;
    buckets.set(bucketStart, bucket);
  });
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketStart, bucket]) => [bucketStart + bucketMs, Number((bucket.sum / bucket.count).toFixed(3))]);
}

function smoothSeries(values, windowSize = 3) {
  if (!Array.isArray(values) || values.length < 2 || windowSize < 2) return values;
  const half = Math.floor(windowSize / 2);
  return values.map((point, i) => {
    const t = point[0];
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    for (let j = start; j <= end; j++) {
      const v = numeric(values[j][1]);
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    return count ? [t, Number((sum / count).toFixed(2))] : point;
  });
}

function niceAxisMax(values) {
  const maximum = Math.max(0, ...values.filter(value => Number.isFinite(value)));
  if (maximum <= 0) return 1024;
  const padded = maximum * 1.12;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function lineOption(series, dualAxis = false, range = {}, behavior = {}) {
  const axisWindowStepMs = Math.max(1000, Number(behavior.axisWindowStepMs) || CHART_HISTORY_SAMPLE_MS);
  const chartNow = Math.ceil(Date.now() / axisWindowStepMs) * axisWindowStepMs;
  const windowMs = Number(behavior.windowMs) || METRIC_HISTORY_WINDOW_MS;
  const animate = behavior.animation !== false;
  const yAxisRange = index => behavior.yAxisRanges?.[index] || {};
  const hasData = series.some(item => Array.isArray(item.data) && item.data.length);
  const timestamps = series.flatMap(item => (Array.isArray(item.data) ? item.data : []))
    .map(point => Number(point?.[0]))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const dataStart = timestamps[0] || chartNow;
  const dataEnd = timestamps.at(-1) || chartNow;
  const dataSpan = Math.max(CHART_HISTORY_SAMPLE_MS, dataEnd - dataStart);
  const minimumVisibleWindow = Number(behavior.minimumVisibleWindow) || 30 * 60 * 1000;
  const visibleWindow = Math.min(windowMs, Math.max(minimumVisibleWindow, dataSpan * 1.25));
  const visibleEnd = chartNow;
  const visibleStart = Math.max(chartNow - windowMs, visibleEnd - visibleWindow);
  const zoomEnabled = behavior.zoom !== false;
  return {
    animation: animate,
    animationDuration: 0,
    animationDurationUpdate: animate ? 480 : 0,
    animationEasingUpdate: 'cubicOut',
    color: series.map(item => item.color),
    grid: { left: 12, right: dualAxis ? 12 : 8, top: 40, bottom: zoomEnabled ? 46 : 22, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15,23,42,.92)',
      borderColor: 'rgba(255,255,255,.10)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      extraCssText: 'border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.22);',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(100,116,139,.5)', width: 1, type: 'dashed' } }
    },
    legend: { top: 0, right: 4, icon: 'roundRect', itemWidth: 18, itemHeight: 4, itemGap: 14, textStyle: { color: '#64748b', fontSize: 10 } },
    graphic: hasData ? [] : [{
      type: 'text',
      left: 'center',
      top: '42%',
      silent: true,
      style: { text: '等待采集数据，曲线将自动滚动显示', fill: '#94a3b8', fontSize: 12 }
    }],
    xAxis: { type: 'time', min: chartNow - windowMs, max: chartNow, boundaryGap: false, axisLabel: { color: '#94a3b8', fontSize: 9, hideOverlap: true, margin: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#eef2f7' } }, splitLine: { show: false } },
    dataZoom: zoomEnabled ? [
      {
        id: 'history-inside',
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        startValue: visibleStart,
        endValue: visibleEnd,
        minValueSpan: 5 * 60 * 1000,
        maxValueSpan: windowMs,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
        preventDefaultMouseMove: true
      },
      {
        id: 'history-slider',
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        startValue: visibleStart,
        endValue: visibleEnd,
        minValueSpan: 5 * 60 * 1000,
        maxValueSpan: windowMs,
        height: 14,
        bottom: 4,
        borderColor: 'transparent',
        backgroundColor: '#f1f5f9',
        fillerColor: 'rgba(91,141,239,.16)',
        dataBackground: { lineStyle: { color: '#94a3b8', opacity: .45 }, areaStyle: { color: '#cbd5e1', opacity: .18 } },
        selectedDataBackground: { lineStyle: { color: '#5b8def' }, areaStyle: { color: '#93c5fd', opacity: .22 } },
        handleSize: 12,
        handleStyle: { color: '#ffffff', borderColor: '#5b8def', borderWidth: 1 },
        moveHandleSize: 4,
        moveHandleStyle: { color: '#5b8def', opacity: .55 },
        showDetail: false,
        brushSelect: false
      }
    ] : [],
    yAxis: dualAxis ? [
      { type: 'value', scale: true, ...yAxisRange(0), axisLabel: { color: '#94a3b8', fontSize: 9 }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#f1f5f9', width: 1 } } },
      { type: 'value', scale: true, ...yAxisRange(1), axisLabel: { color: '#d97706', fontSize: 9 }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false } }
    ] : [{ type: 'value', scale: range.min == null, min: range.min, max: range.max, axisLabel: { color: '#94a3b8', fontSize: 9 }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#f1f5f9', width: 1 } } }],
    series: series.map(item => buildLineSeries(item, windowMs, chartNow))
  };
}

function lineGradient(color) {
  return {
    type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
    colorStops: [
      { offset: 0, color: `${color}4d` },
      { offset: 0.55, color: `${color}b3` },
      { offset: 1, color }
    ]
  };
}

function areaGradient(color) {
  return {
    opacity: 1,
    color: {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: `${color}33` },
        { offset: 0.65, color: `${color}12` },
        { offset: 1, color: `${color}00` }
      ]
    }
  };
}

function markLivePoint(data, color) {
  if (!Array.isArray(data) || !data.length) return data;
  const lastIndex = data.length - 1;
  return data.map((point, index) => {
    if (index !== lastIndex) return point;
    return {
      value: point,
      symbol: 'circle',
      symbolSize: 7,
      itemStyle: {
        color,
        borderColor: '#ffffff',
        borderWidth: 1.6,
        shadowColor: `${color}cc`,
        shadowBlur: 10
      }
    };
  });
}

function ensureVisibleSeries(data, chartNow, windowMs, emptyValue) {
  if (Array.isArray(data) && data.length > 1) return data;
  if (Array.isArray(data) && data.length === 1) {
    const point = data[0];
    const timestamp = Number(point?.[0]);
    const value = numeric(point?.[1]);
    if (Number.isFinite(timestamp) && value != null) {
      return [[Math.max(chartNow - windowMs, timestamp - CHART_HISTORY_SAMPLE_MS), value], point];
    }
  }
  if (emptyValue == null) return [];
  return [[chartNow - windowMs, emptyValue], [chartNow, emptyValue]];
}

function buildLineSeries(item, windowMs, chartNow) {
  const color = item.color;
  const bucketed = item.bucketed ? item.data : stableTimeBuckets(item.data, 720, windowMs);
  const data = markLivePoint(ensureVisibleSeries(bucketed, chartNow, windowMs, item.emptyValue), color);
  return {
    id: item.name,
    name: item.name,
    type: 'line',
    data,
    yAxisIndex: item.axis || 0,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 7,
    smooth: 0.3,
    connectNulls: true,
    lineStyle: { width: 2.2, cap: 'round', color: lineGradient(color), shadowColor: `${color}59`, shadowBlur: 8 },
    emphasis: { focus: 'series', lineStyle: { width: 3 } },
    areaStyle: item.area ? areaGradient(color) : undefined
  };
}

function miniLineOption(download, upload, axisMax) {
  const chartNow = Math.ceil(Date.now() / CHART_HISTORY_SAMPLE_MS) * CHART_HISTORY_SAMPLE_MS;
  const downColor = '#5b8def';
  const upColor = '#2dd4bf';
  const downData = ensureVisibleSeries(stableTimeBuckets(download, 240), chartNow, METRIC_HISTORY_WINDOW_MS, 0);
  const upData = ensureVisibleSeries(stableTimeBuckets(upload, 240), chartNow, METRIC_HISTORY_WINDOW_MS, 0);
  return {
    animation: true,
    animationDuration: 0,
    animationDurationUpdate: 480,
    animationEasingUpdate: 'cubicOut',
    grid: { left: 2, right: 4, top: 4, bottom: 2 },
    xAxis: { type: 'time', min: chartNow - METRIC_HISTORY_WINDOW_MS, max: chartNow, boundaryGap: false, show: false },
    yAxis: { type: 'value', min: 0, max: axisMax, show: false },
    series: [
      {
        id: 'download-mini', type: 'line', data: markLivePoint(downData, downColor),
        showSymbol: false, symbol: 'circle', symbolSize: 5, smooth: 0.3,
        lineStyle: { width: 2, color: lineGradient(downColor), shadowColor: `${downColor}4d`, shadowBlur: 6 },
        areaStyle: areaGradient(downColor)
      },
      {
        id: 'upload-mini', type: 'line', data: markLivePoint(upData, upColor),
        showSymbol: false, symbol: 'circle', symbolSize: 5, smooth: 0.3,
        lineStyle: { width: 2, color: lineGradient(upColor), shadowColor: `${upColor}4d`, shadowBlur: 6 }
      }
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
    errorMessage.value = merged.stale ? `当前显示缓存数据：${merged.serverMessage || '路由器暂时离线'}` : '';
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
  moreOpen.value = false;
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
  Object.assign(settingsForm, config);
  settingsResult.value = '正在保存并重新登录…';
  try {
    const result = await routerApi.login(true);
    settingsResult.value = result.loggedIn ? `${result.message}，密码已生效` : result.message;
    await refresh(true);
  } catch (error) {
    settingsResult.value = error.message;
  }
}

function syncOverlayState() {
  Object.assign(overlayState, routerApi.getOverlayState());
}

function toggleOverlay(event) {
  const enabled = Boolean(event?.detail?.value);
  Object.assign(overlayState, routerApi.setOverlayEnabled(enabled));
  if (enabled && !overlayState.permitted) {
    settingsResult.value = '请允许 U50 Pro 控制台显示在其他应用上层';
    routerApi.requestOverlayPermission();
  } else {
    settingsResult.value = enabled ? '悬浮窗已开启' : '悬浮窗已关闭';
  }
}

function handlePageShow() {
  setTimeout(syncOverlayState, 250);
}

function confirmAction(title, content) {
  return new Promise(resolve => {
    uni.showModal({ title, content, confirmText: '继续', cancelText: '取消', success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false) });
  });
}

async function runDeviceAction(action) {
  const labels = { 'wifi-on': '开启 Wi-Fi', 'wifi-off': '关闭 Wi-Fi', reboot: '重启设备', shutdown: '关闭设备' };
  const prompts = {
    'wifi-off': '关闭后当前 Wi-Fi 连接会断开，需要通过设备按键或重新连接恢复。',
    reboot: '设备会暂时离线，通常需要约一分钟恢复。',
    shutdown: '设备关机后无法远程重新开机，需要按实体电源键。'
  };
  if (prompts[action] && !(await confirmAction(labels[action], prompts[action]))) return;
  actionBusy.value = true;
  deviceActionResult.value = `正在${labels[action]}…`;
  try {
    const result = await routerApi.controlDevice(action);
    const accepted = ['success', '0', '4', 0, 4].includes(result?.result);
    deviceActionResult.value = accepted ? `${labels[action]}命令已执行` : `${labels[action]}返回：${result?.result ?? '未知'}`;
    if (action === 'wifi-on') setTimeout(() => refresh(true), 1800);
  } catch (error) {
    if (action === 'wifi-off' && /超时|timeout|网络/i.test(error.message)) deviceActionResult.value = '连接已中断，关闭 Wi-Fi 命令可能已经生效';
    else deviceActionResult.value = error.message;
  } finally {
    actionBusy.value = false;
  }
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

async function initialize() {
  await refresh();
}

onMounted(() => {
  initialize();
  syncOverlayState();
  if (typeof window !== 'undefined') window.addEventListener('pageshow', handlePageShow);
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
  persistChartHistory(true);
  clearInterval(pollTimer);
  clearInterval(clockTimer);
  if (typeof window !== 'undefined') window.removeEventListener('pageshow', handlePageShow);
});
</script>

<style scoped src="./index.css"></style>
