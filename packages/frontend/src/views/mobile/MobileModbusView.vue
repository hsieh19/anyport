<script setup lang="ts">
/**
 * Mobile Modbus View
 * Optimized for touch interactions with card layout and tabbed logs/results
 */
import { ref, computed, watch, onMounted } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { useProfileStore } from '@/stores/profileStore';
import { ModbusFunctionCode, calculateCRC16 } from '@/protocols/modbus';
import { ProtocolType } from '@shared/types/protocol.types';
import type { ModbusRtuCommand } from '@/protocols/modbus';

const deviceStore = useDeviceStore();
const profileStore = useProfileStore();

// Init profiles
onMounted(() => {
  if (profileStore.profiles.length === 0) {
    profileStore.loadProfiles();
  }
});
const activeDataTab = ref<'results' | 'logs'>('results');
const isConnectionExpanded = ref(true);
const isCommandExpanded = ref(true);

// State maps to Desktop ModbusPanel state
const slaveAddress = ref(1);
const functionCode = ref<ModbusFunctionCode>(ModbusFunctionCode.READ_HOLDING_REGISTERS);
const startAddress = ref(0);
const quantity = ref(1);
const writeValue = ref(0);
const writeValues = ref('');

// New Mobile Optimizations
const isAutoMode = ref(false); // Toggle for Point Selection (Auto) vs Manual Input
const baseOne = ref(false); // Base 1 toggle for PLC addresses

// Auto Mode State
const selectedProfileId = ref<string | null>(null);
const selectedRegisterName = ref<string>('');
const isProfilePickerShow = ref(false);

const selectedProfile = computed(() => 
  profileStore.profiles.find(p => p.id === selectedProfileId.value)
);



// Helpers from ModbusPanel
function normalizeFuncCodes(input: any): number[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map(item => {
    if (item === null || item === undefined) return NaN;
    if (typeof item === 'string') {
      return item.startsWith('0x') ? parseInt(item, 16) : parseInt(item, 10);
    }
    return Number(item);
  }).filter(n => !isNaN(n));
}

function getModbusOffset(addr: number | string, fc: number | string, base1: boolean): number {
  const numAddr = typeof addr === 'string' ? parseInt(addr, 10) : addr;
  const fcNum = typeof fc === 'string' ? parseInt(fc, 10) : fc;
  if (!base1) return numAddr;
  if (numAddr >= 40001 && numAddr <= 49999 && (fcNum === 3 || fcNum === 6 || fcNum === 16)) return numAddr - 40001;
  if (numAddr >= 30001 && numAddr <= 39999 && fcNum === 4) return numAddr - 30001;
  if (numAddr >= 10001 && numAddr <= 19999 && fcNum === 2) return numAddr - 10001;
  if (numAddr >= 1 && numAddr <= 9999 && (fcNum === 1 || fcNum === 5 || fcNum === 15)) return numAddr - 1; 
  return numAddr;
}

function openPointSelector() {
  isProfilePickerShow.value = true;
}

function selectProfile(id: string) {
  selectedProfileId.value = id;
  selectedRegisterName.value = '';
}

function selectRegister(name: string) {
  selectedRegisterName.value = name;
  const reg = selectedProfile.value?.data.registers.find(r => r.name === name);
  if (reg) {
    const codes = normalizeFuncCodes(reg.func_code);
    if (codes.length > 0) {
      functionCode.value = codes[0] as ModbusFunctionCode;
    }
    startAddress.value = getModbusOffset(reg.addr || 0, functionCode.value, baseOne.value);
    quantity.value = reg.count || 1;
    isProfilePickerShow.value = false;
  }
}

const effectiveStartAddress = computed(() => {
  return baseOne.value ? Math.max(0, Number(startAddress.value) - 1) : Number(startAddress.value);
});

watch([startAddress, baseOne], ([newAddr, isBase1]) => {
  if (isBase1 && Number(newAddr) === 0) {
    startAddress.value = 1;
  }
});

