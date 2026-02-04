<script setup lang="ts">
/**
 * Modbus RTU 调试面板
 */
import { ref, computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ModbusFunctionCode } from '@/protocols/modbus';
import type { ModbusRtuCommand } from '@/protocols/modbus';
import { ProtocolType } from '@shared/types/protocol.types';

const deviceStore = useDeviceStore();
const isSecure = window.isSecureContext;

// 表单状态
const slaveAddress = ref(1);
const functionCode = ref<ModbusFunctionCode>(ModbusFunctionCode.READ_HOLDING_REGISTERS);
const startAddress = ref(0);
const quantity = ref(10);
const writeValue = ref(0);
const writeValues = ref('');

// 连接配置
const baudRate = ref(9600);
const dataBits = ref(8);
const stopBits = ref(1);
const parity = ref<'none' | 'even' | 'odd'>('none');

// 功能码选项
const functionCodeOptions = [
  { value: ModbusFunctionCode.READ_COILS, label: '01 - 读线圈' },
  { value: ModbusFunctionCode.READ_DISCRETE_INPUTS, label: '02 - 读离散输入' },
  { value: ModbusFunctionCode.READ_HOLDING_REGISTERS, label: '03 - 读保持寄存器' },
  { value: ModbusFunctionCode.READ_INPUT_REGISTERS, label: '04 - 读输入寄存器' },
  { value: ModbusFunctionCode.WRITE_SINGLE_COIL, label: '05 - 写单个线圈' },
  { value: ModbusFunctionCode.WRITE_SINGLE_REGISTER, label: '06 - 写单个寄存器' },
  { value: ModbusFunctionCode.WRITE_MULTIPLE_COILS, label: '0F - 写多个线圈' },
  { value: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, label: '10 - 写多个寄存器' },
];

// 波特率选项
const baudRateOptions = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

// 是否为读操作
const isReadOperation = computed(() => {
  return [
    ModbusFunctionCode.READ_COILS,
    ModbusFunctionCode.READ_DISCRETE_INPUTS,
    ModbusFunctionCode.READ_HOLDING_REGISTERS,
    ModbusFunctionCode.READ_INPUT_REGISTERS
  ].includes(functionCode.value);
});

// 是否为单值写操作
const isSingleWrite = computed(() => {
  return [
    ModbusFunctionCode.WRITE_SINGLE_COIL,
    ModbusFunctionCode.WRITE_SINGLE_REGISTER
  ].includes(functionCode.value);
});

// 连接/断开
async function toggleConnection() {
  if (deviceStore.isConnected) {
    await deviceStore.disconnect();
  } else {
    deviceStore.updateConfig({
      baudRate: baudRate.value,
      dataBits: dataBits.value as 5 | 6 | 7 | 8,
      stopBits: stopBits.value as 1 | 2,
      parity: parity.value
    });
    await deviceStore.connect();
  }
}

// 发送命令
async function sendCommand() {
  const command: ModbusRtuCommand = {
    protocol: ProtocolType.MODBUS_RTU,
    slaveAddress: slaveAddress.value,
    functionCode: functionCode.value,
    startAddress: startAddress.value,
    quantity: isReadOperation.value ? quantity.value : undefined,
    values: getWriteValues()
  };

  try {
    await deviceStore.sendCommand(command);
  } catch (error) {
    console.error('发送失败:', error);
  }
}

// 解析写入值
function getWriteValues(): number[] | undefined {
  if (isReadOperation.value) return undefined;

  if (isSingleWrite.value) {
    return [writeValue.value];
  }

  // 多值写入：解析逗号分隔的值
  return writeValues.value
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));
}

// 格式化时间
function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });
}
</script>

