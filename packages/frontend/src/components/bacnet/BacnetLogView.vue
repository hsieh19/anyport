<script setup lang="ts">
import { Terminal, Trash2 } from 'lucide-vue-next';
import { useDeviceStore } from '@/stores/deviceStore';

const deviceStore = useDeviceStore();
</script>

<template>
  <aside class="side-logs">
    <div class="view-header">
      <div class="header-left">
        <Terminal :size="14" />
        <span>通信日志</span>
      </div>
      <button class="header-action-btn" @click="deviceStore.clearLogs()" title="清除日志">
        <Trash2 :size="12" />
      </button>
    </div>
    <div class="log-table-container">
      <table class="log-table">
        <thead>
          <tr>
            <th style="width: 75px">时间</th>
            <th style="width: 55px">收发</th>
            <th>原始报文 (HEX)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in deviceStore.bacnetLogs" :key="log.id" :class="log.direction">
            <td class="time">{{ log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</td>
            <td class="dir">
              <span class="dir-tag" :class="log.direction">{{ log.direction.toUpperCase() }}</span>
            </td>
            <td class="hex">{{ log.hex }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </aside>
</template>

<style scoped>
.side-logs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg);
}

.view-header {
  height: 32px;
  background: rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-action-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}

.header-action-btn:hover {
  background: rgba(255,255,255,0.1);
  color: #ef4444;
}

.log-table-container {
  flex: 1;
  overflow: auto;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
}

.log-table th {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  text-align: left;
  padding: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
  white-space: nowrap;
}

.log-table td {
  padding: 0.4rem 0.5rem;
  font-size: 0.82rem;
  border-bottom: 1px solid rgba(255,255,255,0.02);
}

.dir-tag {
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 2px;
}

.dir-tag.tx { background: rgba(14, 165, 233, 0.2); color: #38bdf8; }
.dir-tag.rx { background: rgba(34, 197, 94, 0.2); color: #4ade80; }

.log-table .hex {
  font-family: 'Consolas', monospace;
  color: var(--color-text-secondary);
  word-break: break-all;
  opacity: 0.8;
}
</style>