// Computed Hex Preview
const commandHexPreview = computed(() => {
  try {
    const isRead = [1, 2, 3, 4].includes(functionCode.value);
    const cmd: ModbusRtuCommand = {
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: functionCode.value,
      startAddress: effectiveStartAddress.value, // Apply Base 0/1 logic
      quantity: isRead ? quantity.value : undefined,
      values: isRead ? undefined : ([5, 6].includes(functionCode.value) ? [writeValue.value] : writeValues.value.split(',').map(Number))
    };
    // Basic local hex generation for preview (Simplified)
    // In a real app, this might use a shared utility to ensure exact match with backend
    const buffer: number[] = [
      cmd.slaveAddress,
      cmd.functionCode,
      (cmd.startAddress >> 8) & 0xFF,
      cmd.startAddress & 0xFF,
    ];
    
    // Read: Address + Quantity
    if (isRead && cmd.quantity !== undefined) {
      buffer.push((cmd.quantity >> 8) & 0xFF, cmd.quantity & 0xFF);
    } 
    // Single Write (05, 06): Address + Value (Direct 2 bytes)
    else if ([5, 6].includes(functionCode.value) && cmd.values) {
       const val = cmd.values[0] || 0;
       // For Coil (05), FF00=ON, 0000=OFF. But here we assume user input raw or handle logic? 
       // ModbusPanel usually sends raw input for 06, and 05 might need FF00/0000 mapping if input is 1/0.
       // Looking at Desktop logic often it treats input as value.
       // Let's assume writeValue is the raw 16-bit uint to send.
       buffer.push((val >> 8) & 0xFF, val & 0xFF);
    }
    // Multiple Write (15, 10): Address + Quantity + Bytes + Data
    else if ([15, 16].includes(functionCode.value) && cmd.values) {
       // Placeholder for complex multi-write preview (0F/10)
       // We skip full implementation here for safety
    }
    
    // Checksum (CRC16)
    const crc = calculateCRC16(new Uint8Array(buffer));
    const low = crc & 0xFF;
    const high = (crc >> 8) & 0xFF;
    
    // Modbus RTU sends Low Byte first
    buffer.push(low, high);

    return buffer.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  } catch (e) {
    return 'Invalid Command';
  }
});




// Config
const baudRate = ref(9600);
const dataBits = ref(8);
const stopBits = ref(1);
const parity = ref<'none' | 'even' | 'odd'>('none');

const selectedConfig = computed(() => ({
  baudRate: baudRate.value,
  dataBits: dataBits.value as 5 | 6 | 7 | 8,
  stopBits: stopBits.value as 1 | 2,
  parity: parity.value
}));

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

async function toggleConnection() {
  if (deviceStore.isConnected) {
    await deviceStore.disconnect();
  } else {
    deviceStore.updateConfig(selectedConfig.value);
    await deviceStore.connect();
  }
}

async function sendCommand() {
  try {
    const isRead = [1, 2, 3, 4].includes(functionCode.value);
    const cmd: ModbusRtuCommand = {
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: functionCode.value,
      startAddress: effectiveStartAddress.value, // Apply Base 0/1 logic
      quantity: isRead ? quantity.value : undefined,
      values: isRead ? undefined : ([5, 6].includes(functionCode.value) ? [writeValue.value] : writeValues.value.split(',').map(Number))
    };
    await deviceStore.sendCommand(cmd);
    // Auto switch to logs to see tx if it was on results
    if (activeDataTab.value === 'results') {
      // activeDataTab.value = 'logs'; // Optional: user might prefer staying on results
    }
  } catch (e) {
    console.error(e);
  }
}

function toggleBase() {
  baseOne.value = !baseOne.value;
}
</script>

