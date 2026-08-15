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
  gap: 14px;
  align-items: center;
  min-height: 43px;
  border-bottom: 1px solid #edf0f4;
}

.data-row:last-child {
  border-bottom: 0;
}

.data-label {
  color: #687285;
  font-size: 13px;
}

.data-value {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
  white-space: normal;
  color: #172033;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
}

.empty-row {
  padding: 24px 8px;
  color: #7b8494;
  font-size: 13px;
  text-align: center;
}
</style>
