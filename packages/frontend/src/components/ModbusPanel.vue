<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useDeviceStore, type ConnectionType, type Gateway } from '@/stores/deviceStore';
import { useProfileStore } from '@/stores/profileStore'; 
import { ModbusFunctionCode } from '@/protocols/modbus';
import type { ModbusRtuCommand } from '@/protocols/modbus';
import { ProtocolType } from '@shared/types/protocol.types';

const deviceStore = useDeviceStore();
const profileStore = useProfileStore();
const isSecure = window.isSecureContext;

// 初始化加载点表
onMounted(() => {
  if (profileStore.profiles.length === 0) {
    profileStore.loadProfiles();
  }
});

// 辅助函数：将多种格式的 func_code 转换为数字数组
function normalizeFuncCodes(input: any): number[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map(item => {
    if (item === null || item === undefined) return NaN;
    if (typeof item === 'string') {
      // 处理 "0x03" 或 "3" 格式
      return item.startsWith('0x') ? parseInt(item, 16) : parseInt(item, 10);
    }
    return Number(item);
  }).filter(n => !isNaN(n));
}

/**
 * 辅助函数：Modbus 地址归一化
 * 将 PLC 地址 (如 40600) 转换为协议偏移量 (如 599 或 40600)
 * 逻辑：
 * 1. 如果是 Base 0 (base1 = false)，则视为原始偏移量不做任何处理。
 * 2. 如果是 Base 1 (base1 = true)，则尝试根据功能码判定是否属于 PLC 地址段并减去基准。
 */
// --- 写入值转换逻辑 ---

/**
 * 将输入值根据类型转换成 Modbus 寄存器数组 (16位)
 */
function encodeValue(valStr: string, dataType: string, endian: string = 'ABCD'): number[] {
  const val = parseFloat(valStr);
  if (isNaN(val)) return [];

  // 判断是否是 32 位类型 (需占用 2 个寄存器)
  const is32Bit = ['float32', 'int32', 'uint32'].includes(dataType);
  
  if (!is32Bit) {
    // 对于布尔类型，Modbus 协议通常 0x0000 为 OFF，0xFF00 为 ON
    if (dataType === 'coil' || dataType === 'discrete_input') {
      return [val === 0 ? 0x0000 : 0xFF00];
    }
    return [Math.round(val) & 0xFFFF];
  }

  // 处理 32 位编码
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);

  if (dataType === 'float32') {
    view.setFloat32(0, val, false); // 原生大端
  } else if (dataType === 'int32') {
    view.setInt32(0, Math.round(val), false);
  } else { // uint32
    view.setUint32(0, Math.round(val), false);
  }

  const bytes = new Uint8Array(buffer);
  let reordered: number[] = [];
  
  // 字节序处理
  if (endian === 'CDAB') reordered = [bytes[2]!, bytes[3]!, bytes[0]!, bytes[1]!];
  else if (endian === 'BADC') reordered = [bytes[1]!, bytes[0]!, bytes[3]!, bytes[2]!];
  else if (endian === 'DCBA') reordered = [bytes[3]!, bytes[2]!, bytes[1]!, bytes[0]!];
  else reordered = [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!]; // ABCD

  return [
    ((reordered[0] ?? 0) << 8) | (reordered[1] ?? 0),
    ((reordered[2] ?? 0) << 8) | (reordered[3] ?? 0)
  ];
}

function getModbusOffset(addr: number | string, fc: number | string, base1: boolean): number {
  const numAddr = typeof addr === 'string' ? parseInt(addr, 10) : addr;
  const fcNum = typeof fc === 'string' ? parseInt(fc, 10) : fc;

  if (!base1) return numAddr; // Base 0 模式下，永远不自动减去基准值
  
  // 仅在 Base 1 模式下，尝试将标准 PLC 范围地址识别为 1-based 偏移并转换
  if (numAddr >= 40001 && numAddr <= 49999 && (fcNum === 3 || fcNum === 6 || fcNum === 16)) return numAddr - 40001;
  if (numAddr >= 30001 && numAddr <= 39999 && fcNum === 4) return numAddr - 30001;
  if (numAddr >= 10001 && numAddr <= 19999 && fcNum === 2) return numAddr - 10001;
  if (numAddr >= 1 && numAddr <= 9999 && (fcNum === 1 || fcNum === 5 || fcNum === 15)) return numAddr - 1; 
  
  return numAddr;
}

// --- 数据解析核心逻辑 ---

/**
 * 辅助：跨寄存器解析 (支持 16/32 位，及各种字节序)
 * byteOrder: 'ABCD' (默认大端), 'CDAB' (小端交换), 'BADC', 'DCBA'
 */
function getExtendedValue(allValues: number[], offset: number, dataType: string, byteOrder: string = 'ABCD'): number | null {
  const val1 = allValues[offset]; // 原始第1个寄存器 (16bit)
  if (val1 === undefined) return null;

  // 32位数据解析 (需要读取两个寄存器)
  if (dataType === 'int32' || dataType === 'uint32' || dataType === 'float32') {
    const val2 = allValues[offset + 1]; // 原始第2个寄存器 (16bit)
    if (val2 === undefined) return null;

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    
    // 将两个 16bit 寄存器拼成 4 个字节，根据 byteOrder 排布
    //ABCD: val1_H, val1_L, val2_H, val2_L
    //CDAB: val2_H, val2_L, val1_H, val1_L
    //BADC: val1_L, val1_H, val2_L, val2_H
    //DCBA: val2_L, val2_H, val1_L, val1_H
    
    const h1 = (val1 >> 8) & 0xFF;
    const l1 = val1 & 0xFF;
    const h2 = (val2 >> 8) & 0xFF;
    const l2 = val2 & 0xFF;

    let bytes = [h1, l1, h2, l2]; // ABCD
    if (byteOrder === 'CDAB') bytes = [h2, l2, h1, l1];
    else if (byteOrder === 'BADC') bytes = [l1, h1, l2, h2];
    else if (byteOrder === 'DCBA') bytes = [l2, h2, l1, h1];

    bytes.forEach((b, i) => view.setUint8(i, b));

    if (dataType === 'float32') return view.getFloat32(0, false);
    if (dataType === 'int32') return view.getInt32(0, false);
    return view.getUint32(0, false);
  }

  // 16位数据解析
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  
  // 16位也可能有字节交换 (BADC/DCBA 下通常意味着 16bit 内部字节交换)
  if (byteOrder === 'BADC' || byteOrder === 'DCBA') {
    view.setUint8(0, val1 & 0xFF);
    view.setUint8(1, (val1 >> 8) & 0xFF);
  } else {
    view.setUint16(0, val1, false);
  }

  if (dataType === 'int16') return view.getInt16(0, false);
  return view.getUint16(0, false);
}