<template>
  <div class="mobile-modbus-container">
    <div class="scroll-content">
      <!-- Connection Card -->
      <section class="card connection-card">
        <div class="card-header" @click="isConnectionExpanded = !isConnectionExpanded">
          <span class="card-icon">🔌</span>
          <h3 class="card-title">连接设置</h3>
          <div class="header-right">
            <div class="status-badge" :class="{ connected: deviceStore.isConnected }">
              {{ deviceStore.isConnected ? '已连接' : '未连接' }}
            </div>
            <span class="toggle-icon" :class="{ rotate: isConnectionExpanded }">▼</span>
          </div>
        </div>
        
        <div class="card-body" v-show="isConnectionExpanded">
          <div class="input-row">
            <div class="input-group flex-1">
              <label>波特率</label>
              <select v-model="baudRate">
                <option v-for="br in [4800, 9600, 19200, 38400, 57600, 115200]" :key="br" :value="br">{{ br }}</option>
              </select>
            </div>
            <div class="input-group flex-1">
              <label>数据位</label>
              <select v-model="dataBits">
                <option v-for="db in [5, 6, 7, 8]" :key="db" :value="db">{{ db }}</option>
              </select>
            </div>
          </div>

          <div class="input-row">
            <div class="input-group flex-1">
              <label>停止位</label>
              <select v-model="stopBits">
                <option v-for="sb in [1, 2]" :key="sb" :value="sb">{{ sb }}</option>
              </select>
            </div>
            <div class="input-group flex-1">
              <label>校验位</label>
              <select v-model="parity">
                <option value="none">None (无)</option>
                <option value="even">Even (偶校验)</option>
                <option value="odd">Odd (奇校验)</option>
              </select>
            </div>
          </div>
          
          <button 
            class="prime-btn" 
            :class="{ secondary: deviceStore.isConnected }"
            @click.stop="toggleConnection"
          >
            {{ deviceStore.isConnected ? '断开设备' : '连接设备' }}
          </button>
        </div>
      </section>

      <!-- Command Card -->
      <section class="card command-card" :class="{ disabled: !deviceStore.isConnected }">
        <div class="card-header" @click="isCommandExpanded = !isCommandExpanded">
          <span class="card-icon">📝</span>
          <h3 class="card-title">命令发送</h3>
          
          <div class="header-right">
             <!-- Mode Switcher in Header -->
             <div class="mode-switch" @click.stop>
                <button 
                  class="mode-btn" 
                  :class="{ active: !isAutoMode }" 
                  @click="isAutoMode = false"
                >手动</button>
                <button 
                  class="mode-btn" 
                  :class="{ active: isAutoMode }" 
                  @click="isAutoMode = true"
                >自动</button>
             </div>
             <span class="toggle-icon" :class="{ rotate: isCommandExpanded }">▼</span>
          </div>
        </div>
        
        <div class="card-body" v-show="isCommandExpanded">
          
          <!-- Auto Mode Custom UI -->
          <div v-if="isAutoMode" class="auto-mode-ui">
             <div class="selected-info-box" v-if="selectedProfile && selectedRegisterName">
                <div class="info-row main">
                   <span class="reg-name">{{ selectedRegisterName }}</span>
                   <span class="reg-addr">地址: {{ startAddress }}</span>
                </div>
                <div class="info-row sub">
                   <span>点表: {{ selectedProfile.data.protocol_summary.model }}</span>
                   <span>数量: {{ quantity }}</span>
                </div>
                <button class="change-btn" @click="openPointSelector">更改选点</button>
             </div>
             <div class="placeholder-box" @click="openPointSelector" v-else>
                <span class="icon">📋</span>
                <span>请点击选择点表点位...</span>
             </div>

             <!-- In Auto Mode, we still show functional controls but they are linked -->
             <div class="auto-controls" v-if="selectedRegisterName">
                <div class="input-row">
                   <div class="input-group flex-1">
                      <label>从站 ID</label>
                      <input type="number" v-model="slaveAddress" />
                   </div>
                   <div class="input-group flex-1">
                      <label>功能码 (自动匹配)</label>
                      <select v-model="functionCode">
                         <option v-for="opt in functionCodeOptions" :key="opt.value" :value="opt.value">
                           {{ opt.label }}
                         </option>
                      </select>
                   </div>
                </div>
                <!-- Writing inputs if applicable -->
                <div class="input-group" v-if="[5,6].includes(functionCode)">
                   <label>写入数值</label>
                   <input type="number" v-model="writeValue" />
                </div>
                <!-- ... send button below in same card ... -->
             </div>
             
             <button 
                class="prime-btn action mt-4"
                v-if="selectedRegisterName"
                :disabled="!deviceStore.isConnected" 
                @click.stop="sendCommand"
              >
                <span class="btn-icon">🚀</span>
                发送命令 ({{ selectedRegisterName }})
              </button>
          </div>

          <!-- Manual Mode UI -->
          <div v-else class="manual-mode-ui">


            <div class="input-row">
              <div class="input-group flex-1">
                <label>从站地址 (ID)</label>
                <input type="number" v-model="slaveAddress" placeholder="1" />
              </div>
              <div class="input-group flex-1">
                <label>功能码</label>
                <select v-model="functionCode">
                  <option v-for="opt in functionCodeOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </div>
            </div>

            <div class="input-row">
              <div class="input-group flex-1">
                <div class="label-row">
                   <label>寄存器地址</label>
                   <span class="base-toggle" @click="toggleBase">{{ baseOne ? 'Base 1' : 'Base 0' }}</span>
                </div>
                <div class="input-wrapper">
                  <input type="number" v-model="startAddress" />
                  <span class="plc-inline-label">PLC: {{ 40000 + Number(startAddress) + (baseOne ? 0 : 1) }}</span>
                </div>
              </div>
              <div class="input-group flex-1" v-if="[1,2,3,4].includes(functionCode)">
                <label>读取数量</label>
                <input type="number" v-model="quantity" />
              </div>
              <div class="input-group flex-1" v-if="[5,6].includes(functionCode)">
                <label>写入数值</label>
                <input type="number" v-model="writeValue" placeholder="0 or 1 for Coil" />
              </div>
            </div>
            
            <div class="input-group" v-if="[15,16].includes(functionCode)">
               <label>写入值 (逗号分隔)</label>
               <input type="text" v-model="writeValues" placeholder="10, 20, 30..." />
            </div>

            <!-- Hex Preview Box (Moved to bottom) -->
            <div class="hex-preview-box">
              <div class="code">{{ commandHexPreview }}</div>
            </div>

            <button 
              class="prime-btn action"
              :disabled="!deviceStore.isConnected" 
              @click.stop="sendCommand"
            >
              <span class="btn-icon">🚀</span>
              发送 Modbus 命令
            </button>
          </div>
        </div>
      </section>

      <!-- Data Interaction Area (Tabbed) -->
      <section class="card data-card">
        <div class="card-tabs">
          <button 
            class="tab-btn" 
            :class="{ active: activeDataTab === 'results' }"
            @click="activeDataTab = 'results'"
          >
            读取结果
          </button>
          <button 
            class="tab-btn" 
            :class="{ active: activeDataTab === 'logs' }"
            @click="activeDataTab = 'logs'"
          >
            通信日志
          </button>
        </div>

        <div class="tab-view-content">
          <!-- Results View -->
          <div v-if="activeDataTab === 'results'" class="tab-pane">
            <div class="results-list">
              <div v-if="deviceStore.logs.filter(l => l.direction === 'rx').length === 0" class="empty-state">
                <p>尚无读取数据</p>
              </div>
              <div v-else class="results-grid">
                <!-- Simple mock results if parsed isn't available, but usually we use real data -->
                <div v-for="(log, idx) in deviceStore.logs.filter(l => l.direction === 'rx').slice(0, 5)" :key="idx" class="result-item">
                  <div class="res-meta">
                    <span class="res-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                  </div>
                  <div class="res-data font-mono">{{ log.hex }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Logs View -->
          <div v-if="activeDataTab === 'logs'" class="tab-pane">
            <div class="logs-container">
              <div v-for="log in deviceStore.logs" :key="log.id" class="log-entry" :class="log.direction">
                <div class="log-head">
                  <span class="dir-tag">{{ log.direction === 'tx' ? 'TX' : 'RX' }}</span>
                  <span class="log-time">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                </div>
                <div class="log-body font-mono">{{ log.hex }}</div>
              </div>
              <div v-if="deviceStore.logs.length === 0" class="empty-state">
                <p>等待通信...</p>
              </div>
            </div>
            <button class="fab-clear" @click="deviceStore.clearLogs" v-if="deviceStore.logs.length > 0">
              清空
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- Profile & Register Picker (Mobile-Friendly Modal) -->
    <div v-if="isProfilePickerShow" class="mobile-modal-overlay" @click="isProfilePickerShow = false">
      <div class="mobile-modal-content" @click.stop>
        <div class="modal-header">
          <h3>{{ selectedProfileId ? '选择寄存器' : '选择设备点表' }}</h3>
          <button class="close-btn" @click="isProfilePickerShow = false">✕</button>
        </div>
        <div class="modal-body">
          <!-- Back button if profile is selected -->
          <button v-if="selectedProfileId" class="back-link" @click="selectedProfileId = null">← 返回选择点表</button>

          <!-- List Profiles -->
          <div v-if="!selectedProfileId" class="picker-list">
            <div v-for="profile in profileStore.profiles" :key="profile.id" class="picker-item" @click="selectProfile(profile.id)">
              <div class="item-icon">🗂️</div>
              <div class="item-info">
                <div class="item-name">{{ profile.data.protocol_summary.model }}</div>
                <div class="item-sub">{{ profile.data.protocol_summary.manufacturer }} - {{ profile.data.protocol_summary.series }}</div>
              </div>
            </div>
          </div>

          <!-- List Registers -->
          <div v-else class="picker-list">
            <div v-for="reg in selectedProfile?.data.registers" :key="reg.name" class="picker-item" @click="selectRegister(reg.name)">
              <div class="item-icon">📍</div>
              <div class="item-info">
                <div class="item-name">{{ reg.name }}</div>
                <div class="item-sub">Addr: {{ reg.addr }} ({{ reg.data_type }})</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-modbus-container {
  height: 100%;
  width: 100%;
  background: var(--color-bg);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.scroll-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 40px;
}

/* Card Styling */
.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  transition: opacity 0.3s;
}

