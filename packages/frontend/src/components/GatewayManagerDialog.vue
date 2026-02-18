<script setup lang="ts">
import { useDeviceStore } from '@/stores/deviceStore';

defineProps<{ show: boolean }>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
}>();

const deviceStore = useDeviceStore();

function close() {
  emit('update:show', false);
}

function remove(id: string) {
  if (confirm('确认删除此网关记录？')) {
    deviceStore.removeGateway(id);
  }
}

function clearOffline() {
  if (confirm('确认清除所有离线网关？')) {
    deviceStore.clearOfflineGateways();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="overlay" @click.self="close">
        <div class="card">
          <header>
            <h3>网关管理</h3>
            <button class="close-btn" @click="close">×</button>
          </header>
          <div class="body">
            <div class="actions">
              <button 
                @click="clearOffline" 
                class="btn-text danger" 
                :disabled="deviceStore.gateways.filter(g => !g.online).length === 0"
              >
                清除离线网关
              </button>
            </div>
            
            <div class="list">
              <div v-if="deviceStore.gateways.length === 0" class="empty">
                暂无发现的网关
              </div>
              <div v-for="gw in deviceStore.gateways" :key="gw.id" class="item">
                <div class="status" :class="{ online: gw.online }"></div>
                <div class="info">
                  <div class="main-info">
                    <span class="site">{{ gw.siteId }}</span>
                    <span class="sep">/</span>
                    <span class="id">{{ gw.gatewayId }}</span>
                  </div>
                  <div class="sub-info">
                    Last seen: {{ new Date(gw.lastSeen).toLocaleTimeString() }}
                    <span v-if="gw.config?.version">v{{ gw.config.version }}</span>
                    <span v-if="gw.config?.ethIp">ETH: {{ gw.config.ethIp }}</span>
                    <span v-if="gw.config?.wifiIp">Wi-Fi: {{ gw.config.wifiIp }}</span>
                  </div>
                </div>
                <button class="del-btn" @click="remove(gw.id)">删除</button>
              </div>
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
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.card {
  background: white;
  width: 90%;
  max-width: 500px;
  border-radius: 12px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2);
  overflow: hidden;
}

header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #9ca3af;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #4b5563;
}

.body {
  padding: 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.actions {
  text-align: right;
}

.btn-text {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  padding: 4px 8px;
  border-radius: 4px;
}

.btn-text.danger {
  color: #dc2626;
}

.btn-text.danger:hover:not(:disabled) {
  background: #fee2e2;
}

.btn-text:disabled {
  color: #d1d5db;
  cursor: not-allowed;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
  flex-shrink: 0;
}

.status.online {
  background: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}

.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.main-info {
  font-weight: 600;
  font-size: 0.95rem;
  color: #374151;
}

.site { color: #4b5563; }
.id { color: #111827; }

.sep {
  margin: 0 4px;
  color: #d1d5db;
}

.sub-info {
  font-size: 0.75rem;
  color: #6b7280;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.del-btn {
  padding: 4px 10px;
  background: #fee2e2;
  color: #b91c1c;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  transition: all 0.2s;
}

.del-btn:hover {
  background: #fecaca;
}

.empty {
  text-align: center;
  color: #9ca3af;
  padding: 2rem;
  background: #f9fafb;
  border-radius: 8px;
  font-size: 0.9rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
