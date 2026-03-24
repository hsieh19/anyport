<script setup lang="ts">
import { ref, computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ModbusFunctionCode, MODBUS_FUNCTION_CODE_OPTIONS, normalizeFuncCodes } from '@/protocols/modbus';
import { interpretFrame } from './utils/parser';
import type { useModbusState } from './composables/useModbusState';
import type { useModbusActions } from './composables/useModbusActions';

const props = defineProps<{
  state: ReturnType<typeof useModbusState>;
  actions: ReturnType<typeof useModbusActions>;
}>();

const { state, actions } = props;
const deviceStore = useDeviceStore();

const endianOptions = [
  { label: 'ABCD (Big-Endian)', value: 'ABCD' },
  { label: 'CDAB (Word-Swap)', value: 'CDAB' },
  { label: 'BADC (Byte-Swap)', value: 'BADC' },
  { label: 'DCBA (Little-Endian)', value: 'DCBA' }
];

const manualDataTypeOptions = [
  { label: 'UInt16 (16位无符号)', value: 'uint16' },
  { label: 'Int16 (16位有符号)', value: 'int16' },
  { label: 'UInt32 (32位无符号)', value: 'uint32' },
  { label: 'Int32 (32位有符号)', value: 'int32' },
  { label: 'Float32 (单精度浮点)', value: 'float32' },
  { label: 'String (字符串)', value: 'string' },
  { label: 'Coil/Discrete (位开关)', value: 'coil' }
];

const modbusCommandTitle = computed(() =>
  deviceStore.modbusMode === 'rtu' ? 'Modbus RTU 命令' : 'Modbus TCP 命令'
);

const availableFunctionCodeOptions = computed(() => {
  if (state.runMode.value === 'manual') {
    return MODBUS_FUNCTION_CODE_OPTIONS;
  }
  // 自动模式：未选择点表或未选择寄存器，则没有可选功能码
  if (!state.selectedProfile.value || !state.selectedRegisterName.value || !state.currentRegisterObj.value) {
    return [];
  }
  const allowed = normalizeFuncCodes(state.currentRegisterObj.value.func_code);
  return MODBUS_FUNCTION_CODE_OPTIONS.filter(opt => allowed.includes(opt.value));
});

const isReadOperation = computed(() => 
  [ModbusFunctionCode.READ_COILS, ModbusFunctionCode.READ_DISCRETE_INPUTS, ModbusFunctionCode.READ_HOLDING_REGISTERS, ModbusFunctionCode.READ_INPUT_REGISTERS].includes(state.functionCode.value)
);

const isSingleWrite = computed(() => 
  [ModbusFunctionCode.WRITE_SINGLE_COIL, ModbusFunctionCode.WRITE_SINGLE_REGISTER].includes(state.functionCode.value)
);

const fullRawFrame = computed(() => actions.getFullRawFrame(isReadOperation.value));

const frameInterpretation = computed(() => {
  const hexs = fullRawFrame.value.split(' ');
  return interpretFrame(hexs, isReadOperation.value, false, deviceStore.modbusMode as 'rtu' | 'tcp');
});

function setBase(val: boolean) {
    state.useBase1.value = val;
}

const regSearchQuery = ref('');
const isDropdownOpen = ref(false);

const filteredRegisters = computed(() => {
  const regs = state.selectedProfile.value?.data.registers || [];
  if (!regSearchQuery.value) return regs;
  const q = regSearchQuery.value.toLowerCase();
  return regs.filter(r => r.name.toLowerCase().includes(q));
});

function selectReg(name: string) {
  state.selectedRegisterName.value = name;
  isDropdownOpen.value = false;
  regSearchQuery.value = '';
}
</script>

