<script setup lang="ts">
import { ref, onMounted, onActivated, watch } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ProtocolType } from '@shared/types/protocol.types';
import { BacnetService } from '@/protocols/bacnet';
import { Play, Square, Search } from 'lucide-vue-next';
import BacnetDeviceExplorer from './BacnetDeviceExplorer.vue';
import BacnetLogView from './BacnetLogView.vue';

const deviceStore = useDeviceStore();

// 通过 templateRef 调用子组件暴露的扫描方法
const explorerRef = ref<InstanceType<typeof BacnetDeviceExplorer> | null>(null);
const isScanning = ref(false);

// --- 连接状态 ---
const protocolMode = ref<'mstp' | 'ip'>('ip');
const targetIp = ref('127.0.0.1');
const msTpMac = ref(0);
const useForeignDevice = ref(false);
const ttl = ref(60);

// --- 校验状态 ---
const ipError = ref(false);
const macError = ref(false);

const validateInputs = () => {
  let isValid = true;
  if (protocolMode.value === 'ip') {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    ipError.value = !ipRegex.test(targetIp.value);
    isValid = !ipError.value;
  } else {
    macError.value = typeof msTpMac.value !== 'number' || msTpMac.value < 0 || msTpMac.value > 127;
    isValid = !macError.value;
  }
  return isValid;
};

// --- 协议/连接类型同步 ---
function updateProtocolState() {
  const type = protocolMode.value === 'mstp' ? ProtocolType.BACNET_MSTP : ProtocolType.BACNET_IP;
  deviceStore.setProtocol(type);
  deviceStore.setConnectionType(protocolMode.value === 'ip' ? 'bridge' : 'serial');
}

onMounted(() => updateProtocolState());
onActivated(() => updateProtocolState());
watch(protocolMode, () => updateProtocolState());

// --- 连接控制 ---
async function toggleConnection() {
  if (deviceStore.isBacnetConnected) {
    try { await deviceStore.disconnect(); } catch(e) { console.error('Disconnect Error', e); }
  } else {
    if (!validateInputs()) return;

    if (protocolMode.value === 'ip') {
      deviceStore.setConnectionType('bridge');
      deviceStore.updateGatewayOptions({
        protocol: 'udp',
        tcpTarget: { ip: targetIp.value, port: 47808 }
      });
    } else {
      deviceStore.setConnectionType('serial');
    }

    try {
        await deviceStore.connect();
        if (useForeignDevice.value && protocolMode.value === 'ip') {
          await registerForeignDevice();
        }
    } catch (e: any) {
        console.error('Connect Error:', e.message);
    }
  }
}

async function registerForeignDevice() {
  if (!deviceStore.isBacnetConnected) return;
  try {
      await deviceStore.sendCommand({
        protocol: ProtocolType.BACNET_IP,
        bvlcFunction: 0x05,
        data: BacnetService.createRegisterForeignDevicePayload(ttl.value)
      });
  } catch (e) {
      console.error('Register FD Error:', e);
  }
}
</script>

<template>
  <div class="bacnet-scan-container">
    <!-- 顶部工具栏：连接控制 + 协议选择 -->
    <div class="top-toolbar">
      <div class="toolbar-group">
        <button class="tool-btn" @click="toggleConnection" :class="{ connected: deviceStore.isBacnetConnected }">
          <Play v-if="!deviceStore.isBacnetConnected" :size="16" />
          <Square v-else :size="16" />
          <span>{{ deviceStore.isBacnetConnected ? '断开' : '连接' }}</span>
        </button>
        <button class="tool-btn" :disabled="!deviceStore.isBacnetConnected || explorerRef?.isScanning" @click="explorerRef?.scanDevices()">
          <Search :size="16" :class="{ spinning: explorerRef?.isScanning }" />
          <span>{{ explorerRef?.isScanning ? '扫描中...' : '扫描' }}</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="toolbar-group">
        <select v-model="protocolMode" class="toolbar-select">
          <option value="ip">BACnet IP</option>
          <option value="mstp">BACnet MS/TP</option>
        </select>
        <input
          v-if="protocolMode === 'ip'"
          v-model="targetIp"
          placeholder="网关 IP"
          class="toolbar-input"
          :class="{ 'error-input': ipError }"
          @input="validateInputs"
        />
        <input
          v-else
          v-model="msTpMac"
          type="number"
          placeholder="MAC"
          class="toolbar-input small"
          :class="{ 'error-input': macError }"
          @input="validateInputs"
        />

        <div v-if="protocolMode === 'ip'" class="toolbar-checkbox">
          <input type="checkbox" id="fd-reg" v-model="useForeignDevice" />
          <label for="fd-reg">外来设备</label>
          <input v-if="useForeignDevice" type="number" v-model="ttl" min="1" max="65535" title="TTL" class="toolbar-input tiny" />
        </div>
      </div>
    </div>

    <!-- 主工作区 -->
    <div class="main-workspace">
      <!-- 上部：设备浏览器（设备树 + 属性面板）+ 通信日志 -->
      <div class="upper-layout">
        <BacnetDeviceExplorer
          ref="explorerRef"
          :protocol-mode="protocolMode"
          :target-ip="targetIp"
          :ms-tp-mac="msTpMac"
          :is-connected="deviceStore.isBacnetConnected"
        />
        <BacnetLogView />
      </div>

      <!-- 下部：写命令控制区（占位） -->
      <footer class="command-control-panel">
        <div class="view-header">
          <div class="header-left">
            <span>写命令控制区</span>
          </div>
        </div>
        <div class="command-area-placeholder">
          <div class="placeholder-content">
            <p>写命令控制功能正在开发中...</p>
            <p class="sub-text">此处将支持 <b>Present Value</b> 写入、优先级选择及命令下发日志</p>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.bacnet-scan-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  overflow: hidden;
}

.top-toolbar {
  height: 48px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 1rem;
  gap: 1rem;
  flex-shrink: 0;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  cursor: pointer;
}

.tool-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.tool-btn.connected {
  color: #ef4444;
  border-color: #ef4444;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
}

.toolbar-select, .toolbar-input {
  height: 28px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.toolbar-input.small { width: 60px; }
.toolbar-input.tiny { width: 70px; height: 28px; }

.toolbar-checkbox {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.toolbar-checkbox input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.main-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.upper-layout {
  flex: 7;
  display: flex;
  min-height: 0;
  border-bottom: 1px solid var(--color-border);
}

.command-control-panel {
  flex: 3;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  min-height: 180px;
}

.command-area-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.view-header {
  height: 32px;
  background: rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  padding: 0 0.75rem;
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

.error-input {
  border-color: #ef4444 !important;
}
</style>
