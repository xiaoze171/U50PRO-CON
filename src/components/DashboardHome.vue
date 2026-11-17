<template>
  <view class="home-dashboard">
    <button class="home-card home-speed" aria-label="进入信号调优" @click="$emit('navigate', 'radio')">
      <view class="home-network-row">
        <view class="home-network-copy"><text class="home-network">{{ displayText(network) }}</text><text class="home-operator">{{ displayText(operator) }}</text></view>
        <view class="home-signal-bars" :aria-label="signalStrength ? `信号强度 ${signalStrength} 格` : '暂无信号读数'"><i v-for="bar in 5" :key="bar" :class="{ active: bar <= signalStrength }" :style="{ height: `${5 + bar * 3}px` }" /></view>
      </view>
      <view class="home-rates">
        <view class="home-rate home-download"><text class="home-rate-label"><IconArrowDown :size="14" />下载速度</text><view class="home-rate-value"><b>{{ splitValue(download).value }}</b><text>{{ splitValue(download).unit }}</text></view></view>
        <view class="home-rate home-upload"><text class="home-rate-label"><IconArrowUp :size="14" />上传速度</text><view class="home-rate-value"><b>{{ splitValue(upload).value }}</b><text>{{ splitValue(upload).unit }}</text></view></view>
      </view>
    </button>

    <button class="home-card home-battery" aria-label="查看电池详情" @click="$emit('navigate', 'battery')">
      <view class="home-battery-heading"><text class="home-battery-label">剩余电量</text><b class="home-battery-percent">{{ displayText(batteryPercent) }}</b><text class="home-battery-state">{{ displayText(batteryState) }}</text></view>
      <view v-if="batteryProgress != null" class="home-progress" role="progressbar" aria-label="剩余电量" :aria-valuenow="batteryProgress" aria-valuemin="0" aria-valuemax="100"><view :style="{ width: `${batteryProgress}%` }" /></view>
      <view class="home-battery-times">
        <view class="home-time"><text class="home-time-label">预计充满</text><b>{{ displayText(timeToFull) }}</b><text v-if="timeToFullReason" class="home-time-reason">{{ timeToFullReason }}</text></view>
        <view class="home-time"><text class="home-time-label">剩余可用</text><b>{{ displayText(runtime) }}</b><text v-if="runtimeReason" class="home-time-reason">{{ runtimeReason }}</text></view>
      </view>
    </button>

    <button class="home-card home-signal-panel" aria-label="进入信号调优面板" @click="$emit('navigate', 'radio')">
      <view class="home-panel-heading"><text class="home-panel-title">信号</text><view class="home-panel-more"><text>调优</text><IconChevronRight :size="14" /></view></view>
      <text v-if="signalSubtitle" class="home-panel-subtitle">{{ signalSubtitle }}</text>
      <view v-if="signalPanels.length" class="home-signal-groups">
        <view v-for="panel in signalPanels" :key="panel.key" class="home-signal-group">
          <text class="home-group-label">{{ displayText(panel.label) }}</text>
          <view class="home-signal-grid">
            <view v-for="metric in panel.metrics || []" :key="metric.key" class="home-signal-metric">
              <text class="home-metric-label">{{ metric.label }}</text>
              <view class="home-metric-value"><b>{{ displayText(metric.value) }}</b><text v-if="hasReading(metric.value) && metric.unit">{{ metric.unit }}</text></view>
              <view class="home-quality-track" aria-hidden="true"><view v-if="hasReading(metric.value) && barPercent(metric.percent) != null" class="home-quality-fill" :class="`home-quality-${metric.level || 'unknown'}`" :style="{ width: `${barPercent(metric.percent)}%` }" /></view>
            </view>
          </view>
          <view v-if="panel.details?.length" class="home-signal-details">
            <view v-for="(detail, index) in panel.details" :key="`${detail.label}-${index}`" class="home-signal-detail"><text>{{ detail.label }}</text><b>{{ displayText(detail.value) }}</b></view>
          </view>
        </view>
      </view>
      <text v-else class="home-panel-empty">暂无信号读数</text>
    </button>

    <button class="home-card home-temperature-panel" aria-label="查看温度详情" @click="$emit('navigate', 'temperature')">
      <view class="home-panel-heading"><text class="home-panel-title"><IconTemperature :size="16" />温度</text><view class="home-panel-more"><text>详情</text><IconChevronRight :size="14" /></view></view>
      <text v-if="temperatureSubtitle" class="home-panel-subtitle">{{ temperatureSubtitle }}</text>
      <view v-if="temperatureMetrics.length" class="home-temperature-grid">
        <view v-for="metric in temperatureMetrics" :key="metric.key" class="home-temperature-metric" :class="`home-temperature-${metric.state || 'unknown'}`">
          <text class="home-metric-label">{{ metric.label }}</text>
          <view class="home-temperature-value"><b>{{ displayText(metric.value) }}</b><text v-if="hasReading(metric.value) && metric.unit">{{ metric.unit }}</text></view>
          <text v-if="metric.note" class="home-temperature-note">{{ metric.note }}</text>
        </view>
      </view>
      <text v-else class="home-panel-empty">暂无温度传感器读数</text>
    </button>

    <view class="home-shortcuts">
      <button class="home-card home-shortcut" aria-label="查看流量详情" @click="$emit('navigate', 'usage')"><view class="home-shortcut-heading"><IconChartPie :size="17" /><text>流量</text><IconChevronRight :size="12" /></view><text class="home-shortcut-summary">本月 {{ displayText(monthlyUsage) }}</text></button>
      <button class="home-card home-shortcut" aria-label="查看连接设备" @click="$emit('navigate', 'clients')"><view class="home-shortcut-heading"><IconDevices :size="17" /><text>设备</text><IconChevronRight :size="12" /></view><text class="home-shortcut-summary">{{ displayText(clientCount) }}</text></button>
      <button class="home-card home-shortcut" aria-label="查看短信" @click="$emit('navigate', 'sms')"><view class="home-shortcut-heading"><IconMessage :size="17" /><text>短信</text><IconChevronRight :size="12" /></view><text class="home-shortcut-summary">{{ displayText(smsCount) }}</text></button>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { IconArrowDown, IconArrowUp, IconChartPie, IconChevronRight, IconDevices, IconMessage, IconTemperature } from '@tabler/icons-vue';

