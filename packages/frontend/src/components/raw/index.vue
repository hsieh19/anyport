<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ProtocolType } from '@shared/types/protocol.types';
import ConnectionHeader from '../shared/ConnectionHeader.vue';
import MqttConfigDialog from '../shared/MqttConfigDialog.vue';
import GatewayManagerDialog from '../shared/GatewayManagerDialog.vue';

const deviceStore = useDeviceStore();
const showMqttDialog = ref(false);
const showGatewayManager = ref(false);

// UI 状态
const inputType = ref<'ascii' | 'hex'>('ascii');
const inputText = ref('');
const sendSuffix = ref<'none' | 'cr' | 'lf' | 'crlf'>('none');

// 定时发送状态
const intervalMs = ref(1000);
const isLooping = ref(false);
let loopTimer: number | null = null;

// 生命周期：进入组件时切换协议为 RAW
onMounted(() => {
  deviceStore.setProtocol(ProtocolType.HEX_RAW);
});

// 计算设备是否连接
const isConnected = computed(() => {
  return deviceStore.isModbusConnected;
});

// 监听连接断开，自动停止循环
watch(isConnected, (val) => {
  if (!val && isLooping.value) {
    stopLoop();
  }
});

function formatDisplay(log: any) {
  if (log.direction === 'tx') {
    return log.hex; // TX 统一显示 HEX
  } else {
    if (inputType.value === 'hex') {
      return log.hex;
    } else {
      try {
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(log.data);
      } catch {
        return log.hex; // 降级为 hex
      }
    }
  }
}

async function handleSend() {
  if (!inputText.value) return;
  if (!isConnected.value) {
    if (isLooping.value) stopLoop();
    return;
  }
  
  try {
    const cmd = {
      protocol: ProtocolType.HEX_RAW,
      type: inputType.value,
      data: inputText.value,
      suffix: sendSuffix.value
    };
    
    await deviceStore.sendCommand(cmd);
  } catch (err: any) {
    console.error('发送错误:', err);
    if (isLooping.value) stopLoop();
  }
}

function toggleLoop() {
  if (isLooping.value) {
    stopLoop();
  } else {
    if (!isConnected.value) return;
    if (!inputText.value) return;
    
    isLooping.value = true;
    handleSend(); // 立即先发一次
    loopTimer = window.setInterval(handleSend, Math.max(10, intervalMs.value));
  }
}

function stopLoop() {
  isLooping.value = false;
  if (loopTimer) {
    window.clearInterval(loopTimer);
    loopTimer = null;
  }
}

onBeforeUnmount(() => {
  stopLoop();
});


async function handleConnect() {
  if (deviceStore.connectionType === 'mqtt') {
    const opts = deviceStore.mqttConfig;
    if (!opts.siteId || !opts.gatewayId) {
      showMqttDialog.value = true;
      return;
    }
    await deviceStore.connectMqtt();
  } else {
    await deviceStore.connect();
  }
}

async function handleDisconnect() {
  if (deviceStore.connectionType === 'mqtt') {
    await deviceStore.disconnectGateway();
  } else {
    await deviceStore.disconnect();
  }
}

function clearLogs() {
  deviceStore.clearLogs();
}
</script>

