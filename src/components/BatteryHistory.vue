<template>
  <view ref="root" class="battery-history" :style="virtualized ? { height: `${range.totalHeight}px` } : {}">
    <view class="history-window" :class="{ virtualized }" :style="virtualized ? { transform: `translateY(${range.offset}px)` } : {}">
      <view v-for="sample in visibleSamples" :key="sample.timestamp" class="history-row">
        <view class="history-time">
          <text>{{ formatDate(sample.timestamp) }}</text>
          <text class="source-badge">{{ collectionSourceLabel(sample.source) }}</text>
        </view>
        <b>{{ sample.percent }}%</b>
        <text>{{ sample.charging ? '充电' : '放电' }}</text>
        <text class="history-temperature">{{ sample.temperature == null ? '—' : `${sample.temperature}°C` }}</text>
      </view>
    </view>
    <view v-if="!samples.length" class="empty-state">记录样本不足，应用会继续自动积累。</view>
  </view>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { collectionSourceLabel } from '../utils/collection-source.js';
import { formatDate } from '../utils/format.js';
import { virtualListRange } from '../utils/virtual-list.js';

const props = defineProps({ samples: { type: Array, default: () => [] } });
const root = ref(null);
const virtualized = ref(typeof document !== 'undefined');
const ROW_HEIGHT = 63;
const range = shallowRef({ start: 0, end: 20, offset: 0, totalHeight: props.samples.length * ROW_HEIGHT });
const visibleSamples = computed(() => {
  const { start, end } = virtualized.value ? range.value : { start: 0, end: props.samples.length };
  // Samples are chronological. Slice before reversing so rendering never walks
  // or formats the entire day's history when the dashboard ticks.
  return props.samples.slice(Math.max(0, props.samples.length - end), props.samples.length - start).reverse();
});
let scroller;
let element;
let frame = 0;
let observer;
let disposed = false;

function updateRange() {
  frame = 0;
  if (disposed || !element || !scroller) return;
  const viewport = scroller.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  const next = virtualListRange({
    count: props.samples.length,
    scrollOffset: viewport.top - bounds.top,
    viewportHeight: scroller.clientHeight,
    rowHeight: ROW_HEIGHT
  });
  const current = range.value;
  if (next.start !== current.start || next.end !== current.end || next.totalHeight !== current.totalHeight) range.value = next;
}

function scheduleRange() {
  if (!frame && !disposed) frame = requestAnimationFrame(updateRange);
}

onMounted(async () => {
  if (typeof document === 'undefined') return;
  element = root.value?.$el || root.value;
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    // overflow-x:hidden implicitly computes overflow-y:auto on content-wrap,
    // but that expanding wrapper is not the actual uni-app scroll viewport.
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)
      && (parent.scrollHeight > parent.clientHeight || parent.classList.contains('uni-scroll-view'))) {
      scroller = parent;
      break;
    }
  }
  if (!scroller) { virtualized.value = false; return; }
  virtualized.value = true;
  updateRange();
  await nextTick();
  if (disposed) return;
  scroller.addEventListener('scroll', scheduleRange, { passive: true });
  window.addEventListener('resize', scheduleRange);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(scheduleRange);
    observer.observe(scroller);
    if (element.parentElement) observer.observe(element.parentElement);
  }
  updateRange();
});

watch(() => props.samples.length, () => {
  if (virtualized.value) scheduleRange();
}, { flush: 'post' });

onBeforeUnmount(() => {
  disposed = true;
  if (frame) cancelAnimationFrame(frame);
  observer?.disconnect();
  scroller?.removeEventListener('scroll', scheduleRange);
  if (typeof window !== 'undefined') window.removeEventListener('resize', scheduleRange);
});
</script>

<style scoped>
.battery-history { position: relative; min-height: 42px; }
.history-window.virtualized { position: absolute; top: 0; left: 0; right: 0; }
.history-row {
  display: grid;
  height: 56px;
  margin-bottom: 7px;
  padding: 0 8px;
  grid-template-columns: minmax(150px, 1.6fr) 0.5fr 0.6fr 0.7fr;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid rgba(30, 41, 59, 0.08);
  font-size: 11px;
}
.history-row b { color: #6d5bd0; }
.history-time { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 2px; }
.history-time > text:first-child { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.source-badge {
  display: inline-block;
  padding: 2px 7px;
  border: 1px solid rgba(109, 91, 208, 0.18);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.45);
  color: #47536b;
  font-size: 11px;
  line-height: 18px;
}
.empty-state { padding: 12px; color: #7a8799; font-size: 12px; text-align: center; }
@media (max-width: 680px) {
  .history-row { grid-template-columns: minmax(0, 1.5fr) 0.5fr 0.6fr; gap: 7px; }
  .history-temperature { display: none; }
}
</style>
