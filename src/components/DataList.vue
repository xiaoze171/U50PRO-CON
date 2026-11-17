<template>
  <view class="data-list">
    <view v-for="item in items" :key="item.label" class="data-row">
      <text class="data-label">{{ item.label }}</text>
      <text class="data-value">{{ item.value }}</text>
    </view>
    <view v-if="!items.length" class="empty-row">{{ emptyText }}</view>
  </view>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => []
  },
  emptyText: {
    type: String,
    default: '暂无数据'
  }
});
</script>

<style scoped>
.data-list {
  width: 100%;
}

.data-row {
  display: grid;
  grid-template-columns: minmax(96px, 0.8fr) minmax(0, 1.4fr);
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line, #e6ecf3);
}

.data-row:last-child {
  border-bottom: 0;
}

.data-label {
  color: var(--text-muted, #61728a);
  font-size: 12px;
  line-height: 1.5;
}

.data-value {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: normal;
  white-space: normal;
  color: var(--text-strong, #172b45);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.empty-row {
  padding: 14px 8px;
  color: var(--text-muted, #61728a);
  font-size: 12px;
  text-align: center;
}
</style>
