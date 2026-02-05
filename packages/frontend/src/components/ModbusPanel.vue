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
const quantity = ref(1);
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
  // 如果是 Base 1 模式，发出的物理地址需要 -1 (工业调试工具常用逻辑)
  // 例如：用户输入起始地址 1，Base 1 模式下，实际报文发出的地址是 0
  const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;

  const command: ModbusRtuCommand = {
    protocol: ProtocolType.MODBUS_RTU,
    slaveAddress: slaveAddress.value,
    functionCode: functionCode.value,
    startAddress: physicalAddress,
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

// 地址基准设置 (Base 0 / Base 1)
const useBase1 = ref(false);

// 弹窗状态
import MessageDialog from '@/components/common/MessageDialog.vue';
const showDialog = ref(false);
const dialogMessage = ref('');
const dialogType = ref<'warning' | 'error'>('warning');

function triggerAlert(msg: string, type: 'warning' | 'error' = 'warning') {
  dialogMessage.value = msg;
  dialogType.value = type;
  showDialog.value = true;
}

// 切换基准时的校验
function setBase(val: boolean) {
  if (val === true && startAddress.value === 0) {
    triggerAlert('在 Base 1 模式下，起始地址必须从 1 开始。已为您自动调整。');
    startAddress.value = 1;
  }
  useBase1.value = val;
}

// 监听地址变化 (Base 1 模式下禁止输入 0)
import { watch } from 'vue';
watch([startAddress, useBase1], ([newAddr, isBase1]) => {
  if (isBase1 && newAddr === 0) {
    triggerAlert('在 Base 1 模式下，起始地址最小为 1。');
    startAddress.value = 1;
  }
});

// 计算 PLC 地址 (Modicon 寻址)
const plcAddress = computed(() => {
  // 物理地址逻辑：
  // Base 0 模式下：物理地址 = 输入值。PLC地址 = 物理地址 + 1 (即 输入值 + 1)
  // Base 1 模式下：物理地址 = 输入值 - 1。PLC地址 = 物理地址 + 1 (即 输入值)
  const addr = useBase1.value ? Math.max(1, startAddress.value) : startAddress.value + 1;
  
  switch (functionCode.value) {
    case ModbusFunctionCode.READ_COILS:
    case ModbusFunctionCode.WRITE_SINGLE_COIL:
    case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
      return addr.toString().padStart(5, '0'); // 0xxxx
    case ModbusFunctionCode.READ_DISCRETE_INPUTS:
      return (10000 + addr).toString(); // 1xxxx
    case ModbusFunctionCode.READ_INPUT_REGISTERS:
      return (30000 + addr).toString(); // 3xxxx
    case ModbusFunctionCode.READ_HOLDING_REGISTERS:
    case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
    case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
      return (40000 + addr).toString(); // 4xxxx
    default:
      return addr;
  }
});

// 计算完整的 RTU 报文预览
const fullRawFrame = computed(() => {
  try {
    const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;
    const command: ModbusRtuCommand = {
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: functionCode.value,
      startAddress: physicalAddress,
      quantity: isReadOperation.value ? quantity.value : undefined,
      values: getWriteValues()
    };
    
    // 使用 adapter 编码
    const frame = deviceStore.adapter.encode(command);
    return Array.from(frame)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  } catch (e) {
    return '---';
  }
});

// 计算报文解析说明
const frameInterpretation = computed(() => {
  const hexs = fullRawFrame.value.split(' ');
  return interpretFrame(hexs, isReadOperation.value);
});

// 通用的报文解析函数
function interpretFrame(hexs: string[], isRead: boolean, isRx: boolean = false) {
  if (hexs.length < 3) return [];

  const parts = [];
  parts.push({ name: '从站 ID', value: hexs[0] || '--' });
  
  const fnCode = parseInt(hexs[1] || '0', 16);
  parts.push({ name: '功能码', value: hexs[1] || '--' });
  
  // 异常响应处理 (功能码最高位为 1)
  if (isRx && fnCode > 0x80) {
    parts.push({ name: '异常状态', value: '错误响应' });
    if (hexs.length >= 3) {
      parts.push({ name: '异常代码', value: hexs[2] });
    }
  } else {
    // 正常响应或请求
    if (isRx) {
      // RX 响应解析
      if ([0x01, 0x02, 0x03, 0x04].includes(fnCode)) {
        if (hexs.length >= 3) parts.push({ name: '字节计数', value: hexs[2] });
        if (hexs.length > 5) {
          const dataLen = hexs.length - 3 - 2;
          parts.push({ name: '数据内容', value: hexs.slice(3, 3 + dataLen).join(' ') });
        }
      } else if ([0x05, 0x06, 0x0F, 0x10].includes(fnCode)) {
        // 05/06/0F/10 的响应通常是请求的镜像
        if (hexs.length >= 4) parts.push({ name: '起始地址', value: `${hexs[2]} ${hexs[3]}` });
        if (hexs.length >= 6) parts.push({ name: [0x0F, 0x10].includes(fnCode) ? '寄存器数量' : '写入值', value: `${hexs[4]} ${hexs[5]}` });
      }
    } else {
      // TX 请求解析 (复用之前的逻辑)
      if (hexs.length === 8) {
        parts.push({ name: '起始地址', value: `${hexs[2]} ${hexs[3]}` });
        parts.push({ name: isRead ? '寄存器数量' : '写入值', value: `${hexs[4]} ${hexs[5]}` });
      } else if (hexs.length > 8) {
        parts.push({ name: '起始地址', value: `${hexs[2]} ${hexs[3]}` });
        parts.push({ name: '寄存器数量', value: `${hexs[4]} ${hexs[5]}` });
        parts.push({ name: '字节计数', value: hexs[6] });
        const dataLen = hexs.length - 7 - 2;
        parts.push({ name: '数据内容', value: hexs.slice(7, 7 + dataLen).join(' ') });
      }
    }
  }

  // 最后两位 CRC
  if (hexs.length >= 2) {
    const crc = hexs.slice(-2);
    parts.push({ name: 'CRC 校验', value: `${crc[0]} ${crc[1]}` });
  }
  
  return parts;
}

// 辅助：判断是否是读取操作 (针对日志解析)
function isReadTx(hex: string): boolean {
  const parts = hex.split(' ');
  if (parts.length < 2) return true;
  const fn = parseInt(parts[1] || '0', 16);
  return [0x01, 0x02, 0x03, 0x04].includes(fn);
}

// 格式化时间
function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// 结果显示格式
const displayFormat = ref<'dec' | 'hex' | 'bin'>('dec');

// 辅助：二进制格式化（每4位加空格）
function formatBin(val: number): string {
  const bin = val.toString(2).padStart(16, '0');
  return bin.match(/.{1,4}/g)?.join(' ') ?? bin;
}

// 计算属性：提取最近一次成功读取的寄存器结果
const latestReadResults = computed(() => {
  // 查找最近一条包含寄存器数据且不是错误的 RX 日志
  const lastRxIndex = deviceStore.logs.findIndex(log => 
    log.direction === 'rx' && 
    log.parsed && 
    !log.parsed.error &&
    (log.parsed.registers || log.parsed.coils)
  );

  if (lastRxIndex === -1) return [];
  const lastReadLog = deviceStore.logs[lastRxIndex];
  if (!lastReadLog || !lastReadLog.parsed) return [];

  // 获取请求时的起始地址：从该 RX 之后的最近一条 TX 中解析
  let physicalStartAddr = 0;
  for (let i = lastRxIndex + 1; i < deviceStore.logs.length; i++) {
    const log = deviceStore.logs[i];
    if (log && log.direction === 'tx') {
       const hexs = log.hex.split(' ');
       if (hexs.length >= 4) {
         // Modbus RTU 请求报文的 第3,4位是地址高低字节
         physicalStartAddr = (parseInt(hexs[2] || '0', 16) << 8) | parseInt(hexs[3] || '0', 16);
       }
       break;
    }
  }

  const results: Array<{ 
    index: number; 
    address: number; 
    value: number | boolean; 
    decStr: string;
    hexStr: string;
    binStr: string;
  }> = [];
  
  // 处理保持寄存器/输入寄存器 (03, 04)
  if (lastReadLog.parsed.registers) {
    lastReadLog.parsed.registers.forEach((val: number, index: number) => {
      const currentPhysicalAddr = physicalStartAddr + index;
      const displayAddr = useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;
      
      results.push({
        index: index + 1,
        address: displayAddr,
        value: val,
        decStr: val.toString(),
        hexStr: '0x' + val.toString(16).toUpperCase().padStart(4, '0'),
        binStr: formatBin(val)
      });
    });
  }
  
  // 处理线圈 (01, 02)
  if (lastReadLog.parsed.coils) {
     lastReadLog.parsed.coils.forEach((val: boolean, index: number) => {
      const currentPhysicalAddr = physicalStartAddr + index;
      const displayAddr = useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;
      
      const strVal = val ? '1' : '0';
      results.push({
        index: index + 1,
        address: displayAddr,
        value: val ? 1 : 0,
        decStr: strVal,
        hexStr: val ? 'ON' : 'OFF',
        binStr: strVal
      });
    });
  }

  return results;
});
</script>

<template>
  <div class="modbus-panel">
    <!-- 居中弹窗组件 -->
    <MessageDialog 
      :show="showDialog" 
      :message="dialogMessage" 
      :type="dialogType"
      @close="showDialog = false"
    />
    
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

    <!-- 主体垂直排列：第二行命令，第三行日志 -->
    <div class="panel-body">
      <!-- 第二行：Modbus 命令 -->
      <section class="panel-section command-section">
        <h2 class="section-title">
          <span class="icon">📡</span>
          Modbus RTU 命令
        </h2>
        
        <div class="command-form-horizontal">
          <div class="form-row">
            <div class="form-group">
              <label>从站地址</label>
              <input type="number" v-model="slaveAddress" min="1" max="247" />
            </div>
            
            <div class="form-group grow">
              <label>功能码</label>
              <select v-model="functionCode">
                <option v-for="opt in functionCodeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <div class="label-with-switch">
                <label>起始地址 (Dec)</label>
                <div class="base-switch">
                  <button 
                    :class="{ active: !useBase1 }" 
                    @click="setBase(false)"
                    title="从 0 开始计数"
                  >Base 0</button>
                  <button 
                    :class="{ active: useBase1 }" 
                    @click="setBase(true)"
                    title="从 1 开始计数"
                  >Base 1</button>
                </div>
              </div>
              <div class="input-combined">
                <input 
                  type="number" 
                  v-model="startAddress" 
                  :min="useBase1 ? 1 : 0" 
                  max="65535" 
                  class="dec-input-large" 
                />
                <div class="plc-address-display">
                  <span class="label">PLC地址</span>
                  <span class="value">{{ plcAddress }}</span>
                </div>
              </div>
            </div>
            
            <div v-if="isReadOperation" class="form-group">
                <label>寄存器数量</label>
                <input type="number" v-model="quantity" min="1" max="125" />
            </div>
            
            <div v-if="isSingleWrite" class="form-group">
                <label>写入值</label>
                <input type="number" v-model="writeValue" min="0" max="65535" />
            </div>
            
            <div v-if="!isReadOperation && !isSingleWrite" class="form-group grow">
                <label>写入值 (逗号分隔)</label>
                <input type="text" v-model="writeValues" placeholder="例如: 100, 200, 300" />
            </div>

            <div class="form-actions-inline">
              <div class="preview-box">
                <div class="preview-label">
                  <span class="icon">🔍</span>
                  报文预览 (Hex)
                  <div class="help-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="info-svg">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <div class="tooltip">
                      <div class="tooltip-title">报文结构解析</div>
                      <div class="tooltip-content">
                        <div v-for="part in frameInterpretation" :key="part.name" class="tooltip-item">
                          <span class="p-name">{{ part.name }}:</span>
                          <span class="p-value">{{ part.value }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="preview-value">{{ fullRawFrame }}</div>
              </div>

              <button 
                class="btn-send"
                :disabled="!deviceStore.isConnected"
                @click="sendCommand"
              >
                发送命令
              </button>
            </div>
          </div>
        </div>
      </section>
  
      <!-- 第三行：双栏显示 (日志 & 结果) -->
      <div class="monitor-grid">
        <!-- 左侧：通信日志 -->
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
                <div class="log-tag-group">
                  <span class="log-tag">{{ log.direction === 'tx' ? 'TX' : 'RX' }}</span>
                  <div class="help-icon log-help">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="info-svg">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <div class="tooltip rx-log-tooltip">
                      <div class="tooltip-title">报文结构解析</div>
                      <div class="tooltip-content">
                        <div v-for="part in interpretFrame(log.hex.split(' '), isReadTx(log.hex), log.direction === 'rx')" :key="part.name" class="tooltip-item">
                          <span class="p-name">{{ part.name }}:</span>
                          <span class="p-value">{{ part.value }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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

        <!-- 右侧：寄存器结果表格 -->
        <section class="panel-section results-section">
          <div class="section-header">
            <h2 class="section-title">
              <span class="icon">📊</span>
              数据读取结果
              <div class="result-hint" v-if="latestReadResults.length">
                ({{ latestReadResults.length }} 个点)
              </div>
            </h2>
            
            <div class="header-controls">
              <div class="format-switch">
                <button 
                  :class="{ active: displayFormat === 'hex' }" 
                  @click="displayFormat = 'hex'"
                  title="十六进制"
                >HEX</button>
                <button 
                  :class="{ active: displayFormat === 'dec' }" 
                  @click="displayFormat = 'dec'"
                  title="十进制"
                >DEC</button>
                <button 
                  :class="{ active: displayFormat === 'bin' }" 
                  @click="displayFormat = 'bin'"
                  title="二进制"
                >BIN</button>
              </div>
            </div>
          </div>

          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th width="60">序号</th>
                  <th width="100">寄存器地址</th>
                  <th class="col-value-header">
                    数值 
                    <span class="format-indicator">
                      ({{ displayFormat.toUpperCase() }})
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in latestReadResults" :key="item.index">
                  <td class="col-index">{{ item.index }}</td>
                  <td class="col-addr">{{ item.address }}</td>
                  <td class="col-value centered">
                    <span v-if="displayFormat === 'dec'" class="val-dec">{{ item.decStr }}</span>
                    <span v-else-if="displayFormat === 'hex'" class="val-hex">{{ item.hexStr }}</span>
                    <span v-else-if="displayFormat === 'bin'" class="val-bin">{{ item.binStr }}</span>
                  </td>
                </tr>
                <tr v-if="latestReadResults.length === 0">
                  <td colspan="3" class="table-empty">
                    等待读取数据...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modbus-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: calc(100vh - 100px); /* 适应视口高度 */
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem;
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

/* 主体垂直排列 */
.panel-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
  min-height: 0;
}

.command-section {
  flex-shrink: 0;
}

.log-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 200px;
  min-width: 0;
}

.results-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 200px;
  min-width: 0;
}