<template>
  <div class="modbus-panel">
    <!-- 顶部连接配置区 -->
    <section class="panel-section header-section">
      <div class="header-row">
        <h2 class="section-title">
          <span class="icon">🔌</span>
          连接配置
        </h2>
        
        <div class="config-bar">
          <div class="config-group">
            <select v-model="baudRate" :disabled="deviceStore.isConnected">
              <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                {{ rate }} bps
              </option>
            </select>
            
            <select v-model="dataBits" :disabled="deviceStore.isConnected">
              <option :value="7">7 数据位</option>
              <option :value="8">8 数据位</option>
            </select>
            
            <select v-model="stopBits" :disabled="deviceStore.isConnected">
              <option :value="1">1 停止位</option>
              <option :value="2">2 停止位</option>
            </select>
            
            <select v-model="parity" :disabled="deviceStore.isConnected">
              <option value="none">无校验</option>
              <option value="even">偶校验</option>
              <option value="odd">奇校验</option>
            </select>
          </div>

          <button 
            class="btn-connect"
            :class="{ connected: deviceStore.isConnected, connecting: deviceStore.isConnecting }"
            :disabled="deviceStore.isConnecting || !deviceStore.isSupported"
            @click="toggleConnection"
          >
            <span v-if="deviceStore.isConnecting" class="spinner"></span>
            {{ deviceStore.isConnected ? '断开' : '连接' }}
          </button>
        </div>
      </div>
      
      <div v-if="!isSecure" class="error-banner">
        ❌ 检测到非安全上下文。Web Serial API 需要 <strong>HTTPS</strong> 或 <strong>localhost</strong>。不允许使用 IP 地址访问。
      </div>
      <div v-else-if="!deviceStore.isSupported" class="warning-banner">
        ⚠️ 当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+
      </div>
      <div v-if="deviceStore.lastError" class="error-banner">
        ❌ {{ deviceStore.lastError }}
      </div>
    </section>

    <!-- 主体左右分栏 -->
    <div class="panel-body">
      <!-- 左侧：Modbus 命令 -->
      <section class="panel-section command-section">
        <h2 class="section-title">
          <span class="icon">📡</span>
          Modbus RTU 命令
        </h2>
        
        <div class="command-form">
          <div class="form-group">
            <label>从站地址</label>
            <input type="number" v-model="slaveAddress" min="1" max="247" />
          </div>
          
          <div class="form-group">
            <label>功能码</label>
            <select v-model="functionCode">
              <option v-for="opt in functionCodeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          
          <div class="grid-2">
            <div class="form-group">
              <label>起始地址 (Hex)</label>
              <div class="hex-input-group">
                <span class="prefix">0x</span>
                <input 
                  type="text" 
                  :value="startAddress.toString(16).toUpperCase()"
                  @input="e => startAddress = parseInt((e.target as HTMLInputElement).value, 16) || 0"
                />
              </div>
            </div>
            
            <div class="form-group">
              <label>起始地址 (Dec)</label>
              <input type="number" v-model="startAddress" min="0" max="65535" />
            </div>
          </div>
          
          <div v-if="isReadOperation" class="form-group">
            <label>数量</label>
            <input type="number" v-model="quantity" min="1" max="125" />
          </div>
          
          <div v-if="isSingleWrite" class="form-group">
            <label>写入值</label>
            <input type="number" v-model="writeValue" min="0" max="65535" />
          </div>
          
          <div v-if="!isReadOperation && !isSingleWrite" class="form-group">
            <label>写入值 (逗号分隔)</label>
            <textarea v-model="writeValues" placeholder="例如: 100, 200, 300" rows="3"></textarea>
          </div>
          
          <div class="form-actions">
            <button 
              class="btn-send"
              :disabled="!deviceStore.isConnected"
              @click="sendCommand"
            >
              发送命令
            </button>
          </div>
        </div>
      </section>
  
      <!-- 右侧：通信日志 -->
      <section class="panel-section log-section">
        <div class="section-header">
          <h2 class="section-title">
            <span class="icon">📋</span>
            通信日志
          </h2>
          <button class="btn-clear" @click="deviceStore.clearLogs">清空</button>
        </div>
        
        <div class="log-container">
          <div 
            v-for="log in deviceStore.logs" 
            :key="log.id" 
            class="log-entry"
            :class="log.direction"
          >
            <div class="log-meta">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-tag">{{ log.direction === 'tx' ? 'TX' : 'RX' }}</span>
            </div>
            <div class="log-content">
              <div class="log-hex">{{ log.hex }}</div>
              <div v-if="log.parsed?.registers" class="log-parsed">
                Reg: [{{ log.parsed.registers.join(', ') }}]
              </div>
              <div v-if="log.parsed?.coils" class="log-parsed">
                Coil: [{{ log.parsed.coils.map(c => c ? '1' : '0').join('') }}]
              </div>
              <div v-if="log.parsed?.error" class="log-error">
                Err: {{ log.parsed.error }}
              </div>
            </div>
          </div>
          
          <div v-if="deviceStore.logs.length === 0" class="log-empty">
            暂无通信记录
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modbus-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

