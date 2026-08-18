<template>
  <view class="metric-grid">
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
  }
});
</script>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #e5eaf1;
  border-radius: 8px;
  background: #e5eaf1;
}

.metric-item {
  min-width: 0;
  min-height: 78px;
  padding: 14px 16px;
  background: #fff;
}

.metric-label,
.metric-note {
  display: block;
  color: #718096;
  font-size: 12px;
  line-height: 1.35;
}

.metric-value {
  display: block;
  margin-top: 6px;
  overflow-wrap: anywhere;
  color: #172033;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.metric-note {
  margin-top: 5px;
}

.wide {
  grid-column: span 2;
}

@media (max-width: 760px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-item {
    min-height: 72px;
    padding: 12px;
  }

  .metric-value {
    font-size: 16px;
  }
}
</style>
