<script setup lang="ts">
import { ref } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';

interface Props {
  show: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'save'): void;
}>();

const deviceStore = useDeviceStore();

const showSyncInput = ref(false);
const syncPassword = ref('');
const isSyncing = ref(false);
const syncError = ref('');
const syncSuccess = ref(false);

async function fetchCloudConfig() {
  if (isSyncing.value) return;
  const pwd = syncPassword.value.trim();
  if (!pwd) {
    syncError.value = '请输入提取密码';
    return;
  }

  isSyncing.value = true;
  syncError.value = '';
  syncSuccess.value = false;

  try {
    const res = await fetch('https://update.anyport.one/anyport/mqtt-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: pwd })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: '网络错误' }));
      throw new Error(errData.error || `请求失败 (${res.status})`);
    }

    const data = await res.json();

    // 自动填充 Store 响应式对象
    deviceStore.mqttConfig.brokerUrl = data.brokerUrl || '';
    deviceStore.mqttConfig.username = data.username || '';
    deviceStore.mqttConfig.password = data.password || '';
    if (data.topicPrefix) {
      deviceStore.mqttConfig.topicPrefix = data.topicPrefix;
    }

    syncSuccess.value = true;
    syncPassword.value = ''; // 成功后清空输入框

    // 1.5 秒后自动收起并恢复状态
    setTimeout(() => {
      showSyncInput.value = false;
      syncSuccess.value = false;
    }, 1500);

  } catch (err: any) {
    syncError.value = err.message || '获取配置失败，请检查网络或提取码';
  } finally {
    isSyncing.value = false;
  }
}

function toggleSyncInput() {
  showSyncInput.value = !showSyncInput.value;
  if (showSyncInput.value) {
    syncError.value = '';
    syncSuccess.value = false;
    syncPassword.value = '';
  }
}

function handleCancel() {
  emit('update:show', false);
}

function handleSave() {
  emit('save');
  emit('update:show', false);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="props.show"
        class="mqtt-config-overlay"
        @click.self="handleCancel"
      >
        <Transition name="zoom">
          <div v-if="props.show" class="mqtt-config-card">
            <header class="mqtt-config-header">
              <h3>MQTT Broker 配置</h3>
              <button
                type="button"
                class="btn-cloud-sync"
                :class="{ active: showSyncInput }"
                @click="toggleSyncInput"
              >
                <svg class="cloud-icon" :class="{ rotating: isSyncing }" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.42-1.02-1.32-3-3.5-3C9.72 8 8 10.42 8 13.5c0 .4.07.8.19 1.18A3.5 3.5 0 0 0 5 18c0 1.93 1.57 3.5 3.5 3.5h9z" />
                  <polyline points="12 12 12 16" />
                  <polyline points="10 14 12 12 14 14" />
                </svg>
                云端同步
              </button>
            </header>

            <!-- 密码滑块抽屉区 -->
            <Transition name="slide">
              <div v-if="showSyncInput" class="sync-drawer">
                <div class="sync-input-group">
                  <input
                    v-model="syncPassword"
                    type="password"
                    placeholder="请输入云端提取密码"
                    class="sync-input"
                    :disabled="isSyncing"
                    @keydown.enter="fetchCloudConfig"
                  />
                  <button
                    type="button"
                    class="btn-sync-action"
                    :disabled="isSyncing"
                    @click="fetchCloudConfig"
                  >
                    <span v-if="isSyncing" class="spinner"></span>
                    <span v-else>一键填充</span>
                  </button>
                </div>
                <Transition name="fade-tip">
                  <p v-if="syncError" class="sync-error-tip">⚠️ {{ syncError }}</p>
                  <p v-else-if="syncSuccess" class="sync-success-tip">✨ 提取成功，配置已自动填充！</p>
                </Transition>
              </div>
            </Transition>

            <section class="mqtt-config-body">
              <div class="form-group">
                <label>Broker 地址</label>
                <input
                  v-model="deviceStore.mqttConfig.brokerUrl"
                  type="text"
                  placeholder="例如 ws://broker.emqx.io:8083/mqtt 或 wss://..."
                />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>用户名 (Username)</label>
                  <input
                    v-model="deviceStore.mqttConfig.username"
                    type="text"
                    placeholder="可选"
                  />
                </div>
                <div class="form-group">
                  <label>密码 (Password)</label>
                  <input
                    v-model="deviceStore.mqttConfig.password"
                    type="password"
                    placeholder="可选"
                  />
                </div>
              </div>

              <div class="form-group">
                <label>Client ID</label>
                <input
                  v-model="deviceStore.mqttConfig.clientId"
                  type="text"
                  placeholder="留空将由前端自动生成"
                />
              </div>

              <div class="form-group">
                <label>Topic 前缀</label>
                <input
                  v-model="deviceStore.mqttConfig.topicPrefix"
                  type="text"
                  placeholder="默认 anyport"
                />
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>Site ID</label>
                  <input
                    v-model="deviceStore.mqttConfig.siteId"
                    type="text"
                    placeholder="例如 office 或 plant-01"
                  />
                </div>
                <div class="form-group">
                  <label>Gateway ID</label>
                  <input
                    v-model="deviceStore.mqttConfig.gatewayId"
                    type="text"
                    placeholder="例如 gateway-01"
                  />
                </div>
              </div>
            </section>

            <footer class="mqtt-config-footer">
              <button
                type="button"
                class="btn-secondary"
                @click="handleCancel"
              >
                取消
              </button>
              <button
                type="button"
                class="btn-primary"
                @click="handleSave"
              >
                保存
              </button>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mqtt-config-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.mqtt-config-card {
  background: #ffffff;
  color: #111827;
  border-radius: 12px;
  width: 90%;
  max-width: 540px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mqtt-config-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.mqtt-config-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.mqtt-config-body {
  padding: 1.25rem 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.form-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 0;
}

.form-group label {
  font-size: 0.85rem;
  color: #4b5563;
}

.form-group input {
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.9rem;
  outline: none;
}

.form-group input::placeholder {
  color: #9ca3af;
}

.form-group input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.3);
}