<template>
  <section class="panel-section command-section">
    <div class="section-header-row">
      <h2 class="section-title">
        <span class="icon">📡</span>
        {{ modbusCommandTitle }}
        
        <div class="mode-switch-simple">
          <!-- 新增：选择点表按钮 -->
          <button 
            v-if="state.runMode.value === 'auto'"
            class="btn-text-action" 
            @click="state.isProfilePickerShow.value = true"
            style="margin-right: 12px;"
          >
            {{ state.selectedProfile.value ? `🗂️ ${state.selectedProfile.value.data.protocol_summary.model}` : '📂 请选择点表...' }}
          </button>

          <span 
            class="mode-opt" 
            :class="{ active: state.runMode.value === 'auto' }"
            @click="state.runMode.value = 'auto'"
          >自动</span>
          <span class="sep">|</span>
          <span 
            class="mode-opt" 
            :class="{ active: state.runMode.value === 'manual' }"
            @click="state.runMode.value = 'manual'"
          >手动</span>
        </div>
      </h2>
    </div>
    
    <div class="command-form-horizontal">
      <div class="form-row">
        <div class="form-group form-group-slave">
          <label>从站地址</label>
          <input type="number" v-model="state.slaveAddress.value" min="1" max="247" />
        </div>
        
        <div class="form-group form-group-fc">
          <label>功能码</label>
          <select 
            v-model="state.functionCode.value" 
            class="function-code-select"
            :disabled="state.runMode.value === 'auto' && !state.selectedRegisterName.value"
          >
            <option v-if="availableFunctionCodeOptions.length === 0" value="">-- 请先选择寄存器 --</option>
            <option v-for="opt in availableFunctionCodeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- ✅ 列 3：寄存器名称 / 起始地址 -->
        <div class="form-group" :style="{ width: state.runMode.value === 'auto' ? '220px' : '120px' }">
          <label>
            {{ state.runMode.value === 'auto' ? '寄存器名称' : '起始地址 (Dec)' }}
          </label>
          
          <!-- 自动模式：下拉 -->
          <div v-if="state.runMode.value === 'auto'" class="searchable-dropdown-container">
            <div 
              class="dropdown-trigger" 
              :class="{ open: isDropdownOpen }"
              @click="isDropdownOpen = !isDropdownOpen"
            >
              <div class="trigger-label text-ellipsis">
                {{ state.selectedRegisterName.value || '-- 请选择寄存器 --' }}
              </div>
              <span class="trigger-arrow">▼</span>
            </div>

            <div v-if="isDropdownOpen" class="dropdown-panel">
              <input 
                type="text" 
                v-model="regSearchQuery" 
                class="dropdown-search-input" 
                placeholder="🔍 搜索名称..."
                @click.stop
              />
              <div class="dropdown-options-list custom-scrollbar">
                <div 
                  v-for="reg in filteredRegisters" 
                  :key="reg.name" 
                  class="dropdown-item"
                  :class="{ active: state.selectedRegisterName.value === reg.name }"
                  @click="selectReg(reg.name)"
                >
                  <div class="item-name">{{ reg.name }}</div>
                  <div v-if="reg.description" class="item-desc">{{ reg.description }}</div>
                </div>
                <div v-if="filteredRegisters.length === 0" class="dropdown-empty">
                  未找到匹配项
                </div>
              </div>
            </div>
            <div v-if="isDropdownOpen" class="dropdown-overlay" @click="isDropdownOpen = false"></div>
          </div>

          <!-- 手动模式：输入 -->
          <input 
            v-else
            type="number" 
            v-model="state.startAddress.value" 
            :min="state.useBase1.value ? 1 : 0" 
            max="65535" 
            class="dec-input-small" 
          />
        </div>

        <!-- ✅ 列 4：PLC地址 & Base切换 (作为独立列，确保绝对左对齐) -->
        <div class="form-group form-group-plc">
          <div class="label-with-switch no-label">
            <div class="base-switch">
              <button 
                :class="{ active: !state.useBase1.value }" 
                @click="setBase(false)"
                title="从 0 开始计数 (Base 0)"
              >Base 0</button>
              <button 
                :class="{ active: state.useBase1.value }" 
                @click="setBase(true)"
                title="从 1 开始计数 (Base 1 / PLC)"
              >Base 1</button>
            </div>
          </div>
          
          <div class="plc-address-display">
            <span class="label">PLC地址</span>
            <span class="value">{{ state.plcAddress.value }}</span>
          </div>
        </div>

        <!-- 数据类型选择 (仅手动模式) -->
        <div v-if="state.runMode.value === 'manual'" class="form-group form-group-manual-type">
          <div class="label-with-endian">
            <label>数据类型</label>
            <select 
              v-if="['uint32', 'int32', 'float32'].includes(state.manualDataType.value)"
              v-model="state.manualEndian.value" 
              class="endian-mini-select"
              title="字节序 (Endian)"
            >
              <option v-for="opt in endianOptions" :key="opt.value" :value="opt.value">
                {{ opt.value }}
              </option>
            </select>
          </div>
          <select v-model="state.manualDataType.value" class="manual-type-select">
            <option v-for="opt in manualDataTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        
        <div v-if="isReadOperation || !isSingleWrite" class="form-group form-group-quantity">
            <label>寄存器数量</label>
            <input 
              type="number" 
              v-model="state.quantity.value" 
              min="1" 
              max="125" 
              :disabled="state.runMode.value === 'auto' || (state.runMode.value === 'manual' && state.manualDataType.value !== 'string' && !isReadOperation)"
            />
        </div>
        
        <div v-if="isSingleWrite" class="form-group">
            <label>{{ state.manualDataType.value === 'string' && state.runMode.value === 'manual' ? '写入文本' : '写入值' }}</label>
            <!-- 场景 1: 自动模式且有点表 Mapping -->
            <select 
              v-if="state.runMode.value === 'auto' && state.currentRegisterObj.value?.mapping" 
              v-model.number="state.writeValue.value"
              class="mapping-select"
            >
              <option v-for="(label, val) in state.currentRegisterObj.value.mapping" :key="val" :value="Number(val)">
                {{ label }} ({{ val }})
              </option>
            </select>

            <!-- 场景 2: 手动模式或无 Mapping -->
            <input v-else type="number" v-model="state.writeValue.value" min="0" max="65535" />
        </div>
        
        <div v-if="!isReadOperation && !isSingleWrite" class="form-group grow">
            <label>{{ state.manualDataType.value === 'string' && state.runMode.value === 'manual' ? '写入文本内容' : '写入值 (逗号分隔)' }}</label>
            <input 
              type="text" 
              v-model="state.writeValues.value" 
              :placeholder="state.manualDataType.value === 'string' && state.runMode.value === 'manual' ? '输入字符串原文' : '例如: 100, 200, 300'" 
            />
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
            :disabled="!deviceStore.isModbusConnected"
            @click="actions.sendCommand"
          >
            发送命令
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