// 核心解析函数
function parseAutoValue(regObj: any, allValues: any[], offset: number, defaultEndian: string = 'ABCD'): string | null {
  if (!regObj) return null;

  // 区分处理：线圈、字符串、或普通数值
  let val: any;
  const isCoil = regObj.data_type === 'coil' || regObj.data_type === 'discrete_input';
  const isString = regObj.data_type === 'string';
  
  if (isCoil) {
    const rawVal = allValues[offset];
    val = (typeof rawVal === 'boolean') ? (rawVal ? 1 : 0) : rawVal;
  } else if (isString) {
    // --- 字符串特殊处理 ---
    const count = regObj.count || 1;
    let bytes: number[] = [];
    for (let i = 0; i < count; i++) {
       const regVal = allValues[offset + i];
       if (regVal === undefined) break;
       // Modbus 习惯：高字节在前，低字节在后
       bytes.push((regVal >> 8) & 0xFF);
       bytes.push(regVal & 0xFF);
    }
    // 转为字符串并去除末尾的空字符 (\0)
    val = String.fromCharCode(...bytes).replace(/\u0000/g, '').trim();
  } else {
    // 优先使用点表定义的字节序，否则使用点表全局默认字节序
    const endian = regObj.endian || defaultEndian || 'ABCD';
    val = getExtendedValue(allValues as number[], offset, regObj.data_type || 'uint16', endian);
  }

  if (val === null || val === undefined) return null;

  // 1. Mapping 映射
  if (regObj.mapping) {
    const strKey = val.toString();
    if (regObj.mapping[strKey] !== undefined) return regObj.mapping[strKey];
    
    const hexKey = '0x' + Number(val).toString(16).toUpperCase();
    const hexKeyLower = '0x' + Number(val).toString(16).toLowerCase();
    if (regObj.mapping[hexKey] !== undefined) return regObj.mapping[hexKey];
    if (regObj.mapping[hexKeyLower] !== undefined) return regObj.mapping[hexKeyLower];
  }

  // 2. Scale 缩放 (仅对非线圈和非字符串类型)
  if (!isCoil && !isString && regObj.scale !== undefined) {
    val = (Number(val) * regObj.scale).toFixed(3);
    val = parseFloat(val); // 消除多余 0
  }

  // 3. Unit 单位
  const unitStr = regObj.unit ? ` ${regObj.unit}` : '';
  return `${val}${unitStr}`;
}

// 运行模式
type RunMode = 'manual' | 'auto';
const runMode = ref<RunMode>('auto');

// 自动模式状态
const selectedProfileId = ref<string | null>(null);
const selectedRegisterName = ref<string>('');
const isProfilePickerShow = ref(false);

const selectedProfile = computed(() => 
  profileStore.profiles.find(p => p.id === selectedProfileId.value)
);

const currentRegisterObj = computed(() => {
  if (!selectedProfile.value || !selectedRegisterName.value) return null;
  return selectedProfile.value.data.registers.find(r => r.name === selectedRegisterName.value);
});

// 表单状态
const slaveAddress = ref(1);
const functionCode = ref<ModbusFunctionCode>(ModbusFunctionCode.READ_HOLDING_REGISTERS);
const startAddress = ref(0);
const quantity = ref(1);
const writeValue = ref(0);
const writeValues = ref('');

// (已移除原处的 watch(selectedRegisterName)，移动到下方以确保 useBase1 已定义)

// 连接配置
const baudRate = ref(9600);
const dataBits = ref(8);
const stopBits = ref(1);
const parity = ref<'none' | 'even' | 'odd'>('none');

const connectionType = computed<ConnectionType>({
  get: () => deviceStore.connectionType,
  set: (value: ConnectionType) => {
    deviceStore.setConnectionType(value);
    if (value === 'serial') {
      deviceStore.setModbusMode('rtu');
    } else {
      deviceStore.setModbusMode(deviceStore.gatewayOptions.protocol);
    }
  }
});

const modbusCommandTitle = computed(() =>
  deviceStore.modbusMode === 'rtu' ? 'Modbus RTU 命令' : 'Modbus TCP 命令'
);

const selectedGatewayId = ref<string>('');
const isGatewayManagerOpen = ref(false);
const editingGatewayId = ref<string | null>(null);
const gatewayFormName = ref('');
const gatewayFormHost = ref('');
const gatewayFormPort = ref<number | null>(null);
const gatewayFormError = ref('');

const selectedGateway = computed<Gateway | null>(() => {
  if (!selectedGatewayId.value) {
    return null;
  }
  const found = deviceStore.gateways.find(g => g.id === selectedGatewayId.value);
  return found || null;
});

const gatewayLatencyText = computed(() => {
  if (!selectedGateway.value || typeof selectedGateway.value.latency !== 'number') {
    return '--';
  }
  return `${selectedGateway.value.latency}ms`;
});

const gatewayTargetText = computed(() => {
  const opts = deviceStore.gatewayOptions;
  if (opts.protocol === 'tcp') {
    const { ip, port, unitId } = opts.tcpTarget;
    return `TCP ${ip}:${port} (Unit ID ${unitId})`;
  }
  const { slaveId, baudRate, dataBits, stopBits, parity } = opts.rtuTarget;
  return `RTU Slave ${slaveId}, ${baudRate}bps, ${dataBits}N${parity === 'none' ? '' : parity === 'even' ? 'E' : 'O'}${stopBits}`;
});

function syncGatewayToOptions(gateway: Gateway): void {
  deviceStore.updateGatewayOptions({
    address: gateway.host,
    wsPort: gateway.port,
    tcpTarget: {
      ...deviceStore.gatewayOptions.tcpTarget,
      ip: gateway.host,
      port: gateway.port
    }
  });
}

watch(
  () => deviceStore.gateways.length,
  length => {
    if (length > 0 && !selectedGatewayId.value) {
      const first = deviceStore.gateways[0];
      if (first) {
        selectedGatewayId.value = first.id;
        syncGatewayToOptions(first);
      }
    }
  },
  { immediate: true }
);

watch(selectedGatewayId, id => {
  const target = deviceStore.gateways.find(g => g.id === id);
  if (target) {
    syncGatewayToOptions(target);
  }
});

function resetGatewayForm(target?: Gateway): void {
  if (target) {
    editingGatewayId.value = target.id;
    gatewayFormName.value = target.name;
    gatewayFormHost.value = target.host;
    gatewayFormPort.value = target.port;
  } else {
    editingGatewayId.value = null;
    gatewayFormName.value = '';
    gatewayFormHost.value = '';
    gatewayFormPort.value = null;
  }
  gatewayFormError.value = '';
}

function openGatewayManager(): void {
  isGatewayManagerOpen.value = true;
  if (selectedGateway.value) {
    resetGatewayForm(selectedGateway.value);
  } else {
    resetGatewayForm();
  }
}

function closeGatewayManager(): void {
  isGatewayManagerOpen.value = false;
}

function handleSelectGatewayInList(gateway: Gateway): void {
  selectedGatewayId.value = gateway.id;
  resetGatewayForm(gateway);
}

function handleDeleteGateway(id: string): void {
  deviceStore.deleteGateway(id);
  if (selectedGatewayId.value === id) {
    const first = deviceStore.gateways[0];
    selectedGatewayId.value = first ? first.id : '';
    if (first) {
      syncGatewayToOptions(first);
    }
  }
}

