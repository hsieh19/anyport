<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue';
import { useDeviceStore, type ConnectionType } from '@/stores/deviceStore';
import { useProfileStore } from '@/stores/profileStore'; 
import { ModbusFunctionCode, MODBUS_FUNCTION_CODE_OPTIONS, normalizeFuncCodes, getModbusOffset, encodeValue, parseAutoValue, getExtendedValue } from '@/protocols/modbus';
import type { ModbusRtuCommand } from '@/protocols/modbus';
import { bytesToHexSpaced } from '@/utils/hex';
import { ProtocolType } from '@shared/types/protocol.types';
import MqttConfigDialog from './MqttConfigDialog.vue';
import GatewayManagerDialog from './GatewayManagerDialog.vue';
import ModbusProfilePicker from './ModbusProfilePicker.vue';

const deviceStore = useDeviceStore();
const profileStore = useProfileStore();
const isSecure = window.isSecureContext;

// MQTT Broker 连接/断开
async function toggleBrokerConnection() {
  if (deviceStore.isMqttBrokerConnected) {
    await deviceStore.disconnectBroker();
  } else {
    await deviceStore.connectMqttBroker();
  }
}

// 初始化加载点表并设置协议
onMounted(() => {
  if (profileStore.profiles.length === 0) {
    profileStore.loadProfiles();
  }
  // 切换到 Modbus 调试时，恢复之前保存的 modbusMode 及相关状态
  deviceStore.setModbusMode(deviceStore.modbusMode);
});

onActivated(() => {
  deviceStore.setModbusMode(deviceStore.modbusMode);
});


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

// 手动模式：数据类型
const manualDataType = ref('uint16');
const manualDataTypeOptions = [
  { label: 'uint16 (16位无符号)', value: 'uint16' },
  { label: 'int16 (16位有符号)', value: 'int16' },
  { label: 'uint32 (32位无符号)', value: 'uint32' },
  { label: 'int32 (32位有符号)', value: 'int32' },
  { label: 'float32 (32位浮点)', value: 'float32' },
  { label: 'String (字符串)', value: 'string' },
  { label: 'Coil/Bit (线圈/位)', value: 'coil' }
];

const manualEndian = ref('ABCD');
const endianOptions = [
  { label: 'ABCD (大端)', value: 'ABCD' },
  { label: 'CDAB (字交换)', value: 'CDAB' },
  { label: 'BADC (字节交换)', value: 'BADC' },
  { label: 'DCBA (小端)', value: 'DCBA' }
];




const showMqttDialog = ref(false);
const showGatewayManager = ref(false);
const selectedGatewayId = ref('');

const tcpEndpoint = computed({
  get: () => {
    const target = deviceStore.gatewayOptions.tcpTarget;
    if (!target.ip && !target.port) return '';
    return target.port ? `${target.ip}:${target.port}` : target.ip;
  },
  set: (value: string) => {
    const raw = value.trim();
    const current = deviceStore.gatewayOptions.tcpTarget;
    if (!raw) {
      deviceStore.updateGatewayOptions({
        tcpTarget: {
          ...current,
          ip: '',
          port: current.port
        }
      });
      return;
    }
    const [ipPart, portPart] = raw.split(':');
    const parsedPort = portPart ? Number(portPart) : current.port;
    deviceStore.updateGatewayOptions({
      tcpTarget: {
        ...current,
        ip: ipPart.trim(),
        port: Number.isFinite(parsedPort) ? parsedPort : current.port
      }
    });
  }
});

const connectionType = computed<ConnectionType>({
  get: () => deviceStore.connectionType,
  set: (value: ConnectionType) => {
    deviceStore.setConnectionType(value);
    if (value === 'serial') {
      deviceStore.setModbusMode('rtu');
    } else if (value === 'mqtt') {
      deviceStore.setModbusMode(deviceStore.gatewayOptions.protocol);
    }
  }
});

const onlineGateways = computed(() =>
  deviceStore.gateways.filter(g => g.online)
);

// 当前输入框配置对应的网关对象（用于状态指示器）
const currentGateway = computed(() => {
  const { siteId, gatewayId } = deviceStore.mqttConfig;
  if (!siteId || !gatewayId) return null;
  return deviceStore.gateways.find(g => g.siteId === siteId && g.gatewayId === gatewayId) ?? null;
});

// 根据 Site ID 输入筛选网关列表
const filteredGateways = computed(() => {
  const filterSite = (deviceStore.mqttConfig.siteId || '').trim().toLowerCase();
  
  // 如果没有输入筛选条件，显示所有网关
  if (!filterSite) return deviceStore.gateways;

  // 只要 Site ID 包含输入内容即匹配
  return deviceStore.gateways.filter(g => 
    g.siteId.toLowerCase().includes(filterSite)
  );
});

// 网关状态 tooltip 文案
const gatewayTooltip = computed(() => {
  const gw = currentGateway.value;
  if (!gw?.online) return '未发现网关或离线';

  const parts: string[] = ['在线'];

  if (gw.config?.version) parts.push(`v${gw.config.version}`);
  if (deviceStore.gatewayOptions.protocol === 'tcp') {
    if (gw.config?.ethIp) parts.push(`ETH: ${gw.config.ethIp}`);
  } else {
    if (gw.config?.baud) {
      const p = gw.config.parity === 'even' ? 'E' : gw.config.parity === 'odd' ? 'O' : 'N';
      const s = gw.config.stopBits ?? 1;
      parts.push(`${gw.config.baud}-8${p}${s}`);
    }
  }
  if (gw.config?.wifiIp) parts.push(`WiFi: ${gw.config.wifiIp}`);

  return parts.join(' | ');
});

watch(
  () => deviceStore.mqttConfig,
  config => {
    // store 变化时，尝试匹配已发现的网关，同步下拉框选中状态
    if (config.siteId && config.gatewayId) {
      const matched = `${config.siteId}/${config.gatewayId}`;
      const exists = onlineGateways.value.some(g => g.id === matched);
      selectedGatewayId.value = exists ? matched : '';
    } else {
      selectedGatewayId.value = '';
    }
  },
  { deep: true, immediate: true }
);

