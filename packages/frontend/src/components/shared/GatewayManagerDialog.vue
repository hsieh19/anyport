<script setup lang="ts">
import { useDeviceStore } from '@/stores/deviceStore';
import { 
  X, 
  Trash, 
  ExternalLink, 
  Clock, 
  Wifi, 
  Server
} from 'lucide-vue-next';

defineProps<{ show: boolean }>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
}>();

const deviceStore = useDeviceStore();

function close() {
  emit('update:show', false);
}

function remove(id: string) {
  if (confirm('确认删除此网关记录？其历史统计信息将会被保留，但记录将从列表中移除。')) {
    deviceStore.removeGateway(id);
  }
}

function clearOffline() {
  if (confirm('确认清除所有当前离线（超过30秒未收到心跳）的网关？')) {
    deviceStore.clearOfflineGateways();
  }
}

function connectGateway(gw: any) {
  deviceStore.saveMqttConfig({
    siteId: gw.siteId,
    gatewayId: gw.gatewayId
  });
  // 如果当前是 MQTT 模式，尝试连接
  if (deviceStore.connectionType === 'mqtt') {
    deviceStore.connectMqtt();
    close();
  } else {
    alert('请先将连接模式切换为 MQTT 模式以连接此网关。');
  }
}

function formatTime(val: number) {
  if (!val) return '-';
  const date = new Date(val);
  const Y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const D = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="overlay" @click.self="close">
        <div class="card">
          <header class="dialog-header">
            <div class="header-title-area">
              <h3>网关管理</h3>
              <button 
                @click="clearOffline" 
                class="btn-ghost-danger btn-sm" 
                :disabled="deviceStore.gateways.filter(g => !g.online).length === 0"
                title="清除所有离线状态的记录"
              >
                <Trash :size="14" />
                <span>清除离线</span>
              </button>
            </div>
            <button class="close-btn" @click="close">
              <X :size="20" />
            </button>
          </header>
          
          <div class="body p-6 pt-2">
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>网关标识</th>
                    <th>设备 ID</th>
                    <th>最后通信</th>
                    <th>实时状态</th>
                    <th class="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="deviceStore.gateways.length === 0">
                    <td colspan="5" class="empty-state">
                      <div class="empty-content">
                        <Server :size="48" stroke-width="1.5" />
                        <p>暂无发现的活跃网关</p>
                        <span class="hint">确保网关已正常上电并连接至 MQTT Broker</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-for="gw in deviceStore.gateways" :key="gw.id" :class="{ 'gw-offline': !gw.online }">
                    <td>
                      <div class="gw-site">
                        <div class="gw-icon">
                          <Wifi v-if="gw.config?.wifiIp" :size="14" />
                          <Server v-else :size="14" />
                        </div>
                        <span class="site-name">{{ gw.siteId }}</span>
                      </div>
                    </td>
                    <td>
                      <code class="gw-id">{{ gw.gatewayId }}</code>
                    </td>
                    <td>
                      <div class="time-info">
                        <Clock :size="12" />
                        <span>{{ formatTime(gw.lastSeen) }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="status-badge" :class="gw.online ? 'status-online' : 'status-offline'">
                        <div class="dot-container">
                          <span class="dot"></span>
                          <span v-if="gw.online" class="dot-ping"></span>
                        </div>
                        {{ gw.online ? '在线' : '离线' }}
                      </div>
                    </td>
                    <td>
                      <div class="row-actions">
                        <button 
                          class="action-btn connect-btn" 
                          title="连接网关"
                          @click="connectGateway(gw)"
                          v-if="gw.online"
                        >
                          <ExternalLink :size="16" />
                        </button>
                        <button 
                          class="action-btn delete-btn" 
                          title="移除记录"
                          @click="remove(gw.id)"
                        >
                          <Trash :size="16" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 1rem;
}

.card {
  background: var(--color-surface);
  width: 100%;
  max-width: 800px;
  border-radius: var(--radius-lg);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg), 0 0 0 1px var(--color-border);
  overflow: hidden;
  animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-up {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.dialog-header {
  padding: 1.25rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
}

.header-title-area {
  display: flex;
  align-items: center;
  gap: 1rem;
}

h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--color-text);
}

