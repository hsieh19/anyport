<script setup lang="ts">
import { watch } from "vue";
import {
  useCollectionStore
} from "@/stores/collectionStore";
import { useModbusState } from "./composables/useModbusState";
import { useDeviceStore } from "@/stores/deviceStore";
import DataChart from "./DataChart.vue";
import { exportCollectionToCsv } from "@/utils/csvExporter";

const handleExport = (all: boolean = false) => {
    const slaveAddr = props.state.slaveAddress.value;
    // 如果选择 all，导出 7 天；否则如果正在采集或有会话开始时间，导出本次会话
    if (all) {
        exportCollectionToCsv(slaveAddr);
    } else {
        const startTime = collectionStore.sessionStartTime || undefined;
        exportCollectionToCsv(slaveAddr, startTime);
    }
};

const props = defineProps<{
  state: ReturnType<typeof useModbusState>;
}>();

const collectionStore = useCollectionStore();
const deviceStore = useDeviceStore();

// 状态变量清理完毕

// ✅ 监听点表切换，即时同步
watch(
  () => props.state.selectedProfile.value,
  (newProfile) => {
    collectionStore.currentProfile = newProfile;
  },
  { immediate: true },
);
</script>

<template>
  <section class="panel-section collection-section">
    <div class="collection-content">
      <!-- ✅ 优化后的单行控制栏 -->
      <div class="collection-control-row">
        <div class="main-actions">
          <button
            class="btn-action-main"
            :class="{ active: collectionStore.isCollecting }"
            :disabled="
              !deviceStore.isModbusConnected ||
              collectionStore.selectedChannels.length === 0
            "
            @click="
              collectionStore.isCollecting
                ? collectionStore.stopCollection()
                : collectionStore.startCollection()
            "
          >
            {{ collectionStore.isCollecting ? "停止采集" : "开始轮询" }}
          </button>

          <div class="export-group">
            <button
              class="btn-action secondary export-main"
              title="仅导出本次采集开启后的数据"
              @click="handleExport(false)"
            >
              导出此段
            </button>
            <button
              class="btn-action secondary export-all"
              title="导出最近 7 天所有全量数据"
              @click="handleExport(true)"
            >
              全量
            </button>
          </div>

          <button
            class="btn-action secondary"
            title="重置图表与计数"
            @click="collectionStore.clearData()"
          >
            🗑️ 清理
          </button>
        </div>

        <div class="control-group">
          <label>间隔</label>
          <input
            type="number"
            v-model.number="collectionStore.interval"
            class="dec-input-small compact"
            min="100"
            step="100"
            :disabled="collectionStore.isCollecting"
          />
          <span class="unit">ms</span>
        </div>

        <div class="control-group">
          <label title="趋势图显示的时间跨度区间">X轴步长</label>
          <input
            type="number"
            v-model.number="collectionStore.xAxisStep"
            class="dec-input-small compact"
            min="0.1"
            max="1440"
            step="0.5"
          />
          <span class="unit">分</span>
        </div>

        <div class="control-group">
          <label title="Y轴显示的最小刻度间距">Y轴步长</label>
          <input
            type="number"
            v-model.number="collectionStore.yAxisStep"
            class="dec-input-small compact"
            min="0.0001"
            max="1000"
            step="0.1"
          />
        </div>
        <div class="compact-status" :class="{ 'is-stopped': !collectionStore.isCollecting }">
          <span class="dot-collecting"></span>
          <span class="num succ">{{ collectionStore.successCount }}</span> /
          <span class="num err">{{ collectionStore.errorCount }}</span>
        </div>

        <!-- ✅ 通道列表展示 (单行集成) -->
        <div
          v-if="collectionStore.selectedChannels.length > 0"
          class="inline-monitor-list"
        >
          <span class="divider"></span>
          <div
            v-for="ch in collectionStore.selectedChannels"
            :key="ch.id"
            class="mini-chip-lite"
          >
            {{ ch.name }}
            <span
              v-if="!collectionStore.isCollecting"
              class="remove"
              @click="collectionStore.removeChannel(ch.id)"
              >×</span
            >
          </div>
          <button
            v-if="!collectionStore.isCollecting"
            class="btn-text-clear"
            @click="collectionStore.selectedChannels = []"
          >
            重置列表
          </button>
        </div>
      </div>

      <div class="visual-header">实时趋势图</div>
      <DataChart />
    </div>
  </section>
</template>

<style scoped>
.collection-section {
  /* 移除 margin-top，改由父容器 gap 控制 */
}

.collection-content {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.collection-control-row {
  display: flex;
  align-items: center;
  justify-content: flex-start; /* 靠左对齐 */
  gap: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dec-input-small.compact {
  width: 80px;
  height: 2.22rem;
  text-align: center;
  padding: 0 8px;
}

.main-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-action-main {
  padding: 0 20px;
  height: 2.22rem; /* 统一高度 */
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action-main:hover {
  filter: brightness(1.1);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.btn-action-main.active {
  background: #f56565;
}

.export-group {
  display: flex;
  align-items: center;
  gap: 0;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.export-group .btn-action.secondary {
  border: none;
  border-radius: 0;
  height: 2.22rem;
}

.export-main {
  padding: 0 12px;
  border-right: 1px solid var(--color-border) !important;
}

.export-all {
  padding: 0 8px;
  background: var(--color-bg-dim) !important;
  font-size: 0.75rem !important;
}

.btn-action.secondary:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.inline-monitor-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.divider {
  width: 1px;
  height: 1.5rem;
  background: var(--color-border);
  margin: 0 4px;
}

.mini-chip-lite {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  padding: 0 10px;
  height: 2rem;
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--color-text);
  white-space: nowrap;
}

.mini-chip-lite .remove {
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1;
}

.mini-chip-lite .remove:hover {
  color: #f56565;
}

.btn-text-clear {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  text-decoration: underline;
  cursor: pointer;
  white-space: nowrap;
}

.compact-status {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.03);
  padding: 0 12px;
  height: 2.2rem;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.85rem;
  font-weight: 600;
}

.compact-status .succ {
  color: #48bb78;
}
.compact-status .err {
  color: #f56565;
}

.dot-collecting {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  animation: pulse 2s infinite;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
}

.is-stopped .dot-collecting {
  background: #9ca3af;
  animation: none;
  box-shadow: none;
}

.compact-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 32px;
  background: rgba(16, 185, 129, 0.05);
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
  border: 1px solid rgba(16, 185, 129, 0.1);
  transition: all 0.3s;
}

.compact-status.is-stopped {
  background: var(--color-bg-dim);
  border-color: var(--color-border);
  opacity: 0.8;
}

.compact-status .num {
  font-family: var(--font-mono);
}
.compact-status .succ {
  color: #48bb78;
}
.compact-status .err {
  color: #f56565;
}

.mini-chip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-primary-dim);
  padding: 0 8px;
  height: 24px;
  border-radius: 4px;
  font-size: 0.75rem;
  color: var(--color-primary);
  white-space: nowrap;
}

.mini-chip .remove {
  cursor: pointer;
  opacity: 0.6;
}

.mini-chip .remove:hover {
  opacity: 1;
  color: #f56565;
}

.dec-input-small {
  width: 90px;
}

.dec-input-large {
  width: 100%;
}

.visual-header {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-left: 3px solid var(--color-primary);
  padding-left: 8px;
  margin-top: 10px;
}

.collecting-tag {
  font-size: 0.75rem;
  color: #48bb78;
  margin-left: 12px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.6;
  }
}
</style>