function submitGatewayForm(): void {
  const name = gatewayFormName.value.trim();
  const host = gatewayFormHost.value.trim();
  const port = gatewayFormPort.value ?? 0;
  if (!name || !host || !port) {
    gatewayFormError.value = '请填写完整的名称、地址和端口。';
    return;
  }
  if (editingGatewayId.value) {
    deviceStore.updateGateway(editingGatewayId.value, {
      name,
      host,
      port
    });
    const updated = deviceStore.gateways.find(g => g.id === editingGatewayId.value);
    if (updated) {
      selectedGatewayId.value = updated.id;
      syncGatewayToOptions(updated);
    }
  } else {
    const created = deviceStore.addGateway({
      name,
      host,
      port
    });
    selectedGatewayId.value = created.id;
    syncGatewayToOptions(created);
  }
  gatewayFormError.value = '';
}

// 原始功能码选项定义
const ALL_FUNCTION_CODES = [
  { value: ModbusFunctionCode.READ_COILS, label: '01 - 读线圈' },
  { value: ModbusFunctionCode.READ_DISCRETE_INPUTS, label: '02 - 读离散输入' },
  { value: ModbusFunctionCode.READ_HOLDING_REGISTERS, label: '03 - 读保持寄存器' },
  { value: ModbusFunctionCode.READ_INPUT_REGISTERS, label: '04 - 读输入寄存器' },
  { value: ModbusFunctionCode.WRITE_SINGLE_COIL, label: '05 - 写单个线圈' },
  { value: ModbusFunctionCode.WRITE_SINGLE_REGISTER, label: '06 - 写单个寄存器' },
  { value: ModbusFunctionCode.WRITE_MULTIPLE_COILS, label: '0F - 写多个线圈' },
  { value: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, label: '10 - 写多个寄存器' },
];

// 根据运行模式和选中的寄存器，动态过滤可用的功能码
const availableFunctionCodeOptions = computed(() => {
  if (runMode.value === 'manual') {
    return ALL_FUNCTION_CODES;
  }
  
  // 自动模式下：未选择点表或未选择寄存器，则没有可选功能码
  if (!selectedProfile.value || !selectedRegisterName.value || !currentRegisterObj.value) {
    return [];
  }
  
  const allowed = normalizeFuncCodes(currentRegisterObj.value.func_code);
  return ALL_FUNCTION_CODES.filter(opt => allowed.includes(opt.value));
});

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

async function toggleConnection() {
  if (deviceStore.isConnected) {
    await deviceStore.disconnect();
    return;
  }

  if (connectionType.value === 'gateway') {
    if (!selectedGatewayId.value) {
      triggerAlert('请先选择一个网关或在“WiFi 网关”右侧添加网关。');
      return;
    }
    await deviceStore.connect();
    if (selectedGatewayId.value) {
      await deviceStore.checkGatewayStatus(selectedGatewayId.value);
    }
    return;
  }

  deviceStore.updateConfig({
    baudRate: baudRate.value,
    dataBits: dataBits.value as 5 | 6 | 7 | 8,
    stopBits: stopBits.value as 1 | 2,
    parity: parity.value
  });
  await deviceStore.connect();
}

// --- 写入确认逻辑 ---
const isWriteConfirmShow = ref(false);
const pendingWriteInfo = ref({
  regName: '',
  address: 0,
  newValue: '',
  oldValue: '等待读取...',
  type: 'data'
});

// --- 通信反馈反馈 (Toast) ---
const toast = ref({
  show: false,
  message: '',
  type: 'success' as 'success' | 'error' | 'info'
});
let toastTimer: any = null;

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
  if (toastTimer) clearTimeout(toastTimer);
  toast.value = { show: true, message: msg, type };
  toastTimer = setTimeout(() => {
    toast.value.show = false;
  }, 3000);
}

// 记录最后一次发送的上下文，用于匹配响应
const lastSentContext = ref<{
  fc: number;
  addr: number;
  time: number;
} | null>(null);

// 监听日志，捕获响应结果
watch(() => deviceStore.logs.length, () => {
  const latestLog = deviceStore.logs[0];
  if (!latestLog || latestLog.direction !== 'rx' || !lastSentContext.value) return;

  // 检查是否是针对最后一次发送的响应 (时间在 2s 内)
  const now = Date.now();
  if (now - lastSentContext.value.time > 2000) return;

  const hexs = latestLog.hex.split(' ');
  const resFCHex = hexs[1] || '00';
  const resFC = parseInt(resFCHex, 16);
  const sentFC = lastSentContext.value.fc;

  // 1. 正常响应匹配
  if (resFC === sentFC) {
    showToast(`指令执行成功 (FC ${sentFC.toString(16).toUpperCase()})`, 'success');
    lastSentContext.value = null; // 消费掉
  } 
  // 2. 异常响应报文 (FC + 0x80)
  else if (resFC === sentFC + 0x80) {
    const errorCode = hexs[2] || '00';
    const errorMap: Record<string, string> = {
      '01': '非法功能代码',
      '02': '非法数据地址',
      '03': '非法数据值',
      '04': '从站设备故障',
      '05': '确认后无法执行',
      '06': '从站忙',
    };
    showToast(`设备返回异常: ${errorMap[errorCode] || '未知错误'}(0x${errorCode})`, 'error');
    lastSentContext.value = null;
  }
});

// 真正的执行写入逻辑 (由弹窗确认后调用)
async function executeActualWrite() {
  isWriteConfirmShow.value = false;
  const reg = currentRegisterObj.value;

  // 1. 自动解锁逻辑
  if (runMode.value === 'auto' && reg?.unlock_required && selectedProfile.value) {
    const unlockCfg = reg.unlock_required;
    const unlockTargetReg = selectedProfile.value.data.registers.find((r: any) => r.name === unlockCfg.target);
    if (unlockTargetReg) {
      console.log(`[Modbus] 正在自动解锁: ${unlockCfg.target}`);
      const unlockRawVal = typeof unlockCfg.value === 'string' && unlockCfg.value.startsWith('0x') ? parseInt(unlockCfg.value, 16) : Number(unlockCfg.value);
      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: slaveAddress.value,
        functionCode: ModbusFunctionCode.WRITE_SINGLE_REGISTER,
        startAddress: getModbusOffset(String(unlockTargetReg.addr || 0), String(ModbusFunctionCode.WRITE_SINGLE_REGISTER), useBase1.value),
        values: [unlockRawVal]
      });
      let delayMs = 200;
      if (unlockCfg.timeout) {
         const match = unlockCfg.timeout.match(/(\d+)(ms|s)/);
         if (match && match[1]) {
           delayMs = match[2] === 's' ? parseInt(match[1]) * 1000 : parseInt(match[1]);
         }
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 2000)));
    }
  }

  const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;
  
  // 记录上下文
  lastSentContext.value = {
    fc: functionCode.value,
    addr: startAddress.value,
    time: Date.now()
  };

  const command: ModbusRtuCommand = {
    protocol: ProtocolType.MODBUS_RTU,
    slaveAddress: slaveAddress.value,
    functionCode: functionCode.value,
    startAddress: physicalAddress,
    quantity: functionCode.value === ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS ? quantity.value : undefined,
    values: getWriteValues()
  };

  try {
    await deviceStore.sendCommand(command);
  } catch (error) {
    showToast('报文发送失败', 'error');
    console.error('最终下发失败:', error);
  }
}

