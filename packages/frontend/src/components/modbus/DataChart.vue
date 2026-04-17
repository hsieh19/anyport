<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useCollectionStore } from '@/stores/collectionStore';

echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  CanvasRenderer,
  DataZoomComponent
]);

const collectionStore = useCollectionStore();
const chartRef = ref<HTMLElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

const initChart = () => {
  if (!chartRef.value) return;
  // 使用 dark 模式支持（如果系统支持）
  const isDark = document.documentElement.classList.contains('dark');
  chartInstance = echarts.init(chartRef.value, isDark ? 'dark' : undefined);
  updateChart();
};

const updateChart = () => {
  if (!chartInstance) return;

  // 计算时间窗口（根据颗粒度设置）
  const now = Date.now();
  let maxTime = now;
  
  // 找出所有数据中的最新时间，以确保图表随数据向前推进
  Object.values(collectionStore.chartData).forEach(pts => {
    if (pts.length > 0) {
      const last = (pts[pts.length - 1] as any).timestamp;
      if (last > maxTime) maxTime = last;
    }
  });

  const timeWindowMs = (collectionStore.xAxisStep || 1) * 60 * 1000;
  const minTime = maxTime - timeWindowMs;

  const series = collectionStore.selectedChannels.map(channel => ({
    name: channel.name,
    type: 'line',
    showSymbol: false,
    smooth: true,
    data: (collectionStore.chartData[channel.id] || []).map(p => [p.timestamp, p.value])
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#6a7985'
        }
      },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#eee',
      borderWidth: 1,
      textStyle: { color: '#333' },
      formatter: (params: any) => {
        if (!params.length) return '';
        let res = `<div style="font-weight:600;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:4px;">${new Date(params[0].value[0]).toLocaleTimeString()}</div>`;
        params.forEach((p: any) => {
          const val = p.value[1] === null ? '--' : p.value[1];
          res += `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};"></span>
                    <span style="flex:1;font-size:12px;">${p.seriesName}</span>
                    <b style="font-family:monospace;">${val}</b>
                  </div>`;
        });
        return res;
      }
    },
    legend: {
      data: collectionStore.selectedChannels.map(c => c.name),
      bottom: 0,
      textStyle: { fontSize: 11 }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '5%',
      containLabel: true
    },
    xAxis: {
      type: 'time',
      min: minTime,
      max: maxTime,
      splitLine: { show: false },
      axisLabel: { fontSize: 10, color: '#999' }
    },
    yAxis: {
      type: 'value',
      boundaryGap: [0, '10%'],
      scale: true,
      minInterval: collectionStore.yAxisStep, // 关键：限制最小刻度步长
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.1 } },
      axisLabel: { fontSize: 10, color: '#999' }
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { 
        type: 'slider', 
        show: false, 
        start: 0, 
        end: 100
      }
    ],
    series
  };

  chartInstance.setOption(option);
};

// 监听数据变化进行更新，采用节流减少频繁重绘
let throttleTimer: any = null;
watch([() => collectionStore.chartData, () => collectionStore.xAxisStep, () => collectionStore.yAxisStep], () => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
        updateChart();
        throttleTimer = null;
    }, 500); // 500ms 刷新率
}, { deep: true });

const resizeHandler = () => chartInstance?.resize();

onMounted(() => {
    initChart();
    window.addEventListener('resize', resizeHandler);
});

onUnmounted(() => {
    window.removeEventListener('resize', resizeHandler);
    chartInstance?.dispose();
});
</script>

<template>
  <div class="chart-wrapper">
    <div ref="chartRef" class="chart-container"></div>
    <div v-if="collectionStore.selectedChannels.length === 0" class="chart-placeholder">
       请选择左侧通道以开始实时图表绘制
    </div>
  </div>
</template>

<style scoped>
.chart-wrapper {
  position: relative;
  width: 100%;
  height: 300px;
  background: var(--color-bg-dim);
  border-radius: 6px;
  margin-top: 12px;
}

.chart-container {
  width: 100%;
  height: 100%;
}

.chart-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  font-style: italic;
  pointer-events: none;
}
</style>
