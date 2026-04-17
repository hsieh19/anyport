<script setup lang="ts">
import { ref, computed } from "vue";
import { useDeviceStore } from "@/stores/deviceStore";
import {
  ModbusFunctionCode,
  MODBUS_FUNCTION_CODE_OPTIONS,
  normalizeFuncCodes,
} from "@/protocols/modbus";
import { useCollectionStore } from "@/stores/collectionStore";
import { interpretFrame } from "./utils/parser";
import type { useModbusState } from "./composables/useModbusState";
import type { useModbusActions } from "./composables/useModbusActions";

const props = defineProps<{
  state: ReturnType<typeof useModbusState>;
  actions: ReturnType<typeof useModbusActions>;
}>();

const { state, actions } = props;
const deviceStore = useDeviceStore();
const collectionStore = useCollectionStore();

const endianOptions = [
  { label: "ABCD (Big-Endian)", value: "ABCD" },
  { label: "CDAB (Word-Swap)", value: "CDAB" },
  { label: "BADC (Byte-Swap)", value: "BADC" },
  { label: "DCBA (Little-Endian)", value: "DCBA" },
];

const manualDataTypeOptions = [
  { label: "UInt16 (16位无符号)", value: "uint16" },
  { label: "Int16 (16位有符号)", value: "int16" },
  { label: "UInt32 (32位无符号)", value: "uint32" },
  { label: "Int32 (32位有符号)", value: "int32" },
  { label: "Float32 (单精度浮点)", value: "float32" },
  { label: "String (字符串)", value: "string" },
  { label: "Coil/Discrete (位开关)", value: "coil" },
];

const modbusCommandTitle = computed(() =>
  deviceStore.modbusMode === "rtu" ? "Modbus RTU 命令" : "Modbus TCP 命令",
);

const availableFunctionCodeOptions = computed(() => {
  if (state.runMode.value === "manual") {
    return MODBUS_FUNCTION_CODE_OPTIONS;
  }
  // 自动模式：未选择点表或未选择寄存器，则没有可选功能码
  if (
    !state.selectedProfile.value ||
    !state.selectedRegisterName.value ||
    !state.currentRegisterObj.value
  ) {
    return [];
  }
  const allowed = normalizeFuncCodes(state.currentRegisterObj.value.func_code);
  return MODBUS_FUNCTION_CODE_OPTIONS.filter((opt) =>
    allowed.includes(opt.value),
  );
});

const isReadOperation = computed(() =>
  [
    ModbusFunctionCode.READ_COILS,
    ModbusFunctionCode.READ_DISCRETE_INPUTS,
    ModbusFunctionCode.READ_HOLDING_REGISTERS,
    ModbusFunctionCode.READ_INPUT_REGISTERS,
  ].includes(state.functionCode.value),
);

const isSingleWrite = computed(() =>
  [
    ModbusFunctionCode.WRITE_SINGLE_COIL,
    ModbusFunctionCode.WRITE_SINGLE_REGISTER,
  ].includes(state.functionCode.value),
);

const fullRawFrame = computed(() =>
  actions.getFullRawFrame(isReadOperation.value),
);

const frameInterpretation = computed(() => {
  const hexs = fullRawFrame.value.split(" ");
  return interpretFrame(hexs, false, deviceStore.modbusMode as "rtu" | "tcp");
});

function setBase(val: boolean) {
  state.useBase1.value = val;
}

const regSearchQuery = ref("");
const isDropdownOpen = ref(false);

const filteredRegisters = computed(() => {
  const regs = state.selectedProfile.value?.data.registers || [];
  if (!regSearchQuery.value) return regs;
  const q = regSearchQuery.value.toLowerCase();
  return regs.filter((r) => r.name.toLowerCase().includes(q));
});

function selectReg(name: string) {
  state.selectedRegisterName.value = name;
  isDropdownOpen.value = false;
  regSearchQuery.value = "";
}