const props = defineProps({
  network: String, operator: String, download: [String, Number], upload: [String, Number],
  signalMetrics: { type: Array, default: () => [] },
  signalPanels: { type: Array, default: () => [] },
  temperatureMetrics: { type: Array, default: () => [] },
  signalSubtitle: String, temperatureSubtitle: String,
  batteryPercent: [String, Number], batteryState: String,
  timeToFull: [String, Number], runtime: [String, Number],
  timeToFullReason: String, runtimeReason: String,
  monthlyUsage: [String, Number], temperatureAlert: String,
  clientCount: [String, Number], smsCount: [String, Number]
});
defineEmits(['navigate']);

function displayText(raw) {
  return raw == null || String(raw).trim() === '' ? '—' : String(raw);
}
function splitValue(raw) {
  const text = displayText(raw);
  const match = text.match(/^(.*?)\s+(\S+)$/);
  return match ? { value: match[1], unit: match[2] } : { value: text, unit: '' };
}
function hasReading(raw) {
  return displayText(raw).trim() !== '—';
}
function barPercent(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
}
const batteryProgress = computed(() => {
  const match = displayText(props.batteryPercent).trim().match(/^(\d+(?:\.\d+)?)\s*%?$/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
});
const signalStrength = computed(() => {
  const raw = props.signalPanels.length
    ? props.signalPanels[0].metrics?.find(item => item.key === 'rsrp')?.value
    : props.signalMetrics.find(item => item.label === 'RSRP')?.value;
  const value = Number.parseFloat(raw);
  return !Number.isFinite(value) ? 0 : value >= -80 ? 5 : value >= -90 ? 4 : value >= -100 ? 3 : value >= -110 ? 2 : 1;
});
</script>

<style scoped>
.home-dashboard { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; color: var(--text-strong, #182332); }
.home-card { width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; border: 1px solid var(--line, #e5e9f0); border-radius: 10px; background: var(--surface, #fff); }
button { margin: 0; font-family: inherit; font-size: 12px; line-height: 1.5; color: inherit; text-align: left; cursor: pointer; }
button::after { border: 0; }
button:focus-visible { outline: 3px solid #9dbdff; outline-offset: 2px; }
button:active { background: var(--surface-soft, #f7f9fc); }
.home-speed, .home-battery, .home-signal-panel, .home-temperature-panel { padding: 14px; }
.home-network-row, .home-network-copy { display: flex; min-width: 0; align-items: center; gap: 8px; }
.home-network-row { justify-content: space-between; }
.home-network-copy { flex: 1; }
.home-network { flex-shrink: 0; max-width: 50%; padding: 2px 6px; overflow-wrap: anywhere; border-radius: 5px; background: var(--accent-soft, #edf1ff); color: var(--accent, #4267ed); font-size: 11px; font-weight: 600; }
.home-operator { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.home-signal-bars { display: flex; flex-shrink: 0; height: 22px; align-items: flex-end; gap: 3px; }
.home-signal-bars i { display: block; width: 3px; border-radius: 2px; background: var(--line, #e5e9f0); }
.home-signal-bars i.active { background: var(--accent, #4267ed); }
.home-rates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.home-rate { min-width: 0; }
.home-rate-label { display: flex; align-items: center; gap: 4px; color: var(--accent, #4267ed); font-size: 11px; }
.home-upload .home-rate-label { color: var(--teal, #167d79); }
.home-rate-value { display: flex; min-width: 0; align-items: baseline; flex-wrap: wrap; gap: 4px; margin-top: 3px; line-height: 1.2; }
.home-rate-value b { min-width: 0; overflow-wrap: anywhere; font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; }
.home-rate-value > text { color: var(--text-muted, #647186); font-size: 11px; }
.home-battery-heading { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 4px 8px; }
.home-battery-label { flex-shrink: 0; font-size: 12px; }
.home-battery-percent { min-width: 0; overflow-wrap: anywhere; font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1.2; }
.home-battery-state { flex: 1 1 64px; min-width: 0; overflow-wrap: anywhere; color: var(--text-muted, #647186); font-size: 12px; text-align: right; }
.home-progress { height: 3px; margin-top: 8px; overflow: hidden; border-radius: 3px; background: #e8edf5; }
.home-progress > view { height: 100%; background: #34a68c; }
.home-battery-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.home-time { min-width: 0; }
.home-time-label, .home-time-reason { display: block; color: var(--text-muted, #647186); font-size: 11px; overflow-wrap: anywhere; }
.home-time b { display: block; margin-top: 3px; overflow-wrap: anywhere; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.5; }
.home-time-reason { margin-top: 2px; }
.home-panel-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
.home-panel-title { display: flex; min-width: 0; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; }
.home-panel-title svg { color: var(--teal, #167d79); }
.home-panel-more { display: flex; flex-shrink: 0; align-items: center; gap: 2px; color: var(--text-muted, #647186); font-size: 11px; }
.home-panel-subtitle, .home-panel-empty { display: block; overflow-wrap: anywhere; color: var(--text-muted, #647186); font-size: 11px; }
.home-panel-subtitle { margin-top: 3px; }
.home-panel-empty { margin-top: 10px; }
.home-signal-groups { display: grid; min-width: 0; gap: 10px; margin-top: 10px; }
.home-signal-group { min-width: 0; }
.home-signal-group + .home-signal-group { padding-top: 10px; border-top: 1px solid var(--line, #e5e9f0); }
.home-group-label { display: inline-block; padding: 1px 5px; border-radius: 4px; background: var(--accent-soft, #edf1ff); color: var(--accent, #4267ed); font-size: 11px; font-weight: 600; }
.home-signal-grid { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin-top: 8px; }
.home-signal-metric, .home-temperature-metric { min-width: 0; }
.home-metric-label { display: block; overflow-wrap: anywhere; color: var(--text-muted, #647186); font-size: 11px; }
.home-metric-value, .home-temperature-value { display: flex; min-width: 0; align-items: baseline; flex-wrap: wrap; gap: 3px; margin-top: 2px; line-height: 1.3; }
.home-metric-value b, .home-temperature-value b { min-width: 0; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.home-metric-value > text, .home-temperature-value > text { color: var(--text-muted, #647186); font-size: 11px; }
.home-quality-track { height: 3px; margin-top: 5px; overflow: hidden; border-radius: 3px; background: var(--line, #e5e9f0); }
.home-quality-fill { height: 100%; border-radius: inherit; background: var(--text-muted, #647186); }
.home-quality-excellent { background: #36c648; }
.home-quality-good { background: #ffd033; }
.home-quality-fair { background: #ff9f29; }
.home-quality-weak { background: #ff5c42; }
.home-quality-bad { background: #d82f2f; }
.home-signal-details { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line, #e5e9f0); }
.home-signal-detail { min-width: 0; }
.home-signal-detail > text { display: block; color: var(--text-muted, #647186); font-size: 11px; overflow-wrap: anywhere; }
.home-signal-detail > b { display: block; margin-top: 1px; overflow-wrap: anywhere; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
.home-temperature-grid { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.home-temperature-metric { padding: 8px; border-radius: 6px; background: var(--surface-soft, #f7f9fc); }
.home-temperature-value b { font-size: 20px; }
.home-temperature-note { display: block; margin-top: 3px; overflow-wrap: anywhere; color: var(--text-muted, #647186); font-size: 11px; }
.home-temperature-invalid { background: #fff7ed; }
.home-temperature-invalid .home-temperature-value b, .home-temperature-invalid .home-temperature-note { color: var(--warning, #96611c); }
.home-shortcuts { display: grid; min-width: 0; grid-column: 1 / -1; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.home-shortcut { padding: 10px 12px; }
.home-shortcut-heading { display: flex; min-width: 0; align-items: center; gap: 5px; }
.home-shortcut-heading > text { flex: 1; min-width: 0; font-size: 12px; }
.home-shortcut-heading svg { flex-shrink: 0; color: var(--text-muted, #647186); }
.home-shortcut-heading svg:first-child { color: var(--accent, #4267ed); }
.home-shortcut-summary { display: block; margin-top: 3px; overflow-wrap: anywhere; color: var(--text-muted, #647186); font-size: 11px; font-variant-numeric: tabular-nums; }
@media (min-width: 360px) {
  .home-signal-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); column-gap: 8px; }
  .home-signal-details { grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 8px; }
}
@media (max-width: 680px) {
  .home-dashboard { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .home-speed, .home-battery, .home-signal-panel, .home-temperature-panel { padding: 12px; }
  .home-rates, .home-battery-times { gap: 8px; }
  .home-signal-grid, .home-signal-details { column-gap: 8px; }
  .home-shortcuts { gap: 8px; }
  .home-shortcut { padding: 8px; }
}
</style>