// 从下拉列表选择网关时，自动填充 siteId / gatewayId 到 store
watch(selectedGatewayId, value => {
  if (!value) return;
  const parts = value.split('/');
  if (parts.length !== 2) return;
  const [siteId, gatewayId] = parts;
  // 仅当值真正变化时才写入，避免与上方 watch 循环触发
  if (deviceStore.mqttConfig.siteId !== siteId || deviceStore.mqttConfig.gatewayId !== gatewayId) {
    deviceStore.saveMqttConfig({ siteId, gatewayId });
  }
});

const modbusCommandTitle = computed(() =>
  deviceStore.modbusMode === 'rtu' ? 'Modbus RTU 命令' : 'Modbus TCP 命令'
);

// 根据运行模式和选中的寄存器，动态过滤可用的功能码
const availableFunctionCodeOptions = computed(() => {
  if (runMode.value === 'manual') {
    return MODBUS_FUNCTION_CODE_OPTIONS;
  }
  
  // 自动模式下：未选择点表或未选择寄存器，则没有可选功能码
  if (!selectedProfile.value || !selectedRegisterName.value || !currentRegisterObj.value) {
    return [];
  }
  
  const allowed = normalizeFuncCodes(currentRegisterObj.value.func_code);
  return MODBUS_FUNCTION_CODE_OPTIONS.filter(opt => allowed.includes(opt.value));
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
  if (deviceStore.isModbusConnected) {
    if (connectionType.value === 'mqtt') {
      // MQTT 模式：断开网关连接，保持 Broker 连接以继续发现网关
      await deviceStore.disconnectGateway();
    } else {
      await deviceStore.disconnect();
    }
    return;
  }

  if (connectionType.value === 'mqtt') {
    const opts = deviceStore.mqttConfig;
    if (!opts.brokerUrl || !opts.topicPrefix || !opts.siteId || !opts.gatewayId) {
      triggerAlert('请填写完整的 MQTT 配置信息：Broker URL、Topic Prefix、Site ID、Gateway ID。');
      return;
    }
    await deviceStore.connectMqtt();
    return;
  }


  await deviceStore.connect();
}

function togglePing() {
  if (deviceStore.isPinging) {
    deviceStore.stopPing();
  } else {
    deviceStore.startPing();
  }
}

// --- 写入确认逻辑 ---
const isWriteConfirmShow = ref(false);
const pendingWriteInfo = ref({
  regName: '',
  address: 0,
  newValue: '',
  oldValue: '读取中...',
  type: ''
});

// 区块写入弹窗状态 (Block Write)
const isBlockWriteShow = ref(false);
const isBlockLoading = ref(false);
const currentBlockReg = ref<any>(null);
const blockFieldValues = ref<Record<string, any>>({});

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
watch(() => deviceStore.modbusLogs.length, () => {
  const latestLog = deviceStore.modbusLogs[0];
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
      const unlockPhysicalAddr = getModbusOffset(String(unlockTargetReg.addr || 0), String(ModbusFunctionCode.WRITE_SINGLE_REGISTER));
      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: slaveAddress.value,
        functionCode: ModbusFunctionCode.WRITE_SINGLE_REGISTER,
        startAddress: unlockPhysicalAddr,
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
    addr: physicalAddress, 
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

  const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;

  // 优先处理区块写入逻辑 (仅在非读取操作时触发)
  if (!isRead && runMode.value === 'auto' && (reg?.data_type as string) === 'block') {
    openBlockWriteDialog(reg);
    return;
  }

  if (isRead) {
    lastSentContext.value = {
      fc: functionCode.value,
      addr: physicalAddress,
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
      startAddress: physicalAddress,
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

// 打开区块写入对话框
async function openBlockWriteDialog(reg: any) {
  currentBlockReg.value = reg;
  // 初始化字段值（清空上一次）
  blockFieldValues.value = {};
  reg.block_fields.forEach((f: any) => {
    blockFieldValues.value[f.name] = undefined;
  });
  
  isBlockWriteShow.value = true;

  // 1. 判断是否支持预读 (需包含 0x03 或 0x04)
  const allowedCodes = normalizeFuncCodes(reg.func_code);
  const canRead = allowedCodes.includes(ModbusFunctionCode.READ_HOLDING_REGISTERS) || 
                  allowedCodes.includes(ModbusFunctionCode.READ_INPUT_REGISTERS);

  if (!canRead) {
    console.log(`[Modbus] 区块 ${reg.name} 不支持读取，跳过预读环节`);
    isBlockLoading.value = false;
    return;
  }

  isBlockLoading.value = true;

  try {
    const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;
    const readFC = allowedCodes.includes(ModbusFunctionCode.READ_INPUT_REGISTERS) 
      ? ModbusFunctionCode.READ_INPUT_REGISTERS 
      : ModbusFunctionCode.READ_HOLDING_REGISTERS;

    // 发送读取命令
    await deviceStore.sendCommand({
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: readFC,
      startAddress: physicalAddress,
      quantity: reg.count || 1
    });
    
    // 延迟一会尝试从解析结果中提取初值
    setTimeout(() => {
      syncBlockValues();
    }, 800);
  } catch (e) {
    console.error('区块预读启动失败:', e);
    showToast('区块初始值读取失败，请手动填写', 'info');
    isBlockLoading.value = false;
  }
}

// 从最近读取日志同步到区块表单
function syncBlockValues() {
  if (!currentBlockReg.value || !isBlockWriteShow.value) return;
  const reg = currentBlockReg.value;
  
  try {
    // 查找最近一个 RX 包含对应区块起始地址的日志
    const lastRx = deviceStore.modbusLogs.find(log => 
      log.direction === 'rx' && 
      log.parsed && 
      log.parsed.registers
    );

    if (!lastRx || !lastRx.parsed.registers) return;
    
    const allVals = lastRx.parsed.registers;
    const defaultEndian = selectedProfile.value?.data.protocol_summary?.default_endian || 'ABCD';
    
    reg.block_fields.forEach((f: any) => {
      const subOffset = f.offset || 0;
      // 使用 getExtendedValue 重新解析子项
      const rawValue = getExtendedValue(allVals, subOffset, f.data_type || 'uint16', f.endian || defaultEndian);
      if (rawValue !== null) {
        blockFieldValues.value[f.name] = rawValue;
      }
    });
  } finally {
    isBlockLoading.value = false;
  }
}

// 执行区块一键写入
async function executeBlockWrite() {
  if (!currentBlockReg.value) return;
  const reg = currentBlockReg.value;
  const count = reg.count || 1;
  const payload = new Array(count).fill(0);
  const defaultEndian = selectedProfile.value?.data.protocol_summary?.default_endian || 'ABCD';

  try {
    // 对每个字段进行编码并填入 Payload 数组
    reg.block_fields.forEach((f: any) => {
      const userVal = blockFieldValues.value[f.name];
      if (userVal === undefined || userVal === null) return;
      
      const encoded = encodeValue(String(userVal), f.data_type || 'uint16', f.endian || defaultEndian);
      const subOffset = f.offset || 0;
      encoded.forEach((word, wordIndex) => {
        if (subOffset + wordIndex < count) {
          payload[subOffset + wordIndex] = word;
        }
      });
    });

    const physicalAddress = useBase1.value ? Math.max(0, startAddress.value - 1) : startAddress.value;
    
    // 记录上下文
    lastSentContext.value = {
      fc: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS,
      addr: physicalAddress, 
      time: Date.now()
    };

    await deviceStore.sendCommand({
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: slaveAddress.value,
      functionCode: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS,
      startAddress: physicalAddress,
      quantity: count,
      values: payload
    });

    isBlockWriteShow.value = false;
  } catch (e) {
    showToast('区块写入下发失败', 'error');
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
  if (isReadOperation.value) return undefined;

  const defaultEndian = selectedProfile.value?.data.protocol_summary.default_endian || 'ABCD';
  const type = runMode.value === 'auto' ? (reg?.data_type || 'uint16') : manualDataType.value;
  const endian = runMode.value === 'auto' ? (reg?.endian || defaultEndian) : manualEndian.value;

  if (isSingleWrite.value) {
    return encodeValue(String(writeValue.value), type, endian);
  }

  // 多值写入
  if (type === 'string') {
    // 字符串处理：将整个输入框作为单一原文
    const text = writeValues.value;
    const bytes = new TextEncoder().encode(text);
    const buf = new Uint8Array(quantity.value * 2); // 根据设定的寄存器数量分配空间
    buf.set(bytes.slice(0, quantity.value * 2));
    
    const regs = [];
    for (let i = 0; i < buf.length; i += 2) {
      regs.push((buf[i] << 8) | (buf[i+1]));
    }
    return regs;
  }

  // 数字列表 (逗号分隔)
  const valStrs = writeValues.value.split(',').filter(s => s.trim() !== '');
  let allRegs: number[] = [];
  valStrs.forEach(s => {
    const encoded = encodeValue(s.trim(), type, endian);
    allRegs = allRegs.concat(encoded);
  });
  return allRegs;
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
  const addr = startAddress.value;
  
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
    
    if (allowedCodes.length > 0 && !allowedCodes.includes(functionCode.value)) {
      functionCode.value = allowedCodes[0] as ModbusFunctionCode;
    }
    
    // 逻辑偏移量：仅剥离 4xxxx 前缀 (如 40025 -> 25)
    startAddress.value = getModbusOffset((reg.addr !== undefined ? reg.addr : 0), functionCode.value);
    quantity.value = reg.count || 1;
  }
}

// 监听寄存器选择
watch(selectedRegisterName, updateAutoAddress);

// 监听 Base 开关，实时重算地址 (确保 useBase1 已定义)
watch(useBase1, updateAutoAddress);

// 监听多值写入/手动模式类型变化，自动同步数量字段
watch([writeValues, manualDataType, runMode, functionCode], () => {
  const isMultiWrite = [ModbusFunctionCode.WRITE_MULTIPLE_COILS, ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS].includes(functionCode.value);
  if (!isMultiWrite) return;

  if (runMode.value === 'auto') {
    // 如果是区块类型，数量严格锁定为点表定义，不根据输入框推算
    if ((currentRegisterObj.value?.data_type as string) === 'block') {
      quantity.value = currentRegisterObj.value?.count || 1;
      return;
    }
    const vals = writeValues.value.split(',').filter(s => s.trim() !== '');
    quantity.value = vals.length;
  } else {
    // 手动模式支持 String 和 32位数据
    if (manualDataType.value === 'string') {
      // String 模式下，quantity 由用户手动微调，此处不自动改写，避免干扰输入
      return;
    }
    const vals = writeValues.value.split(',').filter(s => s.trim() !== '');
    const multiplier = ['float32', 'int32', 'uint32'].includes(manualDataType.value) ? 2 : 1;
    quantity.value = vals.length * multiplier;
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
    
    // 使用 adapter 编码 (优先使用无副作用的预览方法)
    const ad: any = deviceStore.adapter;
    const frame = typeof ad.preview === 'function' 
      ? ad.preview(command) 
      : ad.encode(command);
    return bytesToHexSpaced(frame as Uint8Array);
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
  if (hexs.length < 2) return [];

  const parts: any[] = [];
  const mode = deviceStore.modbusMode;

  if (mode === 'tcp') {
    // --- Modbus TCP 解析 (MBAP Header 7 bytes) ---
    if (hexs.length >= 2) parts.push({ name: '事务标识符', value: `${hexs[0]} ${hexs[1]}` });
    if (hexs.length >= 4) parts.push({ name: '协议标识符', value: `${hexs[2]} ${hexs[3]}` });
    if (hexs.length >= 6) parts.push({ name: '后续长度', value: `${hexs[4]} ${hexs[5]}` });
    if (hexs.length >= 7) parts.push({ name: '单元 ID (站号)', value: hexs[6] });

    // PDU 部分从第 7 字节开始
    const pdu = hexs.slice(7);
    if (pdu.length > 0) {
      const fnCode = parseInt(pdu[0] || '0', 16);
      parts.push({ name: '功能码', value: pdu[0] });

      if (isRx && fnCode > 0x80) {
        parts.push({ name: '状态', value: '异常响应' });
        if (pdu.length >= 2) parts.push({ name: '异常代码', value: pdu[1] });
      } else {
        // 请求或正常响应
        if (isRx) {
          if ([0x01, 0x02, 0x03, 0x04].includes(fnCode)) {
            if (pdu.length >= 2) parts.push({ name: '字节计数', value: pdu[1] });
            if (pdu.length >= 3) parts.push({ name: '数据内容', value: pdu.slice(2).join(' ') });
          } else {
            if (pdu.length >= 3) parts.push({ name: '起始地址', value: `${pdu[1]} ${pdu[2]}` });
            if (pdu.length >= 5) parts.push({ name: '数量/数值', value: `${pdu[3]} ${pdu[4]}` });
          }
        } else {
          // TX
          if (pdu.length >= 3) parts.push({ name: '起始地址', value: `${pdu[1]} ${pdu[2]}` });
          if (pdu.length >= 5) parts.push({ name: isRead ? '寄存器数量' : '写入值', value: `${pdu[3]} ${pdu[4]}` });
          if (!isRead && pdu.length > 5) {
             if (pdu.length >= 6) parts.push({ name: '字节计数', value: pdu[5] });
             if (pdu.length >= 7) parts.push({ name: '数据内容', value: pdu.slice(6).join(' ') });
          }
        }
      }
    }
  } else {
    // --- Modbus RTU 解析 ---
    parts.push({ name: '从站地址', value: hexs[0] || '--' });
    
    const fnCode = parseInt(hexs[1] || '0', 16);
    parts.push({ name: '功能码', value: hexs[1] || '--' });
    
    // 异常响应处理
    if (isRx && fnCode > 0x80) {
      parts.push({ name: '状态', value: '异常响应' });
      if (hexs.length >= 3) parts.push({ name: '异常代码', value: hexs[2] });
    } else {
      if (isRx) {
        if ([0x01, 0x02, 0x03, 0x04].includes(fnCode)) {
          if (hexs.length >= 3) parts.push({ name: '字节计数', value: hexs[2] });
          const data = hexs.slice(3, hexs.length - 2);
          if (data.length > 0) parts.push({ name: '数据内容', value: data.join(' ') });
        } else {
          if (hexs.length >= 4) parts.push({ name: '起始地址', value: `${hexs[2]} ${hexs[3]}` });
          if (hexs.length >= 6) parts.push({ name: '数值', value: `${hexs[4]} ${hexs[5]}` });
        }
      } else {
        // TX
        if (hexs.length >= 6) {
          parts.push({ name: '起始地址', value: `${hexs[2]} ${hexs[3]}` });
          parts.push({ name: isRead ? '寄存器数量' : '写入值', value: `${hexs[4]} ${hexs[5]}` });
        }
        if (!isRead && hexs.length > 8) {
          parts.push({ name: '字节计数', value: hexs[6] });
          const data = hexs.slice(7, hexs.length - 2);
          if (data.length > 0) parts.push({ name: '数据内容', value: data.join(' ') });
        }
      }
    }

    // RTU 需要显示 CRC
    if (hexs.length >= 2) {
      const crc = hexs.slice(-2);
      parts.push({ name: 'CRC 校验', value: `${crc[0]} ${crc[1]}` });
    }
  }
  
  return parts;
}

// 辅助：判断是否是读取操作 (针对日志解析)
function isReadTx(hex: string): boolean {
  const parts = hex.split(' ');
  const mode = deviceStore.modbusMode;
  // TCP 模式下功能码在第7个字节 (索引7)，RTU 模式下在第1个字节 (索引1)
  const fcIndex = mode === 'tcp' ? 7 : 1;
  if (parts.length <= fcIndex) return true;
  const fn = parseInt(parts[fcIndex] || '0', 16);
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
  const lastRxIndex = deviceStore.modbusLogs.findIndex(log => 
    log.direction === 'rx' && 
    log.parsed && 
    !log.parsed.error &&
    (log.parsed.registers || log.parsed.coils)
  );

  if (lastRxIndex === -1) return [];
  const lastReadLog = deviceStore.modbusLogs[lastRxIndex];
  if (!lastReadLog || !lastReadLog.parsed) return [];

  // 获取请求时的起始地址与数量：从该 RX *之后* (即时间更早) 的最近一条 TX 中解析
  let physicalStartAddr = 0;
  let requestedQuantity = 0;

  for (let i = lastRxIndex + 1; i < deviceStore.modbusLogs.length; i++) {
    const log = deviceStore.modbusLogs[i];
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
        matchedReg = profileData.registers.find((r: any) => {
          const logicOffsetFromProfile = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffsetFromProfile - 1) : logicOffsetFromProfile;
          const isMatchAddr = expectedPhysicalAddr === currentPhysicalAddr;
          const isMatchFC = normalizeFuncCodes(r.func_code).includes(currentFC);
          
          // 如果是位聚合模式，只要地址匹配且功能码匹配即可作为起点 (即使它可能覆盖多个位)
          if (r.data_type === 'bits') {
             return isMatchAddr && isMatchFC;
          }
          
          return isMatchAddr && isMatchFC;
        });
        
        // 检查是否是跟随位
        const parentReg = profileData.registers.find((r: any) => {
          const logicOffsetFromProfile = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffsetFromProfile - 1) : logicOffsetFromProfile;
          const isMatchFC = normalizeFuncCodes(r.func_code).includes(currentFC);
          return isMatchFC && currentPhysicalAddr > expectedPhysicalAddr && currentPhysicalAddr < (expectedPhysicalAddr + (r.count || 1));
        });

        if (matchedReg) {
          const parsedValue = parseAutoValue(matchedReg, allVals, index, defaultEndian);
          const logicOffset = getModbusOffset(matchedReg.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
          pendingSummary = {
            type: 'summary',
            text: `${matchedReg.name} == ${parsedValue}`,
            triggerAddr: expectedPhysicalAddr + (matchedReg.count || 1) - 1
          };
        } else if (parentReg) {
          isFollower = true;
        }
      } 
      // 手动模式解析逻辑：根据用户选中的数据类型进行自动汇总显示
      else if (runMode.value === 'manual') {
        const type = manualDataType.value;
        const endian = manualEndian.value;
        const count = ['float32', 'int32', 'uint32'].includes(type) ? 2 : 1;
        
        // 判断当前索引是否是解析起点 (例如 32 位数据每 2 个寄存器解析一次)
        if (index % count === 0 && index + count <= displayVals.length) {
          const virtualReg = { data_type: type, endian: endian, count: count };
          const parsedValue = parseAutoValue(virtualReg, allVals, index, endian);
          pendingSummary = {
            type: 'summary',
            text: `解析结果 (${type}) == ${parsedValue}`,
            triggerAddr: currentPhysicalAddr + count - 1
          };
        } else if (index % count !== 0) {
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
        matchedReg = profileData.registers.find((r: any) => {
          const logicOffsetFromProfile = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffsetFromProfile - 1) : logicOffsetFromProfile;
          const isMatchAddr = expectedPhysicalAddr === currentPhysicalAddr;
          const isMatchFC = normalizeFuncCodes(r.func_code).includes(currentFC);
          return isMatchAddr && isMatchFC;
        });
        
        // 线圈通常 count 为 1，如果不为 1 处理跟随逻辑
        const parentReg = profileData.registers.find((r: any) => {
          const logicOffsetFromProfile = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffsetFromProfile - 1) : logicOffsetFromProfile;
          const isMatchFC = normalizeFuncCodes(r.func_code).includes(currentFC);
          return isMatchFC && currentPhysicalAddr > expectedPhysicalAddr && currentPhysicalAddr < (expectedPhysicalAddr + (r.count || 1));
        });

        if (matchedReg) {
          const parsedValue = parseAutoValue(matchedReg, allCoils, index);
          const logicOffset = getModbusOffset(matchedReg.addr || 0, currentFC);
          const expectedPhysicalAddr = useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
          pendingSummary = {
            type: 'summary',
            text: `${matchedReg.name} == ${parsedValue}`,
            triggerAddr: expectedPhysicalAddr + (matchedReg.count || 1) - 1
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
    <MqttConfigDialog
      :show="showMqttDialog"
      @update:show="val => (showMqttDialog = val)"
    />
    <GatewayManagerDialog
      :show="showGatewayManager"
      @update:show="val => (showGatewayManager = val)"
    />
    <ModbusProfilePicker
      :show="isProfilePickerShow"
      @update:show="val => (isProfilePickerShow = val)"
      @select="id => (selectedProfileId = id)"
    />
    
    <!-- 顶部连接配置区 -->
    <section class="panel-section header-section">
      <div class="header-row">
        <div class="header-left-col">
          <h2 class="section-title">
            <span class="icon">🔌</span>
            连接配置
          </h2>
          <!-- 状态摘要（移动到此处） -->
          <div v-if="connectionType === 'mqtt'" class="header-status-summary">
            <div class="status-row">
              <span
                class="status-dot"
                :class="deviceStore.isMqttBrokerConnected ? 'dot-on' : 'dot-off'"
              ></span>
              <span class="status-label">Broker</span>
              <span>
                : {{ deviceStore.isMqttBrokerConnected ? '已连接' : '未连接' }}
              </span>
            </div>
            <div class="status-row cursor-help" :title="currentGateway?.online ? gatewayTooltip : ''">
              <span class="status-dot" :class="currentGateway?.online ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">网关</span>
              <span>: {{ currentGateway?.online ? '在线' : '离线' }}</span>
            </div>
          </div>
        </div>

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
              class="mode-tab"
              :class="{ active: connectionType === 'mqtt' }"
              @click="connectionType = 'mqtt'"
            >
              <span>Remote MQTT</span>
              <span
                class="ml-1 cursor-pointer"
                @click.stop="
                  connectionType = 'mqtt';
                  showMqttDialog = true;
                "
              >
                ⚙
              </span>
            </button>
          </div>

          <div class="config-bar">
            <div
              class="config-group flex flex-wrap md:flex-nowrap items-center gap-2 flex-1"
              v-if="connectionType === 'mqtt'"
            >
              <!-- 网关下拉 + 管理按钮 -->
              <div class="gateway-select-wrap">
                <select
                  v-model="selectedGatewayId"
                  :disabled="deviceStore.isModbusConnected || deviceStore.gateways.length === 0"
                  class="gateway-select"
                >
                  <option value="" disabled v-if="deviceStore.gateways.length === 0">
                    未发现网关
                  </option>
                  <option value="" v-else>
                    手动指定网关
                  </option>
                  <option
                    v-for="g in filteredGateways"
                    :key="g.id"
                    :value="`${g.siteId}/${g.gatewayId}`"
                    :disabled="!g.online"
                  >
                    {{ g.online ? '●' : '○' }} {{ g.siteId }} / {{ g.gatewayId }}{{ g.online ? '' : ' (离线)' }}
                  </option>
                </select>

                <!-- 管理按钮：有网关时显示 -->
                <button
                  v-if="deviceStore.gateways.length > 0"
                  class="btn-manage-gateways"
                  title="管理网关列表"
                  @click="showGatewayManager = true"
                >
                  ⚙
                </button>
              </div>

              <!-- 网关在线状态指示器 + Site ID / Gateway ID 输入框 -->
              <div class="gateway-id-inputs">
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="deviceStore.isModbusConnected"
                  :value="deviceStore.mqttConfig.siteId"
                  placeholder="Site ID"
                  @input="(e) => {
                    deviceStore.saveMqttConfig({ siteId: (e.target as HTMLInputElement).value });
                    selectedGatewayId = '';
                  }"
                />
                <span class="gateway-id-sep">/</span>
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="deviceStore.isModbusConnected"
                  :value="deviceStore.mqttConfig.gatewayId"
                  placeholder="Gateway ID"
                  @input="(e) => {
                    deviceStore.saveMqttConfig({ gatewayId: (e.target as HTMLInputElement).value });
                    selectedGatewayId = '';
                  }"
                />
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div class="base-switch">
                  <button
                    :class="{ active: deviceStore.gatewayOptions.protocol === 'rtu' }"
                    :disabled="deviceStore.isModbusConnected"
                    @click="
                      deviceStore.updateGatewayOptions({ protocol: 'rtu' });
                      deviceStore.setModbusMode('rtu');
                    "
                  >
                    RTU
                  </button>
                  <button
                    :class="{ active: deviceStore.gatewayOptions.protocol === 'tcp' }"
                    :disabled="deviceStore.isModbusConnected"
                    @click="
                      deviceStore.updateGatewayOptions({ protocol: 'tcp' });
                      deviceStore.setModbusMode('tcp');
                    "
                  >
                    TCP
                  </button>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-1 min-w-[220px]">
                <template v-if="deviceStore.gatewayOptions.protocol === 'tcp'">
                  <input
                    type="text"
                    v-model="tcpEndpoint"
                    :disabled="deviceStore.isModbusConnected"
                    placeholder="IP:Port"
                    class="flex-1"
                  />
                </template>

                <template v-else>
                  <select
                    v-model.number="deviceStore.gatewayOptions.rtuTarget.baudRate"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-28"
                  >
                    <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                      {{ rate }} bps
                    </option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.dataBits"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-20"
                  >
                    <option :value="7">7 数据位</option>
                    <option :value="8">8 数据位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.stopBits"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-24"
                  >
                    <option :value="1">1 停止位</option>
                    <option :value="2">2 停止位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.parity"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-24"
                  >
                    <option value="none">无校验</option>
                    <option value="even">偶校验</option>
                    <option value="odd">奇校验</option>
                  </select>
                </template>
              </div>
            </div>

            <div class="config-group" v-else>
              <select v-model="deviceStore.serialConfig.baudRate" :disabled="deviceStore.isModbusConnected">
                <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                  {{ rate }} bps
                </option>
              </select>

              <select v-model="deviceStore.serialConfig.dataBits" :disabled="deviceStore.isModbusConnected">
                <option :value="7">7 数据位</option>
                <option :value="8">8 数据位</option>
              </select>

              <select v-model="deviceStore.serialConfig.stopBits" :disabled="deviceStore.isModbusConnected">
                <option :value="1">1 停止位</option>
                <option :value="2">2 停止位</option>
              </select>

              <select v-model="deviceStore.serialConfig.parity" :disabled="deviceStore.isModbusConnected">
                <option value="none">无校验</option>
                <option value="even">偶校验</option>
                <option value="odd">奇校验</option>
              </select>
            </div>

            <!-- MQTT 模式：Broker 连接状态条 -->
            <div v-if="connectionType === 'mqtt'" class="broker-status-bar">
              <button
                class="btn-broker"
                :class="{ connected: deviceStore.isMqttBrokerConnected }"
                :disabled="deviceStore.isMqttBrokerConnecting || deviceStore.isModbusConnected"
                @click="toggleBrokerConnection"
              >
                {{ deviceStore.isMqttBrokerConnected ? '断开 Broker' : '连接 Broker' }}
              </button>
            </div>

            <button 
              :class="[
                'btn-connect',
                { 'min-w-[96px] md:min-w-[110px]': connectionType === 'mqtt' },
                { connected: deviceStore.isModbusConnected, connecting: deviceStore.isModbusConnecting }
              ]"
              :disabled="deviceStore.isModbusConnecting || (!deviceStore.isSupported && connectionType === 'serial') || (connectionType === 'mqtt' && !deviceStore.isMqttBrokerConnected && !deviceStore.isModbusConnected)"
              @click="toggleConnection"
            >
              <span v-if="deviceStore.isModbusConnecting" class="spinner"></span>
              {{ deviceStore.isModbusConnected ? '断开网关' : '连接网关' }}
            </button>
            <button
              v-if="deviceStore.isModbusConnected && connectionType === 'mqtt' && deviceStore.gatewayOptions.protocol === 'tcp'"
              class="btn-ping"
              :class="{ pinging: deviceStore.isPinging }"
              @click="togglePing"
            >
              {{ deviceStore.isPinging ? '⚫ Stop' : '📡 Ping' }}
            </button>
          </div>
        </div>
      </div>
      
      <div v-if="connectionType === 'serial' && !isSecure" class="error-banner">
        ❌ 检测到非安全上下文。Web Serial API 需要 <strong>HTTPS</strong> 或 <strong>localhost</strong>。不允许使用 IP 地址访问。
      </div>
      <div v-else-if="connectionType === 'serial' && !deviceStore.isSupported" class="warning-banner">
        ⚠️ 当前浏览器不支持 Web Serial API，请使用 Chrome 89+ 或 Edge 89+
      </div>
      <div v-if="deviceStore.modbusError" class="error-banner">
        ❌ {{ deviceStore.modbusError }}
        <button class="close-btn" @click="deviceStore.modbusError = null" style="background:none;border:none;color:inherit;cursor:pointer;float:right;">×</button>
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
            <div class="form-group form-group-slave">
              <label>从站地址</label>
              <input type="number" v-model="slaveAddress" min="1" max="247" />
            </div>
            
            <div class="form-group form-group-fc">
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

            <div class="form-group form-group-addr">
              <div class="label-with-switch">
                <!-- 自动模式下标题改为：寄存器名称 -->
                <label :style="{ width: runMode === 'manual' ? '120px' : '180px' }">
                  {{ runMode === 'auto' ? '寄存器名称' : '起始地址 (Dec)' }}
                </label>
                
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
                  class="dec-input-small" 
                />

                <div class="plc-address-display">
                  <span class="label">PLC地址</span>
                  <!-- 自动模式显示点表定义的 addr，手动模式显示计算后的 addr -->
                  <span class="value">{{ runMode === 'auto' && currentRegisterObj ? currentRegisterObj.addr : plcAddress }}</span>
                </div>
              </div>
            </div>

            <!-- 新增：数据类型选择 (仅手动模式) -->
            <div v-if="runMode === 'manual'" class="form-group form-group-manual-type">
              <div class="label-with-endian">
                <label>数据类型</label>
                <!-- 仅在 32 位数据类型时显示字节序选择 -->
                <select 
                  v-if="['uint32', 'int32', 'float32'].includes(manualDataType)"
                  v-model="manualEndian" 
                  class="endian-mini-select"
                  title="字节序 (Endian)"
                >
                  <option v-for="opt in endianOptions" :key="opt.value" :value="opt.value">
                    {{ opt.value }}
                  </option>
                </select>
              </div>
              <select v-model="manualDataType" class="manual-type-select">
                <option v-for="opt in manualDataTypeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
            
            <div v-if="isReadOperation || !isSingleWrite" class="form-group form-group-quantity">
                <label>寄存器数量</label>
                <input 
                  type="number" 
                  v-model="quantity" 
                  min="1" 
                  max="125" 
                  :disabled="runMode === 'auto' || (runMode === 'manual' && manualDataType !== 'string' && !isReadOperation)"
                  :title="(!isReadOperation && (runMode !== 'manual' || manualDataType !== 'string')) ? '在写多个寄存器模式下，数量自动由写入值的个数决定' : ''"
                />
            </div>
            
            <div v-if="isSingleWrite" class="form-group">
                <label>{{ manualDataType === 'string' && runMode === 'manual' ? '写入文本' : '写入值' }}</label>
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
                <label>{{ manualDataType === 'string' && runMode === 'manual' ? '写入文本内容' : '写入值 (逗号分隔)' }}</label>
                <input 
                  type="text" 
                  v-model="writeValues" 
                  :placeholder="manualDataType === 'string' && runMode === 'manual' ? '输入字符串原文' : '例如: 100, 200, 300'" 
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
              v-for="log in deviceStore.modbusLogs" 
              :key="log.id" 
              class="log-entry"
              :class="[log.direction, { 'ping-entry': !!log.pingResult }]"
            >
              <!-- Ping 结果日志 -->
              <template v-if="log.pingResult">
                <div class="log-meta">
                  <span class="log-time">{{ formatTime(log.timestamp) }}</span>
                  <div class="log-tag-group">
                    <span class="log-tag ping-tag" :class="log.pingResult.success ? 'ping-ok' : 'ping-fail'">PING</span>
                  </div>
                </div>
                <div class="log-content">
                  <div class="log-hex ping-result-text">
                    <span class="ping-target">{{ log.pingResult.ip }}:{{ log.pingResult.port }}</span>
                    <span v-if="log.pingResult.success" class="ping-success">
                      — 连接成功, 延迟 {{ log.pingResult.latency }}ms
                    </span>
                    <span v-else class="ping-failure">
                      — {{ 
                        log.pingResult.error === 'host_unreachable' ? '主机不可达' : 
                        log.pingResult.error === 'port_refused' ? '端口被拒绝' : 
                        log.pingResult.error === 'socket_error' ? 'W5500 Socket 异常' :
                        log.pingResult.error === 'eth_link_down' ? '以太网链路断开' :
                        log.pingResult.error || '连接失败' 
                      }}
                      <template v-if="log.pingResult.latency">({{ log.pingResult.latency }}ms)</template>
                    </span>
                    <span class="ping-seq">(seq={{ log.pingResult.seq }})</span>
                    <span v-if="log.pingResult.localIp" class="ping-diag">[W5500: {{ log.pingResult.localIp }}, Link: {{ log.pingResult.link }}]</span>
                  </div>
                </div>
              </template>
              <!-- Modbus 正常日志 -->
              <template v-else>
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
                  Coil: [{{ log.parsed.coils.map((c: boolean) => c ? '1' : '0').join('') }}]
                </div>
                <div v-if="log.parsed?.error" class="log-error">
                  Err: {{ log.parsed.error }}
                </div>
              </div>
              </template>
            </div>
            
            <div v-if="deviceStore.modbusLogs.length === 0" class="log-empty">
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

    <!-- 区块参数一键写入弹窗 -->
    <div v-if="isBlockWriteShow" class="modal-overlay" @click.self="isBlockWriteShow = false">
      <div class="modal-content block-write-modal">
        <div class="modal-header primary">
          <div class="header-main">
            <h3>⚙️ 区块参数一键写入</h3>
            <span class="header-subtitle">{{ currentBlockReg?.name }} (Addr: {{ startAddress }})</span>
          </div>
          <button class="btn-close" @click="isBlockWriteShow = false">×</button>
        </div>
        
        <div class="modal-body block-form-body">
          <div v-if="isBlockLoading" class="block-loading-overlay">
            <div class="spinner"></div>
            <span>正在预读设备当前值...</span>
          </div>

          <div class="block-fields-grid">
            <div v-for="field in currentBlockReg?.block_fields" :key="field.name" class="block-field-item">
              <label>
                {{ field.name }}
                <span v-if="field.unit" class="field-unit">({{ field.unit }})</span>
              </label>
              
              <div class="field-input-wrapper">
                <select v-if="field.mapping" v-model="blockFieldValues[field.name]">
                  <option v-for="(label, val) in field.mapping" :key="val" :value="val">
                    {{ label }}
                  </option>
                </select>
                <input v-else type="number" v-model="blockFieldValues[field.name]" />
                <div class="field-meta">
                  <span>Offset: +{{ field.offset }}</span>
                  <span>DataType: {{ field.data_type }}</span>
                  <span v-if="field.scale" class="meta-scale">Scale: {{ field.scale }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="block-write-hint">
            💡 提示：系统已为您自动填入读取到的初始值。点击“保存并下发”后，系统将使用 0x10 功能码一次性更新整个区块（共 {{ currentBlockReg?.count }} 个寄存器）。
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-cancel" @click="isBlockWriteShow = false">取消</button>
          <button class="btn-execute-block" @click="executeBlockWrite">保存并整体下发</button>
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

.config-bar .base-switch {
  height: 2.4rem;
  align-items: stretch;
  padding: 0;
}

.config-bar .base-switch button {
  height: 100%;
  padding: 0 12px;
  display: flex;
  align-items: center;
  border-radius: 0;
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
  background: linear-gradient(135deg, #22c55e, #16a34a);
  border: none;
  color: #ffffff;
}

.btn-ping {
  padding: 0.4rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(14, 165, 233, 0.3);
  background: rgba(14, 165, 233, 0.1);
  color: #0ea5e9;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-ping:hover {
  background: rgba(14, 165, 233, 0.2);
  border-color: rgba(14, 165, 233, 0.5);
}

.btn-ping.pinging {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  color: white;
  border-color: transparent;
  animation: ping-pulse 2s ease-in-out infinite;
}

@keyframes ping-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(14, 165, 233, 0); }
}

/* Ping 日志条目样式 */
.ping-entry {
  border-left-color: #0ea5e9 !important;
}

.ping-tag {
  font-weight: 700;
  letter-spacing: 0.05em;
}

.ping-tag.ping-ok {
  background: rgba(34, 197, 94, 0.15) !important;
  color: #22c55e !important;
}

.ping-tag.ping-fail {
  background: rgba(239, 68, 68, 0.15) !important;
  color: #ef4444 !important;
}

.ping-result-text {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.ping-target {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--color-text);
}

.ping-success {
  color: #22c55e;
  font-weight: 500;
}

.ping-failure {
  color: #ef4444;
  font-weight: 500;
}

.ping-seq {
  color: var(--color-text-secondary);
  font-size: 0.8em;
  opacity: 0.7;
}

.ping-note {
  color: #f59e0b;
  font-size: 0.85em;
  font-weight: 500;
  margin-left: 0.25rem;
}

.ping-diag {
  color: var(--color-text-secondary);
  font-size: 0.75em;
  opacity: 0.6;
  font-family: var(--font-mono);
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

/* 固定宽度的表单组 */
.form-group-slave {
  width: 80px;
  flex-shrink: 0;
}

.form-group-fc {
  width: 170px;
  flex-shrink: 0;
}

.form-group-addr {
  width: auto;
  flex-shrink: 0;
}

.form-group-manual-type {
  width: 140px;
  flex-shrink: 0;
}

.form-group-quantity {
  width: 90px;
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

.dec-input-small {
  width: 120px;
}

.manual-type-select {
  width: 140px;
}

.label-with-endian {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.endian-mini-select {
  height: 1.2rem !important; /* 超小高度 */
  padding: 0 4px !important;
  font-size: 0.7rem !important;
  width: 54px !important;
  background: var(--color-surface-hover) !important;
  border-color: var(--color-primary) !important;
  color: var(--color-primary) !important;
  border-radius: 3px !important;
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
  align-items: flex-start; /* 改为顶端对齐，适合多行 */
  gap: 8px;
  justify-content: center;
  padding: 4px 0;
}

.summary-icon {
  font-size: 1rem;
}

.summary-text {
  font-weight: 600;
  color: var(--color-primary);
  font-size: 0.95rem;
  letter-spacing: 0.5px;
  white-space: pre-wrap; /* 支持换行 */
  line-height: 1.6; /* 增加行高 */
  text-align: left; /* 多行时建议左对齐或保持居中，这里由于 content 是 center，text-align 可选 */
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

/* Broker 连接状态条 */
.broker-status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.broker-status-indicator {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.broker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.broker-dot-on  { background: #10b981; animation: gateway-pulse 2s ease-in-out infinite; }
.broker-dot-off { background: #9ca3af; }

.broker-status-label {
  font-size: 0.75rem;
  color: #6b7280;
  white-space: nowrap;
}

.btn-broker {
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  border: 1.5px solid #3b82f6;
  color: #3b82f6;
  background: transparent;
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
}
.btn-broker:hover:not(:disabled) {
  background: #3b82f6;
  color: #fff;
}
.btn-broker.connected {
  border-color: #ef4444;
  color: #ef4444;
}
.btn-broker.connected:hover:not(:disabled) {
  background: #ef4444;
  color: #fff;
}
.btn-broker:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 网关状态指示器 */
.gateway-status-dot-wrap {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
  cursor: default;
  padding: 0 0.25rem;
}

.gateway-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-online {
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6);
  animation: gateway-pulse 2s ease-in-out infinite;
}

.dot-offline {
  background: #9ca3af;
}

@keyframes gateway-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  60%  { box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

.gateway-status-text {
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.text-online  { color: #059669; }
.text-offline { color: #9ca3af; }

/* Gateway ID 内联输入框组 */
.gateway-id-inputs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.gateway-id-input {
  width: 5rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 0.82rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #111827;
  background: #ffffff;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.gateway-id-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.gateway-id-input:disabled {
  background: #f3f4f6;
  color: #9ca3af;
  cursor: not-allowed;
}

.gateway-id-sep {
  font-size: 1rem;
  color: #9ca3af;
  font-weight: 600;
}

/* 网关下拉容器 */
.gateway-select-wrap {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  min-width: 180px;
  max-width: 220px;
  flex: 1;
}

.gateway-select {
  flex: 1;
  width: 0; /* 让 flex 生效 */
}

.btn-manage-gateways {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 0.9rem;
}
.btn-manage-gateways:hover {
  background: #f3f4f6;
  color: #3b82f6;
  border-color: #d1d5db;
}



.header-row {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
}

.header-left-col {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 140px;
}

.header-status-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.72rem;
  color: #6b7280;
  padding-left: 2px;
  margin-top: 2px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-label {
  display: inline-block;
  width: 40px;
  text-align: justify;
  text-align-last: justify;
}/* 区块写入弹窗样式 */
.block-write-modal {
  background: var(--color-surface);
  width: 760px;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.header-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.header-subtitle {
  font-size: 0.8rem;
  opacity: 0.8;
  font-weight: normal;
}

.block-form-body {
  position: relative;
  overflow-y: auto;
  padding: 1.5rem;
}

.block-fields-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

.block-field-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.block-field-item label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-unit {
  font-weight: normal;
  font-size: 0.8rem;
  opacity: 0.7;
}

.field-scale {
  font-weight: normal;
  font-size: 0.75rem;
  color: var(--color-primary);
  margin-left: 4px;
  background: var(--color-primary-light);
  padding: 0 4px;
  border-radius: 3px;
}

.field-input-wrapper input,
.field-input-wrapper select {
  width: 100%;
  padding: 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  font-size: 1rem;
}

.field-meta {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.meta-scale {
  color: var(--color-primary);
  font-weight: 600;
}

.block-write-hint {
  margin-top: 2rem;
  padding: 1rem;
  background: var(--color-surface-hover);
  border-left: 4px solid var(--color-primary);
  border-radius: 4px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.block-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(2px);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--color-primary-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn-execute-block {
  padding: 0.7rem 2rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  transition: all 0.2s;
}

.btn-execute-block:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.modal-header.primary {
  background: var(--color-surface-hover);
  border-bottom: 2px solid var(--color-primary);
}

.modal-footer {
  padding: 1.25rem 1.5rem;
  background: var(--color-surface-hover);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

</style>
