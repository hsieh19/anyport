<script setup lang="ts">
/**
 * Mobile Modbus View
 * Optimized for touch interactions with split tabs
 */
import { ref, computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ModbusFunctionCode } from '@/protocols/modbus';
import { ProtocolType } from '@shared/types/protocol.types';
import type { ModbusRtuCommand } from '@/protocols/modbus';

const deviceStore = useDeviceStore();
const activeTab = ref<'connect' | 'control' | 'log'>('connect');

// State maps to Desktop ModbusPanel state
const slaveAddress = ref(1);
const functionCode = ref<ModbusFunctionCode>(ModbusFunctionCode.READ_HOLDING_REGISTERS);
const startAddress = ref(0);
const quantity = ref(10);
const writeValue = ref(0);
const writeValues = ref('');

// Config
const baudRate = ref(9600);
const selectedConfig = computed(() => ({
  baudRate: baudRate.value,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: 'none' as const
}));

const functionCodeOptions = [
  { value: ModbusFunctionCode.READ_HOLDING_REGISTERS, label: '03 - 读保持寄存器' },
  { value: ModbusFunctionCode.READ_INPUT_REGISTERS, label: '04 - 读输入寄存器' },
  { value: ModbusFunctionCode.WRITE_SINGLE_REGISTER, label: '06 - 写单个寄存器' },
  { value: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, label: '10 - 写多个寄存器' },
  // Reduced list for mobile simplicity, or full list? Let's use subset for simplicity first
];

async function toggleConnection() {
  if (deviceStore.isConnected) {
    await deviceStore.disconnect();
  } else {
    // Mobile simplifies config options usually
    deviceStore.updateConfig(selectedConfig.value);
    await deviceStore.connect();
    // Auto switch to control tab on success
    activeTab.value = 'control';
  }
}

async function sendCommand() {
  try {
    const isRead = [3, 4].includes(functionCode.value);
    const cmd: ModbusRtuCommand = {
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: functionCode.value,
      startAddress: startAddress.value,
      quantity: isRead ? quantity.value : undefined,
      values: isRead ? undefined : (functionCode.value === 6 ? [writeValue.value] : writeValues.value.split(',').map(Number))
    };
    await deviceStore.sendCommand(cmd);
    // Auto switch to log tab? Maybe just show toast.
  } catch (e) {
    console.error(e);
  }
}
</script>

<template>
  <div class="mobile-modbus">
    <!-- Top Segment Control -->
    <div class="segment-control">
      <button 
        v-for="tab in ['connect', 'control', 'log']" 
        :key="tab"
        :class="{ active: activeTab === tab }"
        @click="activeTab = tab as any"
      >
        {{ tab === 'connect' ? '连接' : tab === 'control' ? '控制' : '日志' }}
      </button>
    </div>

    <div class="tab-content">
      <!-- Connect Tab -->
      <div v-show="activeTab === 'connect'" class="tab-pane">
        <div class="card">
          <h3>串口设置</h3>
          <div class="field">
            <label>波特率</label>
            <select v-model="baudRate">
              <option v-for="br in [9600, 115200, 19200, 57600]" :key="br" :value="br">{{ br }}</option>
            </select>
          </div>
          <div class="status-box" :class="{ connected: deviceStore.isConnected }">
            状态: {{ deviceStore.isConnected ? '已连接' : '未连接' }}
          </div>
          <button 
            class="action-btn big"
            :class="deviceStore.isConnected ? 'danger' : 'primary'"
            @click="toggleConnection"
          >
            {{ deviceStore.isConnected ? '断开连接' : '一键连接' }}
          </button>
        </div>
      </div>

      <!-- Control Tab -->
      <div v-show="activeTab === 'control'" class="tab-pane">
        <div class="card">
          <div class="field-row">
            <div class="field">
              <label>从站ID</label>
              <input type="number" v-model="slaveAddress" />
            </div>
            <div class="field grow">
              <label>功能码</label>
              <select v-model="functionCode">
                 <option v-for="opt in functionCodeOptions" :key="opt.value" :value="opt.value">
                   {{ opt.label }}
                 </option>
              </select>
            </div>
          </div>
          
          <div class="field">
            <label>起始地址</label>
            <div class="input-group">
              <input type="number" v-model="startAddress" />
              <span class="suffix">0x{{ startAddress.toString(16).toUpperCase() }}</span>
            </div>
          </div>

          <div class="field" v-if="[3,4].includes(functionCode)">
            <label>读取数量</label>
            <input type="number" v-model="quantity" />
          </div>

          <div class="field" v-if="functionCode === 6">
             <label>写入值</label>
             <input type="number" v-model="writeValue" />
          </div>

          <button 
            class="action-btn primary"
            :disabled="!deviceStore.isConnected" 
            @click="sendCommand"
          >
            发送命令
          </button>
        </div>
      </div>

      <!-- Log Tab -->
      <div v-show="activeTab === 'log'" class="tab-pane log-pane">
        <div class="log-list">
          <div v-for="log in deviceStore.logs" :key="log.id" class="log-item" :class="log.direction">
            <div class="log-info">
              <span class="time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
              <span class="tag">{{ log.direction.toUpperCase() }}</span>
            </div>
            <div class="log-data">{{ log.hex }}</div>
          </div>
          <div v-if="deviceStore.logs.length === 0" class="empty">无日志</div>
        </div>
        <button class="clear-btn" @click="deviceStore.clearLogs">清空日志</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-modbus {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}

.segment-control {
  padding: 10px;
  display: flex;
  gap: 8px;
  background: var(--color-surface);
}

.segment-control button {
  flex: 1;
  padding: 8px;
  border: none;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border-radius: 6px;
  font-weight: 500;
}

.segment-control button.active {
  background: var(--color-primary);
  color: white;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.card {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.grow { flex: 1; }

.field-row {
  display: flex;
  gap: 12px;
}

.field label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

input, select {
  padding: 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 1rem;
}

.action-btn {
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  color: white;
}

.action-btn.big { font-size: 1.1rem; padding: 14px; }
.primary { background: var(--color-primary); }
.danger { background: var(--color-error); }
.action-btn:disabled { opacity: 0.5; }

.status-box {
  text-align: center;
  padding: 10px;
  background: rgba(255,255,255,0.05);
  border-radius: 8px;
  font-weight: 500;
}
.status-box.connected { color: #38ef7d; background: rgba(56, 239, 125, 0.1); }

/* Logs */
.log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 60px;
}

.log-item {
  background: var(--color-surface);
  padding: 10px;
  border-radius: 8px;
  border-left: 4px solid transparent;
}
.log-item.tx { border-left-color: #667eea; }
.log-item.rx { border-left-color: #38ef7d; }

.log-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.log-data {
  font-family: monospace;
  word-break: break-all;
  font-size: 0.9rem;
}

.clear-btn {
  position: fixed;
  bottom: 80px;
  right: 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 8px 16px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  color: var(--color-text);
}
</style>