.mqtt-config-footer {
  padding: 0.9rem 1.5rem 1.1rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-secondary,
.btn-primary {
  padding: 0.5rem 1.2rem;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-secondary {
  background: #ffffff;
  color: #374151;
  border-color: #d1d5db;
}

.btn-secondary:hover {
  background: #f3f4f6;
}

.btn-primary {
  background: #4f46e5;
  color: #ffffff;
  box-shadow: 0 10px 25px rgba(79, 70, 229, 0.45);
}

.btn-primary:hover {
  background: #4338ca;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.zoom-enter-active {
  transition: transform 0.2s ease-out;
}

.zoom-leave-active {
  transition: transform 0.15s ease-in;
}

.zoom-enter-from {
  transform: scale(0.9);
}

.zoom-leave-to {
  transform: scale(0.95);
}

/* ==================== 云端一键同步样式 ==================== */
.mqtt-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-cloud-sync {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 500;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.08);
  border: 1px solid rgba(79, 70, 229, 0.15);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-cloud-sync:hover {
  background: rgba(79, 70, 229, 0.15);
  border-color: rgba(79, 70, 229, 0.3);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);
  transform: translateY(-1px);
}

.btn-cloud-sync.active {
  background: #4f46e5;
  color: #ffffff;
  border-color: #4f46e5;
}

.cloud-icon {
  transition: transform 0.3s ease;
}

.btn-cloud-sync:hover .cloud-icon {
  transform: translateY(-1px);
}

.cloud-icon.rotating {
  animation: cloud-spin 1.2s linear infinite;
}

@keyframes cloud-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 密码滑块抽屉 */
.sync-drawer {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: 0.85rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: hidden;
}

.sync-input-group {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.sync-input {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  font-size: 0.85rem;
  outline: none;
  background: #ffffff;
  transition: all 0.2s ease;
}

.sync-input:focus {
  border-color: #4f46e5;
  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);
}

.btn-sync-action {
  padding: 0.4rem 0.85rem;
  background: #4f46e5;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  height: 32px;
  transition: background 0.2s ease;
}

.btn-sync-action:hover {
  background: #4338ca;
}

.btn-sync-action:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sync-error-tip {
  margin: 0;
  font-size: 0.75rem;
  color: #ef4444;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.sync-success-tip {
  margin: 0;
  font-size: 0.75rem;
  color: #10b981;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 500;
}

/* 动效 transitions */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 100px;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  border-bottom-width: 0 !important;
}

.fade-tip-enter-active,
.fade-tip-leave-active {
  transition: opacity 0.2s ease;
}

.fade-tip-enter-from,
.fade-tip-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .mqtt-config-card {
    max-width: 95%;
  }
}
</style>