.monitor-grid {
  display: flex;
  gap: 1rem;
  flex: 1;
  min-height: 0;
}

/* 横向命令表单 */
.command-form-horizontal {
  margin-top: 1rem;
}

.form-row {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group.grow {
  flex: 1;
  min-width: 150px;
}

.form-group label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.input-combined {
  display: flex;
  gap: 0.5rem;
}

.label-with-switch {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.base-switch {
  display: flex;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  padding: 1px;
}

.base-switch button {
  padding: 2px 8px;
  font-size: 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 3px;
}

.base-switch button.active {
  background: var(--color-primary);
  color: white;
}

.base-switch button:hover:not(.active) {
  background: var(--color-surface-hover);
}

.dec-input-large {
  width: 120px;
}

.plc-address-display {
  display: flex;
  align-items: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  font-family: 'Consolas', monospace;
}

.plc-address-display .label {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  border-right: 1px solid var(--color-border);
}

.plc-address-display .value {
  color: var(--color-primary);
  padding: 0.5rem 1rem;
  font-weight: 700;
  min-width: 80px;
  text-align: center;
}

.form-actions-inline {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  flex: 1;
  min-width: 300px;
}

.preview-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.preview-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.help-icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  position: relative;
  color: var(--color-text-secondary);
  transition: color 0.2s;
}

.help-icon:hover {
  color: var(--color-primary);
}

.info-svg {
  width: 100%;
  height: 100%;
}

.tooltip {
  position: absolute;
  top: auto;
  bottom: 150%;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: #1e1e2d;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 1rem;
  border-radius: 10px;
  box-shadow: 0 15px 40px rgba(0, 0, 0, 0.6);
  width: max-content;
  min-width: 200px;
  pointer-events: none;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 99999; /* 确保在最上层 */
}

.help-icon:hover .tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.tooltip-title {
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--color-primary);
  margin-bottom: 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  white-space: nowrap; /* 保证标题在任何宽度下都不换行 */
}

