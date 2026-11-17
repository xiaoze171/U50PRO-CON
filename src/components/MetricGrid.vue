<template>
  <view class="metric-grid" :class="{ centered }">
    <view v-for="item in items" :key="item.label" class="metric-item" :class="item.className">
      <text class="metric-label">{{ item.label }}</text>
      <text class="metric-value">{{ item.value }}</text>
      <text v-if="item.note" class="metric-note">{{ item.note }}</text>
    </view>
  </view>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => []
  },
  centered: {
    type: Boolean,
    default: false
  }
});
</script>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 16px;
}

.metric-item {
  min-width: 0;
  min-height: 64px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line, #e6ecf3);
}

.metric-grid.centered .metric-item {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
}

.metric-label,
.metric-note {
  display: block;
  color: var(--text-muted, #61728a);
  font-size: 11px;
  line-height: 1.5;
}

.metric-value {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--text-strong, #172b45);
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.metric-note {
  margin-top: 3px;
}

.wide {
  grid-column: span 2;
}

@media (max-width: 760px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-item {
    min-height: 60px;
    padding: 8px 0;
  }

  .metric-value {
    font-size: 15px;
  }
}
</style>