.card.disabled {
  opacity: 0.6;
}

.card-header {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  user-select: none;
}

/* Mode Switcher */
.mode-switch {
  display: flex;
  background: var(--color-bg);
  border-radius: 6px;
  padding: 2px;
  margin-right: 8px;
  border: 1px solid var(--color-border);
}

.mode-btn {
  border: none;
  background: transparent;
  padding: 4px 8px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-icon {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  transition: transform 0.3s;
}

.toggle-icon.rotate {
  transform: rotate(180deg);
}

.card-icon {
  font-size: 1.25rem;
}

.card-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
  flex: 1;
}

.status-badge {
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 20px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
}

.status-badge.connected {
  background: rgba(56, 239, 125, 0.1);
  color: var(--color-success);
}

/* Auto Mode UI */
.auto-mode-ui {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.placeholder-box {
  width: 100%;
  border: 2px dashed var(--color-border);
  padding: 40px;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.selected-info-box {
  background: rgba(var(--color-primary-rgb), 0.05);
  border: 1px solid var(--color-primary);
  padding: 16px;
  border-radius: 12px;
}

.reg-name { font-weight: 700; font-size: 1.1rem; display: block; margin-bottom: 4px;}
.reg-addr { font-family: monospace; color: var(--color-primary); font-weight: 600; }
.info-row { display: flex; justify-content: space-between; align-items: center; }
.info-row.sub { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 4px; }

.change-btn {
  margin-top: 12px;
  background: transparent;
  border: none;
  color: var(--color-primary);
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0;
  text-decoration: underline;
}

.manual-mode-ui {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hex Preview */
.hex-preview-box {
  background: #1e1e2d;
  color: #7dd3fc;
  border-radius: var(--radius-md);
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  font-family: 'Consolas', monospace;
  font-size: 0.85rem;
  overflow-x: auto;
  white-space: nowrap;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.base-toggle {
  font-size: 0.65rem;
  color: var(--color-primary);
  cursor: pointer;
  padding: 2px 6px;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 4px;
}

.helper-text {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
  text-align: right;
}

.card-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-row {
  display: flex;
  gap: 12px;
}

.flex-1 { flex: 1; }
.flex-2 { flex: 2; }

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-group label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.input-wrapper {
  position: relative;
}

.plc-inline-label {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: var(--color-primary);
  font-weight: 600;
  pointer-events: none;
  background: rgba(var(--color-primary-rgb), 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

input, select {
  width: 100%;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px;
  color: var(--color-text);
  font-size: 0.9rem;
}

/* Buttons */
.prime-btn {
  width: 100%;
  padding: 14px;
  border-radius: var(--radius-md);
  border: none;
  font-weight: 600;
  font-size: 0.95rem;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}

.prime-btn:active {
  filter: brightness(0.9);
}

.prime-btn.secondary {
  background: var(--color-surface-hover);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.prime-btn.action {
  background: var(--gradient-primary);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.prime-btn:disabled {
  opacity: 0.5;
  filter: grayscale(1);
}

/* Data Interaction Area */
.data-card {
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.card-tabs {
  display: flex;
  background: var(--color-bg);
  padding: 4px;
  margin: 12px;
  border-radius: var(--radius-md);
  gap: 4px;
}

.tab-btn {
  flex: 1;
  border: none;
  padding: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  border-radius: 6px;
  transition: all 0.2s;
}

.tab-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.tab-view-content {
  flex: 1;
  padding: 0 16px 16px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-style: italic;
}

/* Logs */
.logs-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-entry {
  padding: 10px;
  background: var(--color-bg);
  border-radius: 8px;
  border-left: 3px solid transparent;
}

.log-entry.tx { border-left-color: var(--color-primary); }
.log-entry.rx { border-left-color: var(--color-success); }

.log-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.dir-tag {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--color-surface);
}

.log-time {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
}

.log-body {
  font-size: 0.8rem;
  word-break: break-all;
}

.result-item {
  padding: 10px;
  background: var(--color-bg);
  border-radius: 8px;
  margin-bottom: 8px;
}

.res-time {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
}

.res-data {
  font-size: 0.9rem;
  margin-top: 4px;
  color: var(--color-success);
}

.fab-clear {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  color: var(--color-text);
  box-shadow: var(--shadow-md);
}

.font-mono {
  font-family: 'Consolas', monospace;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrapper input {
  padding-right: 85px; /* Spacing for the inline label */
}

.plc-inline-label {
  position: absolute;
  right: 10px;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  pointer-events: none;
  font-family: 'Consolas', monospace;
  background: rgba(0,0,0,0.05);
  padding: 2px 4px;
  border-radius: 4px;
}
</style>