.btn-ghost-danger {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.btn-ghost-danger:hover:not(:disabled) {
  background: rgba(245, 87, 108, 0.1);
  color: var(--color-error);
  border-color: rgba(245, 87, 108, 0.2);
}

.btn-ghost-danger:disabled {
  opacity: 0.3;
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 0.4rem;
  border-radius: var(--radius-md);
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.btn-sm {
  padding: 0.4rem 0.8rem;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.btn-outline:hover:not(:disabled) {
  background: var(--color-surface-hover);
  border-color: var(--color-text-secondary);
  color: var(--color-text);
}

.danger-on-hover:hover:not(:disabled) {
  border-color: var(--color-error);
  color: var(--color-error);
  background: rgba(245, 87, 108, 0.1);
}

.table-container {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

th {
  background: var(--color-surface-hover);
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}

td {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

tr:last-child td {
  border-bottom: none;
}

tr:hover td {
  background: var(--color-surface-hover);
}

.gw-site {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.gw-icon {
  width: 32px;
  height: 32px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}

.site-name {
  font-weight: 600;
  color: var(--color-text);
}

.gw-id {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}

.time-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--color-text-secondary);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-online {
  background: rgba(17, 153, 142, 0.15);
  color: #2dd4bf;
}

.status-offline {
  background: rgba(136, 136, 160, 0.15);
  color: var(--color-text-secondary);
}

.dot-container {
  position: relative;
  width: 8px;
  height: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: block;
}

.status-online .dot { background: #2dd4bf; }
.status-offline .dot { background: var(--color-text-secondary); }

.dot-ping {
  position: absolute;
  top: 0;
  left: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2dd4bf;
  animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}

@keyframes ping {
  75%, 100% {
    transform: scale(2.5);
    opacity: 0;
  }
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.action-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  border: 1px solid transparent;
  padding: 0 !important; /* 关键修复：防止全局 button padding 挤压图标 */
  flex-shrink: 0;
}

.action-btn :deep(svg) {
  stroke-width: 2.5px; /* 增加图标粗细 */
}

/* 连接按钮 - 蓝色/紫色系 */
.connect-btn {
  background-color: rgba(102, 126, 234, 0.1);
  color: #6366f1;
  border-color: rgba(102, 126, 234, 0.2);
}

.connect-btn:hover {
  background-color: #6366f1;
  color: white;
  border-color: #4f46e5;
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.3);
}

/* 删除按钮 - 红色系 */
.delete-btn {
  background-color: rgba(244, 63, 94, 0.1); /* 更明显的淡红色 */
  color: #ef4444; /* 醒目的红色图标 */
  border-color: rgba(244, 63, 94, 0.2);
}

.delete-btn:hover {
  background-color: #ef4444;
  color: white;
  border-color: #dc2626;
  box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3);
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .connect-btn {
    background-color: rgba(102, 126, 234, 0.15);
    border-color: rgba(102, 126, 234, 0.3);
  }
  .delete-btn {
    background-color: rgba(244, 63, 94, 0.15);
    border-color: rgba(244, 63, 94, 0.3);
  }
}

.empty-state {
  padding: 4rem 1rem !important;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--color-text-secondary);
}

.empty-content p {
  margin: 1rem 0 0.5rem;
  font-weight: 600;
  color: var(--color-text);
}

.empty-content .hint {
  font-size: 0.75rem;
}

.text-right { text-align: right; }

/* 动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .card {
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
  
  th:nth-child(2), td:nth-child(2),
  th:nth-child(3), td:nth-child(3) {
    display: none;
  }
}
</style>

