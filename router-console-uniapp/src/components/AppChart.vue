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
    this.zoomState = null;
    this.resizeHandler = () => this.scheduleRender(true);
    this.visibilityHandler = () => {
      if (!document.hidden) this.recoverChart();
    };
    this.pageShowHandler = () => this.recoverChart();
    this.touchStartHandler = event => this.handleTouchStart(event);
    this.touchMoveHandler = event => this.handleTouchMove(event);
    this.touchEndHandler = event => this.handleTouchEnd(event);
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.$el.addEventListener('touchstart', this.touchStartHandler, { passive: false, capture: true });
    this.$el.addEventListener('touchmove', this.touchMoveHandler, { passive: false, capture: true });
    this.$el.addEventListener('touchend', this.touchEndHandler, { passive: false, capture: true });
    this.$el.addEventListener('touchcancel', this.touchEndHandler, { passive: false, capture: true });
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
    this.$el.removeEventListener('touchstart', this.touchStartHandler, true);
    this.$el.removeEventListener('touchmove', this.touchMoveHandler, true);
    this.$el.removeEventListener('touchend', this.touchEndHandler, true);
    this.$el.removeEventListener('touchcancel', this.touchEndHandler, true);
    this.resizeObserver?.disconnect();
    if (this.updateFrame) cancelAnimationFrame(this.updateFrame);
    if (this.touchZoomFrame) cancelAnimationFrame(this.touchZoomFrame);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.instance?.dispose();
  },
  methods: {
    handleTouchStart(event) {
      const touch = event.touches?.[0];
      const option = this.instance?.getOption?.();
      const dataZoom = option?.dataZoom || [];
      if (!touch || !this.instance || !dataZoom.some(item => item.type === 'slider')) return;
      const rect = this.$el.getBoundingClientRect();
      const y = touch.clientY - rect.top;
      if (y < rect.height - 42) return;
      const dataZoomIndex = dataZoom.findIndex(item => item.type === 'slider');
      const current = dataZoom[dataZoomIndex] || dataZoom[0];
      const start = Number(current.start);
      const end = Number(current.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      this.touchZoom = {
        x: touch.clientX,
        start,
        end,
        width: Math.max(1, rect.width),
        dataZoomIndex: Math.max(0, dataZoomIndex),
        pendingStart: start
      };
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    handleTouchMove(event) {
      const touch = event.touches?.[0];
      const state = this.touchZoom;
      if (!touch || !state || !this.instance) return;
      const delta = ((touch.clientX - state.x) / state.width) * 100;
      const span = state.end - state.start;
      const start = Math.max(0, Math.min(100 - span, state.start + delta));
      state.pendingStart = start;
      if (!this.touchZoomFrame) {
        this.touchZoomFrame = requestAnimationFrame(() => {
          this.touchZoomFrame = 0;
          const active = this.touchZoom;
          if (!active || !this.instance) return;
          const nextStart = active.pendingStart;
          const nextSpan = active.end - active.start;
          const action = {
            type: 'dataZoom',
            start: nextStart,
            end: nextStart + nextSpan,
            animation: false
          };
          // Keep the inside zoom and the visible slider in lockstep. Some
          // ECharts builds do not consistently apply an index array here.
          this.instance.dispatchAction({ ...action, dataZoomIndex: 0 });
          this.instance.dispatchAction({ ...action, dataZoomIndex: active.dataZoomIndex });
        });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    handleTouchEnd(event) {
      if (!this.touchZoom) return;
      if (this.touchZoomFrame) {
        cancelAnimationFrame(this.touchZoomFrame);
        this.touchZoomFrame = 0;
      }
      this.touchZoom = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.scheduleRender(false);
    },
    update(value) {
      if (!value) return;
      this.lastOption = value;
      this.pendingOption = value;
      if (this.touchZoom) return;
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
        this.instance.on('datazoom', event => {
          const batch = event?.batch?.[0] || event || {};
          const current = this.instance?.getOption()?.dataZoom?.[0] || {};
          const start = Number(batch.start ?? current.start);
          const end = Number(batch.end ?? current.end);
          this.zoomState = Number.isFinite(start) && Number.isFinite(end) && end >= start
            ? { start, end }
            : null;
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
        const renderOption = this.zoomState && Array.isArray(option.dataZoom)
          ? {
              ...option,
              dataZoom: option.dataZoom.map(item => {
                if (item.type !== 'inside' && item.type !== 'slider') return item;
                const { startValue, endValue, ...rest } = item;
                return { ...rest, start: this.zoomState.start, end: this.zoomState.end };
              })
            }
          : option;
        this.instance.setOption(renderOption, { notMerge: force, lazyUpdate: false, silent: true });
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
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.chart-root {
  position: relative;
}
</style>