.panel-section {
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  padding: 1rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
  white-space: nowrap;
}

/* 顶部 Header */
.header-section {
  flex-shrink: 0;
}

.header-row {
  display: flex;
  align-items: center;
  gap: 2rem;
  flex-wrap: wrap;
}

.config-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.config-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.config-group select {
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  min-width: 100px;
}

.btn-connect {
  margin-left: auto;
  padding: 0.4rem 1.2rem;
  border-radius: 6px;
  border: none;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-connect.connected {
  background: var(--color-surface-hover);
  border: 1px solid var(--color-error);
  color: var(--color-error);
}

/* 主体分栏 */
.panel-body {
  display: flex;
  gap: 1rem;
  flex: 1;
  min-height: 0; /* Important for flex child scrolling */
}

.command-section {
  flex: 0 0 350px; /* 固定宽度 */
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.log-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0; /* Prevent overflow */
}

/* 命令表单 */
.command-form {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}

.hex-input-group {
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 0.5rem;
}

.hex-input-group .prefix {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.hex-input-group input {
  border: none;
  background: transparent;
  padding: 0.5rem;
  width: 100%;
}

.hex-input-group input:focus {
  outline: none;
  box-shadow: none;
}

.btn-send {
  width: 100%;
  padding: 0.75rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 1rem;
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 日志区域 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
  flex-shrink: 0;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg);
  border-radius: 6px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.log-entry {
  display: flex;
  gap: 0.8rem;
  padding: 0.5rem;
  border-radius: 4px;
  font-family: 'Consolas', monospace;
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.03);
}

.log-entry.tx { border-left: 3px solid #667eea; }
.log-entry.rx { border-left: 3px solid #11998e; }

.log-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 60px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.log-tag {
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
}

.log-entry.tx .log-tag { background: rgba(102, 126, 234, 0.2); color: #667eea; }
.log-entry.rx .log-tag { background: rgba(17, 153, 142, 0.2); color: #11998e; }

.log-content {
  flex: 1;
  word-break: break-all;
}

.log-parsed {
  color: var(--color-success);
  font-size: 0.85rem;
  margin-top: 0.2rem;
}

.log-error {
  color: var(--color-error);
  font-size: 0.85rem;
}

/* 消息横幅 */
.error-banner, .warning-banner {
  margin-top: 0.8rem;
  padding: 0.6rem;
  border-radius: 6px;
  font-size: 0.9rem;
}

.error-banner {
  background: rgba(245, 87, 108, 0.1);
  color: var(--color-error);
  border: 1px solid rgba(245, 87, 108, 0.2);
}

.warning-banner {
  background: rgba(245, 166, 35, 0.1);
  color: var(--color-warning);
  border: 1px solid rgba(245, 166, 35, 0.2);
}

/* 响应式 */
@media (max-width: 900px) {
  .panel-body {
    flex-direction: column;
  }
  
  .command-section {
    flex: none;
    width: 100%;
  }

  .log-section {
    flex: 1;
    min-height: 400px;
  }
  
  .header-row {
    gap: 1rem;
  }
  
  .config-bar {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