// 发送命令 (入口函数)
async function sendCommand() {
  const isRead = isReadOperation.value;
  const reg = currentRegisterObj.value;

  if (isRead) {
    const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;
    lastSentContext.value = {
      fc: functionCode.value,
      addr: startAddress.value,
      time: Date.now()
    };
    await deviceStore.sendCommand({
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: functionCode.value,
      startAddress: physicalAddress,
      quantity: quantity.value
    });
    return;
  }

  // 写入操作保持之前的确认弹窗逻辑
  const readFC = [ModbusFunctionCode.WRITE_SINGLE_COIL, ModbusFunctionCode.WRITE_MULTIPLE_COILS].includes(functionCode.value)
    ? ModbusFunctionCode.READ_COILS
    : ModbusFunctionCode.READ_HOLDING_REGISTERS;

  pendingWriteInfo.value = {
    regName: reg ? reg.name : '未知寄存器',
    address: startAddress.value,
    newValue: isSingleWrite.value ? String(writeValue.value) : writeValues.value,
    oldValue: '读取中...',
    type: reg?.data_type || 'int16'
  };
  
  isWriteConfirmShow.value = true;

  try {
    await deviceStore.sendCommand({
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: readFC,
      startAddress: useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value,
      quantity: (reg && ['float32', 'int32', 'uint32'].includes(reg.data_type)) ? 2 : (reg?.count || 1)
    });
    setTimeout(() => {
      const lastRes = latestReadResults.value.find(r => r.type === 'summary');
      pendingWriteInfo.value.oldValue = (lastRes && (lastRes as any).text) ? (lastRes as any).text : '无法解析';
    }, 600);
  } catch (err) {
    pendingWriteInfo.value.oldValue = '读取失败';
  }
}

