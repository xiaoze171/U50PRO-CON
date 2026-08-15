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
    this.instance = echarts.init(this.$el, null, {
      renderer: 'canvas',
      useDirtyRect: true,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2)
    });
    this.update(this.option);
    this.resizeHandler = () => this.instance?.resize();
    window.addEventListener('resize', this.resizeHandler);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.updateFrame) cancelAnimationFrame(this.updateFrame);
    this.instance?.dispose();
  },
  methods: {
    update(value) {
      if (!this.instance || !value) return;
      this.pendingOption = value;
      if (this.updateFrame) return;
      this.updateFrame = requestAnimationFrame(() => {
        this.updateFrame = 0;
        if (!this.instance || !this.pendingOption) return;
        const option = this.pendingOption;
        this.pendingOption = null;
        // Reuse the canvas and update in a render frame. This avoids exposing
        // ECharts' intermediate cleared frame in Android WebView.
        this.instance.setOption(option, { notMerge: false, lazyUpdate: false, silent: true });
      });
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
