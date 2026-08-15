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
    this.lastOption = this.option;
    this.resizeHandler = () => this.scheduleRender(true);
    this.visibilityHandler = () => {
      if (!document.hidden) this.recoverChart();
    };
    this.pageShowHandler = () => this.recoverChart();
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender(true));
      this.resizeObserver.observe(this.$el);
    }
    this.scheduleRender(true);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('pageshow', this.pageShowHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.resizeObserver?.disconnect();
    if (this.updateFrame) cancelAnimationFrame(this.updateFrame);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.instance?.dispose();
  },
  methods: {
    update(value) {
      if (!value) return;
      this.lastOption = value;
      this.pendingOption = value;
      this.scheduleRender(false);
    },
    ensureInstance() {
      const width = this.$el.clientWidth;
      const height = this.$el.clientHeight;
      if (width < 2 || height < 2) return false;
      if (!this.instance || this.instance.isDisposed()) {
        this.instance = echarts.init(this.$el, null, {
          renderer: 'canvas',
          useDirtyRect: false,
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2)
        });
        this.hasRendered = false;
      }
      return true;
    },
    scheduleRender(forceFullRender = false) {
      this.forceFullRender = this.forceFullRender || forceFullRender;
      if (this.updateFrame) return;
      this.updateFrame = requestAnimationFrame(() => {
        this.updateFrame = 0;
        if (!this.ensureInstance()) {
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => this.scheduleRender(true), 120);
          return;
        }
        const option = this.pendingOption || this.lastOption;
        if (!option) return;
        this.pendingOption = null;
        const force = this.forceFullRender || !this.hasRendered;
        this.forceFullRender = false;
        this.instance.resize({
          width: this.$el.clientWidth,
          height: this.$el.clientHeight,
          silent: true
        });
        this.instance.setOption(option, { notMerge: force, lazyUpdate: false, silent: true });
        this.instance.getZr().refreshImmediately();
        this.hasRendered = true;
      });
    },
    recoverChart() {
      this.scheduleRender(true);
      if (this.recoverTimer) clearTimeout(this.recoverTimer);
      this.recoverTimer = setTimeout(() => this.scheduleRender(true), 180);
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
  min-width: 0;
  overflow: hidden;
}

.chart-root {
  position: relative;
}
</style>