<template>
  <div class="raw-panel">
    <!-- Connection Configuration Header -->
    <ConnectionHeader
      :is-connected="isConnected"
      :is-connecting="deviceStore.isModbusConnecting"
      :connection-type="deviceStore.connectionType"
      :serial-config="deviceStore.serialConfig"
      :mqtt-config="deviceStore.mqttConfig"
      :gateway-options="deviceStore.gatewayOptions"
      :gateways="deviceStore.gateways"
      :modbus-mode="deviceStore.modbusMode"
      :is-mqtt-broker-connected="deviceStore.isMqttBrokerConnected"
      :is-mqtt-broker-connecting="deviceStore.isMqttBrokerConnecting"
      :is-supported="deviceStore.isSupported"
      :hide-protocol-switch="true"
      :show-broker-control="true"
      connect-btn-label="开启连接"
      @connect="handleConnect"
      @disconnect="handleDisconnect"
      @connect-broker="deviceStore.connectMqttBroker()"
      @disconnect-broker="deviceStore.disconnectBroker()"
      @open-mqtt-config="showMqttDialog = true"
      @open-gateway-manager="showGatewayManager = true"
      @update:connection-type="deviceStore.setConnectionType"
      @update:serial-config="deviceStore.updateConfig"
      @update:gateway-options="deviceStore.updateGatewayOptions"
      @select-gateway="(id) => {
        const parts = id.split('/');
        if (parts.length === 2) deviceStore.saveMqttConfig({ siteId: parts[0], gatewayId: parts[1] });
      }"
    />
    <MqttConfigDialog v-model:show="showMqttDialog" />
    <GatewayManagerDialog v-model:show="showGatewayManager" />

    <!-- Monitor Log Area -->
    <div class="log-monitor">
      <div class="log-toolbar">
         <div class="toolbar-title">
            <span class="icon">📟</span>
            串口监视器 
            <span class="status-badge" :class="isConnected ? 'online' : 'offline'">
              {{ isConnected ? '已连接' : '未连接' }}
            </span>
          </div>
          <div class="toolbar-actions">
            <button class="btn-clear" @click="clearLogs">清空记录</button>
          </div>
      </div>
      
      <div class="logs-container">
         <div 
           v-for="log in deviceStore.rawLogs" 
           :key="log.id" 
           class="log-entry" 
           :class="log.direction"
         >
           <div class="log-meta">
             <span class="log-time">{{ log.timestamp.toLocaleTimeString('zh-CN', { hour12: false }) }}.{{ String(log.timestamp.getMilliseconds()).padStart(3, '0') }}</span>
             <span class="log-dir">[{{ log.direction.toUpperCase() }}]</span>
           </div>
           <div class="log-content">{{ formatDisplay(log) }}</div>
         </div>
         <div v-if="deviceStore.rawLogs.length === 0" class="empty-state">
           暂无数据记录，等待接收...
         </div>
      </div>
    </div>
    
    <!-- Sender Area -->
    <div class="sender-panel">
      <div class="sender-config">
        <label>
          输入模式:
          <select v-model="inputType">
            <option value="ascii">ASCII / Char</option>
            <option value="hex">HEX / Hexadecimal</option>
          </select>
        </label>
        <label>
          末尾加回车:
          <select v-model="sendSuffix">
            <option value="none">None</option>
            <option value="cr">\r (CR)</option>
            <option value="lf">\n (LF)</option>
            <option value="crlf">\r\n (CRLF)</option>
          </select>
        </label>
        <label class="interval">
          定时(ms):
          <input type="number" v-model="intervalMs" min="10" step="100" />
        </label>
      </div>
      
      <div class="sender-input-area">
        <textarea 
          v-model="inputText" 
          :placeholder="inputType === 'hex' ? '请输入十六进制字符串，如: 01 03 00 00 00 01' : '请输入文本 (支持 \\r \\n \\xHH 转义)'"
          @keydown.ctrl.enter="handleSend"
          :disabled="!isConnected"
        ></textarea>
        
        <div class="sender-actions">
          <button class="btn-send primary-gradient" @click="handleSend" :disabled="!isConnected || !inputText">
            <span>发送</span>
            <span class="hint">(Ctrl+Enter)</span>
          </button>
          
          <button 
            class="btn-loop" 
            :class="{ active: isLooping }" 
            @click="toggleLoop" 
            :disabled="!isConnected || !inputText"
          >
            {{ isLooping ? '停止循环' : '定时循环' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.raw-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.5rem;
  gap: 1.5rem;
  background: var(--color-bg);
}

/* 监视区域 */
.log-monitor {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.log-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: var(--color-text);
  font-size: 1.1rem;
}

.status-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 99px;
  font-weight: 500;
  margin-left: 0.5rem;
}
.status-badge.online { background: #dcfce7; color: #166534; }
.status-badge.offline { background: #f1f5f9; color: #64748b; }

.btn-clear {
  padding: 0.4rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-clear:hover {
  background: #fee2e2;
  color: #ef4444;
  border-color: #fca5a5;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.log-entry {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem;
  border-bottom: 1px dashed var(--color-border);
  font-family: 'Fira Code', 'Courier New', monospace;
}
.log-entry:last-child { border-bottom: none; }

.log-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
}

.log-time { color: #94a3b8; }
.log-dir { font-weight: 600; }
.log-entry.tx .log-dir { color: #10b981; }
.log-entry.rx .log-dir { color: #3b82f6; }

.log-content {
  font-size: 0.9rem;
  color: var(--color-text);
  word-break: break-all;
  white-space: pre-wrap;
  padding-left: 0.25rem;
}
.log-entry.tx .log-content { color: #059669; }

.empty-state {
  margin: auto;
  color: #94a3b8;
  font-style: italic;
}

/* 发送区域 */
.sender-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: var(--color-surface);
  padding: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.sender-config {
  display: flex;
  gap: 2rem;
  align-items: center;
}

.sender-config label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.sender-config select, 
.sender-config input {
  padding: 0.4rem 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.9rem;
  outline: none;
}
.sender-config select:focus, 
.sender-config input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
}

.interval input { width: 80px; }

.sender-input-area {
  display: flex;
  gap: 1.5rem;
}

textarea {
  flex: 1;
  min-height: 90px;
  resize: vertical;
  padding: 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 0.95rem;
  outline: none;
  transition: all 0.2s;
}
textarea:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}
textarea:disabled {
  background: #f8fafc;
  cursor: not-allowed;
  opacity: 0.7;
}

.sender-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 140px;
}

button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

.primary-gradient {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  color: white;
  flex: 1;
  box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.2);
}
.primary-gradient:hover:not(:disabled) {
  box-shadow: 0 6px 8px -1px rgba(99, 102, 241, 0.3);
  transform: translateY(-1px);
}
.primary-gradient .hint {
  font-size: 0.65rem;
  font-weight: 400;
  opacity: 0.8;
}

.btn-loop {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 0.6rem;
}
.btn-loop:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
.btn-loop.active {
  background: #ef4444;
  color: white;
  border-color: #dc2626;
  animation: pulse-danger 2s infinite;
}

@keyframes pulse-danger {
  0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}
</style>
