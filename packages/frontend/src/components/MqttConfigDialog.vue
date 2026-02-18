<script setup lang="ts">
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
            </header>

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

@media (max-width: 640px) {
  .mqtt-config-card {
    max-width: 95%;
  }
}
</style>