.tooltip-title::before {
  content: '📝';
  font-size: 0.9rem;
}

.tooltip-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  gap: 1rem;
  line-height: 1.8;
}

.tooltip-item .p-name {
  color: var(--color-text-secondary);
}

.tooltip-item .p-value {
  font-family: 'Consolas', monospace;
  color: #7dd3fc;
  font-weight: 700;
}

.log-hex-group {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.rx-log-tooltip {
  top: 100% !important; /* 强制向下弹出 */
  bottom: auto !important;
  left: 0 !important;
  transform: translateY(10px) !important;
  margin-top: 5px;
}

.help-icon:hover .rx-log-tooltip {
  opacity: 1 !important;
  transform: translateY(0) !important;
}

.log-help .tooltip {
  max-width: 80vw;
  min-width: 280px;
  max-height: 500px;
  overflow-y: auto;
}

.tooltip-item {
  display: flex;
  align-items: flex-start; /* 标题与内容对齐方式 */
  justify-content: space-between;
  font-size: 0.8rem;
  gap: 1rem;
  line-height: 1.8;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.tooltip-item:last-child {
  border-bottom: none;
}

.tooltip-item .p-value {
  font-family: 'Consolas', monospace;
  color: #7dd3fc;
  font-weight: 700;
  white-space: pre-wrap; /* 允许内容换行，但保持等宽对齐 */
  word-break: break-all;
  max-width: 600px;
}


.preview-value {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: 'Consolas', monospace;
  color: #7dd3fc; /* 专业的冰川蓝，降低视觉疲劳 */
  font-size: 0.9rem;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  letter-spacing: 0.5px;
}

.btn-send {
  padding: 0.7rem 2rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  height: 2.4rem;
  display: flex;
  align-items: center;
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
  gap: 0.3rem;
  min-width: 80px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.log-tag-group {
  display: flex;
  align-items: center;
  gap: 0.3rem;
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

/* 表格样式 */
.table-container {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Consolas', monospace;
  font-size: 0.9rem;
  border: 1px solid var(--color-border); /* 外边框 */
}

.data-table th,
.data-table td {
  border: 1px solid var(--color-border); /* 全边框 */
  text-align: center; /* 居中对齐 */
  padding: 0.6rem;
}

.data-table th {
  position: sticky;
  top: 0;
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  z-index: 1;
}

.data-table tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.col-index {
  color: var(--color-text-secondary);
}

.col-addr {
  color: var(--color-primary);
  font-weight: 600;
}

.col-value-header {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.format-indicator {
  font-size: 0.7rem;
  opacity: 0.7;
  font-weight: normal;
}

.val-dec {
  color: var(--color-text);
  font-weight: 700;
}

.val-hex {
  color: #a78bfa; /* 紫色调表示 HEX */
  font-weight: 700;
}

.val-bin {
  color: #34d399; /* 绿色调表示 BIN */
  font-size: 1rem; /* 增大字号 */
  letter-spacing: 1px; /* 增加字符间距 */
}

.table-empty {
  padding: 3rem;
  text-align: center;
  color: var(--color-text-secondary);
  font-style: italic;
  border: none;
}

.result-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-left: 0.5rem;
  font-weight: normal;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.format-switch {
  display: flex;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  padding: 2px;
}

.format-switch button {
  padding: 2px 8px;
  font-size: 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 3px;
  min-width: 36px;
}

.format-switch button.active {
  background: var(--color-primary);
  color: white;
  font-weight: 600;
}

.format-switch button:hover:not(.active) {
  background: var(--color-surface-hover);
}

/* 响应式 */
@media (max-width: 1100px) {
  .monitor-grid {
    flex-direction: column;
  }
}

@media (max-width: 900px) {
  .form-row {
    flex-direction: column;
    align-items: stretch;
  }
  
  .btn-send {
    width: 100%;
  }

  .dec-input-large {
    width: 100%;
  }
}
</style>