// 解析写入值
function getWriteValues(): number[] | undefined {
  if (isReadOperation.value) return undefined;
  
  const reg = currentRegisterObj.value;

  // 场景 1: 自动模式下的智能转换
  if (runMode.value === 'auto' && reg) {
    const valStr = (isSingleWrite.value ? String(writeValue.value) : writeValues.value.split(',')[0]) || '0';
    const defaultEndian = selectedProfile.value?.data.protocol_summary.default_endian || 'ABCD';
    return encodeValue(valStr, (reg.data_type || 'uint16'), (reg.endian || defaultEndian));
  }

  // 场景 2: 手动模式
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

// --- 自动模式：地址与表单联动逻辑 ---

// 提取公用的地址填充逻辑
function updateAutoAddress() {
  if (runMode.value === 'auto' && currentRegisterObj.value) {
    const reg = currentRegisterObj.value;
    const allowedCodes = normalizeFuncCodes(reg.func_code);
    
    // 智能默认：自动切换到该寄存器支持的第一个功能码
    if (allowedCodes.length > 0) {
      functionCode.value = allowedCodes[0] as ModbusFunctionCode;
    }
    
    const firstCode = allowedCodes[0] ?? functionCode.value;
    // 强制根据目前的 useBase1 状态重新计算
    startAddress.value = getModbusOffset((reg.addr !== undefined ? reg.addr : 0), firstCode, useBase1.value);
    quantity.value = reg.count || 1;
  }
}

// 监听寄存器选择
watch(selectedRegisterName, updateAutoAddress);

// 监听 Base 开关，实时重算地址 (确保 useBase1 已定义)
watch(useBase1, updateAutoAddress);

// 监听多值写入的变化，自动同步数量字段
watch(writeValues, (newVal) => {
  const isMultiWrite = [ModbusFunctionCode.WRITE_MULTIPLE_COILS, ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS].includes(functionCode.value);
  if (isMultiWrite) {
    const vals = newVal.split(',').filter(s => s.trim() !== '');
    quantity.value = vals.length;
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

  // 获取请求时的起始地址与数量：从该 RX *之后* (即时间更早) 的最近一条 TX 中解析
  let physicalStartAddr = 0;
  let requestedQuantity = 0;

  for (let i = lastRxIndex + 1; i < deviceStore.logs.length; i++) {
    const log = deviceStore.logs[i];
    if (log && log.direction === 'tx') {
       const hexs = log.hex.split(' ');
       // Modbus RTU 请求长度通常为 8 字节
       if (hexs.length >= 6) {
         // 请求：Addr_H(2), Addr_L(3), Qty_H(4), Qty_L(5)
         physicalStartAddr = (parseInt(hexs[2] || '0', 16) << 8) | parseInt(hexs[3] || '0', 16);
         requestedQuantity = (parseInt(hexs[4] || '0', 16) << 8) | parseInt(hexs[5] || '0', 16);
       }
       break;
    }
  }

  const results: Array<any> = [];
  
  // 处理保持寄存器/输入寄存器 (03, 04)
  if (lastReadLog.parsed.registers) {
    const allVals = lastReadLog.parsed.registers;
    // 关键修正：只处理请求数量范围内的数据
    const displayVals = requestedQuantity > 0 ? allVals.slice(0, requestedQuantity) : allVals;
    
    let pendingSummary: any = null;

    displayVals.forEach((val: number, index: number) => {
      const currentPhysicalAddr = physicalStartAddr + index;
      const displayAddr = useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;
      
      let matchedReg = null;
      let isFollower = false;

      // 自动模式逻辑
      if (runMode.value === 'auto' && selectedProfile.value && lastReadLog.parsed) {
        const profileData = selectedProfile.value.data;
        const defaultEndian = profileData.protocol_summary?.default_endian || 'ABCD';
        
        // 获取当前请求的功能码上下文 (兼容不同字段名)
        const parsed = lastReadLog.parsed as any;
        const currentFC = parsed.functionCode || parsed.fc || 0;
        
        // 查找是否是新数据点起点
        matchedReg = profileData.registers.find((r: any) => getModbusOffset(r.addr, currentFC, useBase1.value) === currentPhysicalAddr);
        
        // 检查是否是跟随位
        const parentReg = profileData.registers.find((r: any) => {
          const normAddr = getModbusOffset(r.addr, currentFC, useBase1.value);
          return currentPhysicalAddr > normAddr && currentPhysicalAddr < (normAddr + (r.count || 1));
        });

        if (matchedReg) {
          const parsedValue = parseAutoValue(matchedReg, allVals, index, defaultEndian);
          pendingSummary = {
            type: 'summary',
            text: `${matchedReg.name} == ${parsedValue}`,
            triggerAddr: (matchedReg.addr !== undefined ? getModbusOffset(matchedReg.addr, currentFC, useBase1.value) : currentPhysicalAddr) + (matchedReg.count || 1) - 1
          };
        } else if (parentReg) {
          isFollower = true;
        }
      }

      // 压入原始数据行
      results.push({
        type: 'data',
        index: index + 1,
        address: displayAddr,
        value: val,
        decStr: val.toString(),
        hexStr: '0x' + val.toString(16).toUpperCase().padStart(4, '0'),
        binStr: formatBin(val),
        isFollower
      });

      // 检查并在末尾插入总结行
      if (pendingSummary && currentPhysicalAddr === pendingSummary.triggerAddr) {
        results.push(pendingSummary);
        pendingSummary = null;
      }
    });
  }
  
  // 处理线圈/离散输入 (01, 02)
  if (lastReadLog.parsed.coils) {
    const allCoils = lastReadLog.parsed.coils;
    // 关键修正：限制显示数量
    const displayCoils = requestedQuantity > 0 ? allCoils.slice(0, requestedQuantity) : allCoils;
    
    let pendingSummary: any = null;

    displayCoils.forEach((val: boolean, index: number) => {
      const currentPhysicalAddr = physicalStartAddr + index;
      const displayAddr = useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;
      
      let matchedReg = null;
      let isFollower = false;

      // 自动模式逻辑
      if (runMode.value === 'auto' && selectedProfile.value && lastReadLog.parsed) {
        const profileData = selectedProfile.value.data;
        const parsed = lastReadLog.parsed as any;
        const currentFC = parsed.functionCode || parsed.fc || 0;
        
        // 查找匹配
        matchedReg = profileData.registers.find((r: any) => getModbusOffset(r.addr || 0, currentFC, useBase1.value) === currentPhysicalAddr);
        
        // 线圈通常 count 为 1，如果不为 1 处理跟随逻辑
        const parentReg = profileData.registers.find((r: any) => {
          const normAddr = getModbusOffset(r.addr || 0, currentFC, useBase1.value);
          return currentPhysicalAddr > normAddr && currentPhysicalAddr < (normAddr + (r.count || 1));
        });

        if (matchedReg) {
          const parsedValue = parseAutoValue(matchedReg, allCoils, index);
          pendingSummary = {
            type: 'summary',
            text: `${matchedReg.name} == ${parsedValue}`,
            triggerAddr: (matchedReg.addr !== undefined ? getModbusOffset(matchedReg.addr, currentFC, useBase1.value) : currentPhysicalAddr) + (matchedReg.count || 1) - 1
          };
        } else if (parentReg) {
          isFollower = true;
        }
      }

      const strVal = val ? '1' : '0';
      results.push({
        type: 'data',
        index: index + 1,
        address: displayAddr,
        value: val ? 1 : 0,
        decStr: strVal,
        hexStr: val ? 'ON' : 'OFF',
        binStr: strVal,
        isFollower
      });

      if (pendingSummary && currentPhysicalAddr === pendingSummary.triggerAddr) {
        results.push(pendingSummary);
        pendingSummary = null;
      }
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

        <div class="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div class="inline-flex rounded-full bg-slate-100 p-1 shadow-inner items-center gap-1">
            <button
              class="mode-tab"
              :class="{ active: connectionType === 'serial' }"
              @click="connectionType = 'serial'"
            >
              USB 直连
            </button>
            <button
              class="mode-tab mode-tab-gateway"
              :class="{ active: connectionType === 'gateway' }"
              @click="connectionType = 'gateway'"
            >
              WiFi 网关
              <span
                class="gateway-settings-icon"
                @click.stop="openGatewayManager"
                title="管理网关"
              >
                ⚙
              </span>
            </button>
          </div>

          <div class="config-bar">
            <div
              class="config-group flex flex-nowrap items-center gap-2"
              v-if="connectionType === 'gateway'"
            >
              <select
                v-model="selectedGatewayId"
                :disabled="deviceStore.isConnected || !deviceStore.gateways.length"
                class="gateway-select flex-1 min-w-0"
              >
                <option value="" disabled>
                  {{ deviceStore.gateways.length ? '请选择网关' : '暂无网关，点击右侧设置添加' }}
                </option>
                <option
                  v-for="g in deviceStore.gateways"
                  :key="g.id"
                  :value="g.id"
                  :style="{ color: g.status === 'online' ? '#16a34a' : '#9ca3af' }"
                >
                  ● {{ g.name }} ({{ g.host }}:{{ g.port }}){{ typeof g.latency === 'number' ? ` ${g.latency}ms` : '' }}
                </option>
              </select>

              <div class="base-switch">
                <button
                  :class="{ active: deviceStore.gatewayOptions.protocol === 'tcp' }"
                  :disabled="deviceStore.isConnected"
                  @click="deviceStore.updateGatewayOptions({ protocol: 'tcp' }); deviceStore.setModbusMode('tcp')"
                >
                  TCP
                </button>
                <button
                  :class="{ active: deviceStore.gatewayOptions.protocol === 'rtu' }"
                  :disabled="deviceStore.isConnected"
                  @click="deviceStore.updateGatewayOptions({ protocol: 'rtu' }); deviceStore.setModbusMode('rtu')"
                >
                  RTU
                </button>
              </div>

              <template v-if="deviceStore.gatewayOptions.protocol === 'tcp'">
                <input
                  type="text"
                  v-model="deviceStore.gatewayOptions.tcpTarget.ip"
                  :disabled="deviceStore.isConnected"
                  placeholder="设备 IP"
                  class="w-32"
                />
                <input
                  type="number"
                  v-model.number="deviceStore.gatewayOptions.tcpTarget.port"
                  :disabled="deviceStore.isConnected"
                  placeholder="端口"
                  class="w-20"
                />
                <input
                  type="number"
                  v-model.number="deviceStore.gatewayOptions.tcpTarget.unitId"
                  :disabled="deviceStore.isConnected"
                  placeholder="Slave ID"
                  class="w-20"
                />
              </template>

              <template v-else>
                <div class="flex items-center gap-2">
                  <select
                    v-model.number="deviceStore.gatewayOptions.rtuTarget.baudRate"
                    :disabled="deviceStore.isConnected"
                    class="w-28"
                  >
                    <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                      {{ rate }} bps
                    </option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.dataBits"
                    :disabled="deviceStore.isConnected"
                    class="w-24"
                  >
                    <option :value="7">7 数据位</option>
                    <option :value="8">8 数据位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.stopBits"
                    :disabled="deviceStore.isConnected"
                    class="w-24"
                  >
                    <option :value="1">1 停止位</option>
                    <option :value="2">2 停止位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.parity"
                    :disabled="deviceStore.isConnected"
                    class="w-28"
                  >
                    <option value="none">无校验</option>
                    <option value="even">偶校验</option>
                    <option value="odd">奇校验</option>
                  </select>
                </div>
              </template>
            </div>

            <div class="config-group" v-else>
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
              :disabled="deviceStore.isConnecting || (!deviceStore.isSupported && connectionType === 'serial')"
              @click="toggleConnection"
            >
              <span v-if="deviceStore.isConnecting" class="spinner"></span>
              {{ deviceStore.isConnected ? '断开' : '连接' }}
            </button>
          </div>
        </div>
      </div>
      
      <div
        v-if="connectionType === 'gateway' && deviceStore.isConnected && selectedGateway"
        class="info-banner"
      >
        ✅ 已连接网关：
        {{ selectedGateway.name }} ({{ selectedGateway.host }}:{{ selectedGateway.port }})
        ｜ 延迟 {{ gatewayLatencyText }}
        ｜ 目标 {{ gatewayTargetText }}
      </div>
      <div v-if="connectionType === 'serial' && !isSecure" class="error-banner">
        ❌ 检测到非安全上下文。Web Serial API 需要 <strong>HTTPS</strong> 或 <strong>localhost</strong>。不允许使用 IP 地址访问。
      </div>
      <div v-else-if="connectionType === 'serial' && !deviceStore.isSupported" class="warning-banner">
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
        <div class="section-header-row">
          <h2 class="section-title">
            <span class="icon">📡</span>
            {{ modbusCommandTitle }}
            
            <div class="mode-switch-simple">
              <!-- 新增：选择点表按钮 -->
              <button 
                v-if="runMode === 'auto'"
                class="btn-text-action" 
                @click="isProfilePickerShow = true"
                style="margin-right: 12px;"
              >
                {{ selectedProfile ? `🗂️ ${selectedProfile.data.protocol_summary.model}` : '📂 请选择点表...' }}
              </button>

              <span 
                class="mode-opt" 
                :class="{ active: runMode === 'auto' }"
                @click="runMode = 'auto'"
              >自动</span>
              <span class="sep">|</span>
              <span 
                class="mode-opt" 
                :class="{ active: runMode === 'manual' }"
                @click="runMode = 'manual'"
              >手动</span>
            </div>
          </h2>
        </div>
        
        <div class="command-form-horizontal">
          <div class="form-row">
            <div class="form-group">
              <label>从站地址</label>
              <input type="number" v-model="slaveAddress" min="1" max="247" />
            </div>
            
            <div class="form-group">
              <label>功能码</label>
              <select 
                v-model="functionCode" 
                class="function-code-select"
                :disabled="runMode === 'auto' && !selectedRegisterName"
              >
                <option v-if="availableFunctionCodeOptions.length === 0" value="">-- 请先选择寄存器 --</option>
                <option v-for="opt in availableFunctionCodeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <div class="label-with-switch">
                <!-- 自动模式下标题改为：寄存器名称 -->
                <label>{{ runMode === 'auto' ? '寄存器名称' : '起始地址 (Dec)' }}</label>
                
                <div class="base-switch">
                  <button 
                    :class="{ active: !useBase1 }" 
                    @click="setBase(false)"
                    title="从 0 开始计数 (Base 0)"
                  >Base 0</button>
                  <button 
                    :class="{ active: useBase1 }" 
                    @click="setBase(true)"
                    title="从 1 开始计数 (Base 1 / PLC)"
                  >Base 1</button>
                </div>
              </div>
              
              <div class="input-combined">
                <!-- 自动模式：下拉选择 -->
                <select 
                  v-if="runMode === 'auto'" 
                  v-model="selectedRegisterName"
                  class="dec-input-large"
                >
                  <option disabled value="">-- 请选择寄存器 --</option>
                  <option 
                    v-for="reg in selectedProfile?.data.registers" 
                    :key="reg.name" 
                    :value="reg.name"
                  >
                    {{ reg.name }} {{ reg.description ? `(${reg.description})` : '' }}
                  </option>
                </select>

                <!-- 手动模式：数字输入 -->
                <input 
                  v-else
                  type="number" 
                  v-model="startAddress" 
                  :min="useBase1 ? 1 : 0" 
                  max="65535" 
                  class="dec-input-large" 
                />

                <div class="plc-address-display">
                  <span class="label">PLC地址</span>
                  <!-- 自动模式显示点表定义的 addr，手动模式显示计算后的 addr -->
                  <span class="value">{{ runMode === 'auto' && currentRegisterObj ? currentRegisterObj.addr : plcAddress }}</span>
                </div>
              </div>
            </div>
            
            <div v-if="isReadOperation || !isSingleWrite" class="form-group">
                <label>寄存器数量</label>
                <input 
                  type="number" 
                  v-model="quantity" 
                  min="1" 
                  max="125" 
                  :disabled="runMode === 'auto' || !isReadOperation"
                  :title="!isReadOperation ? '在写多个寄存器模式下，数量自动由写入值的个数决定' : ''"
                />
            </div>
            
            <div v-if="isSingleWrite" class="form-group">
                <label>写入值</label>
                <!-- 场景 1: 自动模式且有点表 Mapping -->
                <select 
                  v-if="runMode === 'auto' && currentRegisterObj?.mapping" 
                  v-model.number="writeValue"
                  class="mapping-select"
                >
                  <option v-for="(label, val) in currentRegisterObj.mapping" :key="val" :value="Number(val)">
                    {{ label }} ({{ val }})
                  </option>
                </select>

                <!-- 场景 2: 手动模式或无 Mapping -->
                <input v-else type="number" v-model="writeValue" min="0" max="65535" />
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
                <template v-for="(item, idx) in latestReadResults" :key="idx">
                  <!-- 正常数据行 -->
                  <tr v-if="item.type === 'data' || !item.type">
                    <td class="col-index">{{ item.index }}</td>
                    <td class="col-addr">{{ item.address }}</td>
                    <td class="col-value centered">
                      <div class="value-container">
                        <div class="raw-value">
                          <span v-if="displayFormat === 'dec'" class="val-dec">{{ item.decStr }}</span>
                          <span v-else-if="displayFormat === 'hex'" class="val-hex">{{ item.hexStr }}</span>
                          <span v-else-if="displayFormat === 'bin'" class="val-bin">{{ item.binStr }}</span>
                        </div>
                        <div v-if="runMode === 'auto' && item.isFollower" class="auto-parsed-info">
                          <span class="reg-follower-tag">↑ 延续位</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                  
                  <!-- 解析结果总结行 -->
                  <tr v-else-if="item.type === 'summary'" class="summary-row">
                    <td colspan="3">
                      <div class="summary-content">
                        <span class="summary-icon">💡</span>
                        <span class="summary-text">{{ item.text }}</span>
                      </div>
                    </td>
                  </tr>
                </template>

                <tr v-if="latestReadResults.length === 0">
                  <td colspan="3" class="table-empty">
                    等待读取数据...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div> <!-- closes monitor-grid -->
    </div> <!-- closes panel-body -->

    <div v-if="isGatewayManagerOpen" class="modal-overlay" @click.self="closeGatewayManager">
      <div class="modal-content gateway-manager">
        <div class="modal-header">
          <h3>WiFi 网关管理</h3>
          <button class="btn-close" @click="closeGatewayManager">×</button>
        </div>
        <div class="modal-body gateway-manager-body">
          <div class="gateway-list">
            <div v-if="deviceStore.gateways.length === 0" class="empty-state">
              暂无网关，请在右侧表单中新建。
            </div>
            <div
              v-for="g in deviceStore.gateways"
              :key="g.id"
              class="gateway-item"
              :class="{ active: selectedGatewayId === g.id }"
              @click="handleSelectGatewayInList(g)"
            >
              <span
                class="status-dot"
                :class="g.status === 'online' ? 'online' : 'offline'"
              ></span>
              <div class="g-main">
                <div class="g-name">{{ g.name }}</div>
                <div class="g-sub">
                  {{ g.host }}:{{ g.port }}
                  <span v-if="typeof g.latency === 'number'" class="g-latency">
                    {{ g.latency }}ms
                  </span>
                  <span v-else class="g-latency g-latency-na">--</span>
                </div>
              </div>
              <button
                type="button"
                class="btn-ghost"
                @click.stop="deviceStore.checkGatewayStatus(g.id)"
              >
                检测
              </button>
              <button
                type="button"
                class="btn-ghost danger"
                @click.stop="handleDeleteGateway(g.id)"
              >
                删除
              </button>
            </div>
          </div>
          <div class="gateway-form">
            <div class="form-row">
              <label>名称</label>
              <input
                v-model="gatewayFormName"
                type="text"
                placeholder="例如：车间网关"
              />
            </div>
            <div class="form-row">
              <label>地址(IP 或域名)</label>
              <input
                v-model="gatewayFormHost"
                type="text"
                placeholder="anyport.local 或 192.168.1.10"
              />
            </div>
            <div class="form-row">
              <label>端口</label>
              <input
                v-model.number="gatewayFormPort"
                type="number"
                min="1"
                max="65535"
              />
            </div>
            <div v-if="gatewayFormError" class="gateway-form-error">
              {{ gatewayFormError }}
            </div>
            <div class="form-actions">
              <button type="button" class="btn-secondary" @click="resetGatewayForm()">
                新建
              </button>
              <button type="button" class="btn-primary" @click="submitGatewayForm">
                {{ editingGatewayId ? '保存修改' : '添加网关' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 点表选择弹窗 (简易版) -->
    <div v-if="isProfilePickerShow" class="modal-overlay" @click.self="isProfilePickerShow = false">
      <div class="modal-content profile-picker">
        <div class="modal-header">
          <h3>选择点表设备</h3>
          <button class="btn-close" @click="isProfilePickerShow = false">×</button>
        </div>
        <div class="modal-body">
          <div v-if="profileStore.profiles.length === 0" class="empty-state">
            暂无点表库，请前往“点表管理”创建。
          </div>
          <div 
            v-for="p in profileStore.profiles" 
            :key="p.id" 
            class="profile-item"
            :class="{ active: selectedProfileId === p.id }"
            @click="selectedProfileId = p.id; isProfilePickerShow = false"
          >
            <div class="p-icon">📦</div>
            <div class="p-info">
              <div class="p-title">{{ p.data.protocol_summary.manufacturer }} - {{ p.data.protocol_summary.model }}</div>
              <div class="p-sub">{{ p.data.protocol_summary.series }} | {{ (p.data.registers || []).length }} 个节点</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 写入二次确认弹窗 -->
    <div v-if="isWriteConfirmShow" class="modal-overlay" @click.self="isWriteConfirmShow = false">
      <div class="modal-content confirm-modal">
        <div class="modal-header warning">
          <h3>⚠️ 操作安全确认 (Write Confirm)</h3>
          <button class="btn-close" @click="isWriteConfirmShow = false">×</button>
        </div>
        <div class="modal-body write-preview-body">
          <div class="confirm-message">
            您正在对设备从站 <strong>{{ slaveAddress }}</strong> 执行写入操作。请仔细核对以下参数：
          </div>
          
          <div class="write-info-grid">
            <div class="info-item">
              <label>目标寄存器</label>
              <div class="v">{{ pendingWriteInfo.regName }}</div>
            </div>
            <div class="info-item">
              <label>物理地址</label>
              <div class="v">{{ pendingWriteInfo.address }} (Dec)</div>
            </div>
          </div>

          <div class="value-comparison">
            <div class="val-box old">
              <div class="box-label">当前设备值 (Read)</div>
              <div class="box-val">{{ pendingWriteInfo.oldValue }}</div>
            </div>
            <div class="arrow">➡️</div>
            <div class="val-box new">
              <div class="box-label">计划写入值 (New)</div>
              <div class="box-val highlight">{{ pendingWriteInfo.newValue }}</div>
            </div>
          </div>

          <div class="confirm-warning">
            ⚠️ 警告：写入错误参数可能导致设备运行异常或硬件损坏。
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="isWriteConfirmShow = false">取消操作</button>
          <button class="btn-execute" @click="executeActualWrite">确认下发指令</button>
        </div>
      </div>
    </div>

    <!-- 浮动通知 Toast (移至根目录，确保始终显示) -->
    <Transition name="toast">
      <div v-if="toast.show" class="toast-notification" :class="toast.type">
        <span class="toast-icon">
          {{ toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️' }}
        </span>
        <span class="toast-msg">{{ toast.message }}</span>
      </div>
    </Transition>
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

.mode-tabs {
  display: inline-flex;
  background: var(--color-bg);
  padding: 4px;
  border-radius: var(--radius-md);
  gap: 4px;
}

.mode-tab {
  border: none;
  padding: 4px 10px;
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-tab.active {
  background: var(--color-surface-hover);
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
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

.config-group select,
.config-group input {
  padding: 0.4rem 0.6rem;
  font-size: 0.9rem;
  min-width: 100px;
  height: 2.4rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.gateway-config-box {
  background: rgba(0, 0, 0, 0.02);
  padding: 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.gateway-input {
  min-width: 180px;
}

.gateway-select {
  min-width: 220px;
}

.mode-tab-gateway {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.gateway-settings-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 1rem;
  color: var(--color-text-secondary);
}

.mode-tab-gateway.active .gateway-settings-icon {
  color: var(--color-primary);
}

.gateway-settings-icon:hover {
  background: var(--color-surface-hover);
}

.compact-row {
  justify-content: space-between;
  align-items: flex-end;
}

.gateway-config-box .form-group:first-child {
  flex: 1;
}

.dynamic-params .form-group.small {
  width: 120px;
}

.gateway-config-box input,
.gateway-config-box select {
  height: 32px;
  padding: 0.25rem 0.5rem;
}

.gateway-config-box .base-switch {
  height: 32px;
  align-items: center;
}

.gateway-config-box .base-switch button {
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
}

.gateway-config-box .label-with-switch label {
  width: auto;
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

.info-banner {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: rgba(22, 163, 74, 0.1);
  border: 1px solid rgba(22, 163, 74, 0.4);
  font-size: 0.85rem;
  color: var(--color-text);
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
  align-items: stretch; /* 确保子项等高 */
}

/* 横向命令表单 */
.command-form-horizontal {
  margin-top: 1rem;
  overflow: visible;
}

.form-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem; /* 紧凑间距 12px */
  flex-wrap: nowrap; /* 禁止在宽屏下换行导致剧烈跳动 */
  overflow: visible;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group.grow {
  width: 160px; /* 进一步固定写入值框 */
  flex-shrink: 0;
}

.function-code-select {
  width: 170px; 
}

/* 第三列：名称/地址区，自适应宽度消除外边距 */
.form-group:nth-child(3) {
  width: auto; 
  flex-shrink: 0;
}

/* 从站地址 & 寄存器数量 */
.form-group:first-child,
.form-group:nth-child(4) {
  width: 85px;
  flex-shrink: 0;
}

.form-group label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap; /* 禁止标题换行撑开高度 */
}

.input-combined {
  display: flex;
  gap: 0.4rem; /* 内部超紧凑间距 */
}

.label-with-switch {
  display: flex;
  align-items: center;
  gap: 0.4rem; /* 对应下方的 input-combined 间距 */
}

.label-with-switch label {
  width: 180px; /* 从 140px 增加到 180px，确保“请选择寄存器”显示完整 */
  flex-shrink: 0;
}

.address-meta-col {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
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
  width: 180px; /* 同步扩宽选择框 */
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
  gap: 0.8rem;
  flex: 1; /* 报文预览占据剩余全部空间 */
  min-width: 200px; 
  flex-shrink: 1;
  overflow: visible;
}

.preview-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0; /* 允许内部元素收缩 */
}

.preview-label {
  position: relative; /* 为悬浮窗创建定位上下文 */
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
  color: #7dd3fc;
  font-size: 0.9rem;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  letter-spacing: 0.5px;
  overflow-x: auto; /* 允许长报文横向滚动，不推挤按钮 */
  white-space: nowrap;
}

.btn-send {
  padding: 0 1.5rem;
  height: 2.4rem;
  border-radius: 6px;
  border: none;
  background: var(--color-primary);
  color: white;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  flex-shrink: 0; /* 绝对禁止按钮被挤压 */
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
  min-height: 32px; /* 统一标题行最小高度，解决对齐问题 */
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



/* 强制对齐命令栏高度 */
.command-form-horizontal input,
.command-form-horizontal select,
.plc-address-display,
.preview-value {
  height: 2.4rem; /* 统一高度 */
  font-size: 0.9rem; /* 统一字号 */
  line-height: normal;
  box-sizing: border-box;
  white-space: nowrap; /* 禁止换行 */
}

/* 强制对齐标题栏高度 & 统一字号 */
.form-group label,
.preview-label,
.label-with-switch {
  display: flex !important;
  align-items: center;
  min-height: 1.6rem; /* 关键：强制标签行等高 */
  font-size: 0.85rem !important; /* 关键：统一字号 */
  color: var(--color-text-secondary);
  margin-bottom: 0; /* 消除额外间距干扰 */
}

/* 特殊处理：label-with-switch 内部的 label 不需要再撑开高度，防止双重叠加 */
.label-with-switch label {
  min-height: auto;
}

.mode-switch-simple {
  margin-left: auto; /* 靠右对齐 */
  display: flex;
  align-items: center;
  font-size: 0.85rem;
  font-weight: normal;
  background: var(--color-bg);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  gap: 6px;
}

.mode-switch-simple .mode-opt {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--color-text-secondary);
  transition: all 0.2s;
}

.mode-switch-simple .mode-opt.active {
  background: var(--color-primary);
  color: white;
  font-weight: 500;
}

.mode-switch-simple .sep {
  color: var(--color-border);
  font-size: 0.8rem;
}

.btn-text-action {
  background: transparent;
  border: 1px dashed var(--color-primary);
  color: var(--color-primary);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-text-action:hover {
  background: rgba(102, 126, 234, 0.1);
  border-style: solid;
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
}

.modal-content.profile-picker {
  background: var(--color-surface);
  width: 500px;
  max-height: 80vh;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.modal-header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  border: none;
  padding: 0;
  font-size: 1.1rem;
}

.btn-close {
  background: transparent;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.modal-body {
  padding: 1rem;
  overflow-y: auto;
}

.profile-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 0.5rem;
  border: 1px solid transparent;
}

.profile-item:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border);
}

.profile-item.active {
  background: rgba(102, 126, 234, 0.1);
  border-color: var(--color-primary);
}

.p-icon { font-size: 1.5rem; }
.p-title { font-weight: 600; color: var(--color-text); }
.p-sub { font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 2px; }

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--color-text-secondary);
}

.gateway-manager {
  background: var(--color-surface);
  width: 720px;
  max-height: 80vh;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.gateway-manager-body {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr;
  gap: 1rem;
}

.gateway-list {
  padding-right: 0.5rem;
  border-right: 1px solid var(--color-border);
  max-height: 60vh;
  overflow-y: auto;
}

.gateway-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.gateway-item:hover {
  background: var(--color-surface-hover);
}

.gateway-item.active {
  background: rgba(102, 126, 234, 0.08);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.status-dot.online {
  background: #22c55e;
}

.status-dot.offline {
  background: #9ca3af;
}

.g-main {
  flex: 1;
  min-width: 0;
}

.g-name {
  font-size: 0.9rem;
  font-weight: 600;
}

.g-sub {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

.g-latency {
  margin-left: 6px;
}

.g-latency-na {
  opacity: 0.6;
}

.btn-ghost {
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-ghost:hover {
  background: var(--color-surface-hover);
}

.btn-ghost.danger {
  color: var(--color-error);
}

.gateway-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.gateway-form .form-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.gateway-form label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.gateway-form input {
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  font-size: 0.9rem;
}

.gateway-form-error {
  font-size: 0.8rem;
  color: var(--color-error);
}

.gateway-form .form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 0.5rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-primary {
  background: var(--color-primary);
  border: none;
  color: white;
  padding: 0.5rem 1.2rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.auto-parsed-info {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--color-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.reg-name-tag {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

.reg-follower-tag {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  font-style: italic;
  opacity: 0.6;
}

.value-container {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

/* 总结行样式 */
.summary-row {
  background: rgba(var(--color-primary-rgb), 0.05);
}

.summary-row td {
  padding: 6px 12px !important;
  border-bottom: 1px solid var(--color-border);
}

.summary-content {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.summary-icon {
  font-size: 1rem;
}

.summary-text {
  font-weight: 600;
  color: var(--color-primary);
  font-size: 0.95rem;
  letter-spacing: 0.5px;
}
.modal-header.warning {
  background: rgba(245, 166, 35, 0.1);
  border-bottom: 2px solid #f5a623;
}

.modal-content.confirm-modal {
  width: 550px;
  background: var(--color-surface);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 30px 60px rgba(0,0,0,0.7);
}

.write-preview-body {
  padding: 1.5rem;
}

.confirm-message {
  font-size: 0.95rem;
  margin-bottom: 1.5rem;
  color: var(--color-text-secondary);
}

.write-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  background: var(--color-bg);
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.info-item label {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  display: block;
  margin-bottom: 4px;
}
.info-item .v {
  font-weight: 700;
  font-size: 1rem;
  color: var(--color-primary);
}

.value-comparison {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.val-box {
  flex: 1;
  padding: 1rem;
  border-radius: 10px;
  text-align: center;
  border: 1px solid var(--color-border);
}

.val-box.old { background: rgba(255, 255, 255, 0.02); }
.val-box.new { background: rgba(102, 126, 234, 0.05); border-color: var(--color-primary); }

.box-label { font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 8px; }
.box-val { font-family: 'Consolas', monospace; font-size: 1.4rem; font-weight: 700; }
.box-val.highlight { color: #facc15; }

.arrow { font-size: 2rem; opacity: 0.5; }

.confirm-warning {
  padding: 10px;
  background: rgba(245, 87, 108, 0.1);
  color: var(--color-error);
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  border: 1px dashed var(--color-error);
}

.modal-footer {
  padding: 1rem 1.5rem;
  background: var(--color-bg);
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  padding: 0.6rem 1.2rem;
  border-radius: 6px;
  cursor: pointer;
}

.btn-execute {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: 0.6rem 2rem;
  border-radius: 6px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.btn-execute:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}
/* Toast 通知 */
.toast-notification {
  position: fixed;
  top: 2rem;
  right: 2rem;
  padding: 0.8rem 1.5rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  z-index: 99999;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  min-width: 200px;
}

.toast-notification.success {
  background: rgba(16, 185, 129, 0.9);
  color: white;
}

.toast-notification.error {
  background: rgba(239, 68, 68, 0.9);
  color: white;
}

.toast-notification.info {
  background: rgba(59, 130, 246, 0.9);
  color: white;
}

.toast-icon { font-size: 1.2rem; }
.toast-msg { font-weight: 500; font-size: 0.95rem; }

/* Toast 动画 */
.toast-enter-active, .toast-leave-active {
  transition: all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(50px) scale(0.9);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}
</style>