const handleAddToCollection = () => {
  if (state.runMode.value === "auto" && state.selectedProfile.value) {
    const reg = state.currentRegisterObj.value;
    if (!reg) return;
    collectionStore.addCustomChannel({
      id: `${state.slaveAddress.value}_${reg.func_code}_${reg.addr}`,
      name: reg.name,
      slaveAddr: state.slaveAddress.value,
      addr: reg.addr,
      func_code: reg.func_code,
      data_type: reg.data_type,
      count: reg.count,
      unit: reg.unit,
      scale: reg.scale,
      mapping: reg.mapping,
      endian: reg.endian,
    });
    actions.showToast(`已添加：${reg.name}`, "success");
  } else {
    // 手动模式：基于当前填写的参数添加
    const name = `寄存器 ${state.startAddress.value}`;
    collectionStore.addCustomChannel({
      name,
      slaveAddr: state.slaveAddress.value,
      addr: state.startAddress.value,
      func_code: state.functionCode.value,
      data_type: state.manualDataType.value,
      endian: state.manualEndian.value,
    });
    actions.showToast(`已添加手动项：${name}`, "success");
  }
};
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
            :disabled="collectionStore.isCollecting"
            @click="state.isProfilePickerShow.value = true"
            style="margin-right: 12px"
          >
            {{
              state.selectedProfile.value
                ? `🗂️ ${state.selectedProfile.value.data.protocol_summary.model}`
                : "📂 请选择点表..."
            }}
          </button>

          <div class="mode-switch-simple">
            <button
              class="tab"
              :class="{ active: state.runMode.value === 'auto' }"
              :disabled="collectionStore.isCollecting"
              @click="state.runMode.value = 'auto'"
            >
              自动
            </button>
            <button
              class="tab"
              :class="{ active: state.runMode.value === 'manual' }"
              :disabled="collectionStore.isCollecting"
              @click="state.runMode.value = 'manual'"
            >
              手动
            </button>
          </div>

          <!-- ✅ 持续采集开关按钮 (移至最右侧) -->
          <button
            class="btn-feature-toggle"
            :class="{ active: state.isCollectionVisible.value }"
            @click="
              state.isCollectionVisible.value = !state.isCollectionVisible.value
            "
          >
            <span class="icon">⏱️</span>
            轮询界面
            <span v-if="collectionStore.isCollecting" class="dot-active"></span>
          </button>
        </div>
      </h2>
    </div>

    <div class="command-form-horizontal">
      <div class="form-row">
        <div class="form-group form-group-slave">
          <label>从站地址</label>
          <input
            type="number"
            v-model="state.slaveAddress.value"
            min="1"
            max="247"
            :disabled="collectionStore.isCollecting"
          />
        </div>

        <div class="form-group form-group-fc">
          <label>功能码</label>
          <select
            v-model="state.functionCode.value"
            class="function-code-select"
            :disabled="
              collectionStore.isCollecting ||
              (state.runMode.value === 'auto' && !state.selectedRegisterName.value)
            "
          >
            <option v-if="availableFunctionCodeOptions.length === 0" value="">
              -- 请先选择寄存器 --
            </option>
            <option
              v-for="opt in availableFunctionCodeOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- ✅ 列 3：寄存器名称 / 起始地址 -->
        <div
          class="form-group"
          :style="{ width: state.runMode.value === 'auto' ? '220px' : '120px' }"
        >
          <label>
            {{
              state.runMode.value === "auto" ? "寄存器名称" : "起始地址 (Dec)"
            }}
          </label>

          <!-- 自动模式：下拉 -->
          <div
            v-if="state.runMode.value === 'auto'"
            class="searchable-dropdown-container"
          >
            <div
              class="dropdown-trigger"
              :class="{ open: isDropdownOpen, disabled: collectionStore.isCollecting }"
              @click="!collectionStore.isCollecting && (isDropdownOpen = !isDropdownOpen)"
            >
              <div class="trigger-label text-ellipsis">
                {{ state.selectedRegisterName.value || "-- 请选择寄存器 --" }}
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
                  :class="{
                    active: state.selectedRegisterName.value === reg.name,
                  }"
                  @click="selectReg(reg.name)"
                >
                  <div class="item-name">{{ reg.name }}</div>
                  <div v-if="reg.description" class="item-desc">
                    {{ reg.description }}
                  </div>
                </div>
                <div
                  v-if="filteredRegisters.length === 0"
                  class="dropdown-empty"
                >
                  未找到匹配项
                </div>
              </div>
            </div>
            <div
              v-if="isDropdownOpen"
              class="dropdown-overlay"
              @click="isDropdownOpen = false"
            ></div>
          </div>

          <!-- 手动模式：输入 -->
          <input
            v-else
            type="number"
            v-model="state.startAddress.value"
            :min="state.useBase1.value ? 1 : 0"
            max="65535"
            class="dec-input-small"
            :disabled="collectionStore.isCollecting"
          />
        </div>

        <!-- ✅ 列 4：PLC地址 & Base切换 (作为独立列，确保绝对左对齐) -->
        <div class="form-group form-group-plc">
          <div class="label-with-switch no-label">
            <div class="base-switch">
              <button
                :class="{ active: !state.useBase1.value }"
                :disabled="collectionStore.isCollecting"
                @click="setBase(false)"
                title="从 0 开始计数 (Base 0)"
              >
                Base 0
              </button>
              <button
                :class="{ active: state.useBase1.value }"
                :disabled="collectionStore.isCollecting"
                @click="setBase(true)"
                title="从 1 开始计数 (Base 1 / PLC)"
              >
                Base 1
              </button>
            </div>
          </div>

          <div class="plc-address-display">
            <span class="label">PLC地址</span>
            <span class="value">{{ state.plcAddress.value }}</span>
          </div>
        </div>

        <!-- 数据类型选择 (仅手动模式) -->
        <div
          v-if="state.runMode.value === 'manual'"
          class="form-group form-group-manual-type"
        >
          <div class="label-with-endian">
            <label>数据类型</label>
            <select
              v-if="
                ['uint32', 'int32', 'float32'].includes(
                  state.manualDataType.value,
                )
              "
              v-model="state.manualEndian.value"
              class="endian-mini-select"
              title="字节序 (Endian)"
              :disabled="collectionStore.isCollecting"
            >
              <option
                v-for="opt in endianOptions"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.value }}
              </option>
            </select>
          </div>
          <select
            v-model="state.manualDataType.value"
            class="manual-type-select"
            :disabled="collectionStore.isCollecting"
          >
            <option
              v-for="opt in manualDataTypeOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div
          v-if="isReadOperation || !isSingleWrite"
          class="form-group form-group-quantity"
        >
          <label>寄存器数量</label>
          <input
            type="number"
            v-model="state.quantity.value"
            min="1"
            max="125"
            :disabled="
              collectionStore.isCollecting ||
              state.runMode.value === 'auto' ||
              (state.runMode.value === 'manual' &&
                state.manualDataType.value !== 'string' &&
                !isReadOperation)
            "
          />
        </div>

        <div v-if="isSingleWrite" class="form-group">
          <label>{{
            state.manualDataType.value === "string" &&
            state.runMode.value === "manual"
              ? "写入文本"
              : "写入值"
          }}</label>
          <!-- 场景 1: 自动模式且有点表 Mapping -->
          <select
            v-if="
              state.runMode.value === 'auto' &&
              state.currentRegisterObj.value?.mapping
            "
            v-model.number="state.writeValue.value"
            class="mapping-select"
            :disabled="collectionStore.isCollecting"
          >
            <option
              v-for="(label, val) in state.currentRegisterObj.value.mapping"
              :key="val"
              :value="Number(val)"
            >
              {{ label }} ({{ val }})
            </option>
          </select>

          <!-- 场景 2: 手动模式或无 Mapping -->
          <input
            v-else
            type="number"
            v-model="state.writeValue.value"
            min="0"
            max="65535"
          />
        </div>

        <div v-if="!isReadOperation && !isSingleWrite" class="form-group grow">
          <label>{{
            state.manualDataType.value === "string" &&
            state.runMode.value === "manual"
              ? "写入文本内容"
              : "写入值 (逗号分隔)"
          }}</label>
          <input
            type="text"
            v-model="state.writeValues.value"
            :disabled="collectionStore.isCollecting"
            :placeholder="
              state.manualDataType.value === 'string' &&
              state.runMode.value === 'manual'
                ? '输入字符串原文'
                : '例如: 100, 200, 300'
            "
          />
        </div>

        <div class="form-actions-inline">
          <div class="preview-box">
            <div class="preview-label">
              <span class="icon">🔍</span>
              报文预览 (Hex)
              <div class="help-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="info-svg"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <div class="tooltip tx-preview-tooltip">
                  <div class="tooltip-title">报文结构解析</div>
                  <div class="tooltip-content">
                    <div
                      v-for="part in frameInterpretation"
                      :key="part.name"
                      class="tooltip-item"
                    >
                      <span class="p-name">{{ part.name }}:</span>
                      <span class="p-value">{{ part.value }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="preview-value">{{ fullRawFrame }}</div>
          </div>

          <div class="action-toggle-group">
            <button
              class="toggle-btn main"
              :disabled="!deviceStore.isModbusConnected || collectionStore.isCollecting"
              @click="actions.sendCommand"
            >
              单次发送
            </button>
            <button
              class="toggle-btn secondary"
              :disabled="collectionStore.isCollecting"
              @click="handleAddToCollection"
            >
              加入轮询
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.btn-feature-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.action-toggle-group {
  display: flex;
  height: 2.8rem;
  background: white; /* 基础底色 */
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
}

.toggle-btn {
  flex: 1;
  height: 100%; /* 填满父容器高度 */
  padding: 0 16px;
  border: none !important; /* 彻底移除按钮自带边框 */
  border-radius: 0 !important; /* 彻底移除按钮自带圆角 */
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  outline: none;
}

.toggle-btn.main {
  background: var(--color-primary);
  color: white;
}

.toggle-btn.main:hover {
  filter: brightness(1.1);
}

.toggle-btn:disabled {
  background: var(--color-border) !important;
  color: var(--color-text-secondary) !important;
  cursor: not-allowed;
  opacity: 0.7;
  border-left-color: #ddd !important;
}

.toggle-btn.secondary {
  background: white;
  color: var(--color-primary);
}

.toggle-btn.secondary:hover {
  background: rgba(102, 126, 234, 0.05);
}

/* 只需要在右侧按钮左边加一个分割线 */
.toggle-btn.secondary {
  border-left: 1px solid var(--color-primary) !important;
}

.btn-feature-toggle:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.btn-feature-toggle.active {
  background: rgba(102, 126, 234, 0.1);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.dot-active {
  width: 6px;
  height: 6px;
  background: #48bb78;
  border-radius: 50%;
  margin-left: 4px;
  box-shadow: 0 0 6px #48bb78;
  animation: blink 1.5s infinite;
}

@keyframes blink {
  0% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.4;
  }
}

.mode-switch-simple {
  display: flex;
  background: var(--color-bg);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  gap: 2px;
}

.mode-switch-simple .tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 下拉菜单禁用状态 */
.dropdown-trigger.disabled {
  background: var(--color-bg-dim);
  color: var(--color-text-muted);
  cursor: not-allowed;
  border-color: var(--color-border);
}

.mode-switch-simple .tab {
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  transition: all 0.2s;
}

.mode-switch-simple .tab.active {
  background: var(--color-primary);
  color: white;
}
</style>
