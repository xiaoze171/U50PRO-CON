<template>
  <view class="chart-root" :style="{ height }">
    <view class="chart-canvas" :prop="option" :change:prop="chart.update"></view>
  </view>
</template>

<script>
export default {
  name: 'AppChart',
  props: {
    option: {
      type: Object,
      default: () => ({})
    },
    height: {
      type: String,
      default: '280px'
    }
  }
};
</script>

<script module="chart" lang="renderjs">
import * as echarts from 'echarts';

export default {
  mounted() {
    this.instance = echarts.init(this.$el);
    this.update(this.option);
    this.resizeHandler = () => this.instance?.resize();
    window.addEventListener('resize', this.resizeHandler);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.resizeHandler);
    this.instance?.dispose();
  },
  methods: {
    update(value) {
      if (!this.instance || !value) return;
      this.instance.setOption(value, true);
    }
  }
};
</script>

<style scoped>
.chart-root,
.chart-canvas {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
