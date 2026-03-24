import { ref, computed, watch, onMounted, onActivated } from 'vue';
import { useDeviceStore, type ConnectionType } from '@/stores/deviceStore';
import { useProfileStore } from '@/stores/profileStore';
import { ModbusFunctionCode, MODBUS_FUNCTION_CODE_OPTIONS, normalizeFuncCodes, getModbusOffset } from '@/protocols/modbus';

export function useModbusState() {
  const deviceStore = useDeviceStore();
  const profileStore = useProfileStore();

  // ✅ 生命周期：加载点表 + 恢复 modbusMode（原始逻辑）
  onMounted(() => {
    if (profileStore.profiles.length === 0) {
      profileStore.loadProfiles();
    }
    deviceStore.setModbusMode(deviceStore.modbusMode);
  });

  onActivated(() => {
    deviceStore.setModbusMode(deviceStore.modbusMode);
  });

  // ✅ connectionType：双向绑定 store，切换时同步协议模式（原始逻辑）
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

  // 运行模式
  const runMode = ref<'manual' | 'auto'>('auto');

  // 自动化状态
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
  const useBase1 = ref(false);

  // 手动模式：数据类型与字节序
  const manualDataType = ref('uint16');
  const manualEndian = ref('ABCD');

  // 弹窗控制
  const showMqttDialog = ref(false);
  const showGatewayManager = ref(false);
  const selectedGatewayId = ref('');

  // 结果显示格式（统一在 state 中管理）
  const displayFormat = ref<'hex' | 'dec' | 'bin'>('dec');

  // 通信反馈 (Toast)
  const toast = ref({
    show: false,
    message: '',
    type: 'success' as 'success' | 'error' | 'info'
  });

  // ✅ 写入确认弹窗状态
  const isWriteConfirmShow = ref(false);
  const pendingWriteInfo = ref({
    regName: '',
    address: 0,
    newValue: '',
    oldValue: '读取中...',
    type: ''
  });

  // ✅ 区块写入弹窗状态
  const isBlockWriteShow = ref(false);
  const isBlockLoading = ref(false);
  const currentBlockReg = ref<any>(null);
  const blockFieldValues = ref<Record<string, any>>({});

  // 记录最后一次发送上下文（用于匹配响应）
  const lastSentContext = ref<{ fc: number; addr: number; time: number } | null>(null);

  // 计算属性：PLC 地址 (Modicon 寻址)
  const plcAddress = computed(() => {
    const addr = startAddress.value;
    switch (functionCode.value) {
      case ModbusFunctionCode.READ_COILS:
      case ModbusFunctionCode.WRITE_SINGLE_COIL:
      case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
        return addr.toString().padStart(5, '0');
      case ModbusFunctionCode.READ_DISCRETE_INPUTS:
        return (10000 + addr).toString();
      case ModbusFunctionCode.READ_INPUT_REGISTERS:
        return (30000 + addr).toString();
      case ModbusFunctionCode.READ_HOLDING_REGISTERS:
      case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
      case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
        return (40000 + addr).toString();
      default:
        return addr.toString();
    }
  });

  // ✅ 自动模式：寄存器选择后自动填充地址/功能码/数量
  function updateAutoAddress() {
    if (runMode.value === 'auto' && currentRegisterObj.value) {
      const reg = currentRegisterObj.value;
      const allowedCodes = normalizeFuncCodes(reg.func_code);
      if (allowedCodes.length > 0 && !allowedCodes.includes(functionCode.value)) {
        functionCode.value = allowedCodes[0] as ModbusFunctionCode;
      }
      startAddress.value = getModbusOffset(reg.addr !== undefined ? reg.addr : 0, functionCode.value);
      quantity.value = reg.count || 1;
    }
  }

  watch(selectedRegisterName, updateAutoAddress);
  watch(useBase1, updateAutoAddress);

  // ✅ 多值写入时自动同步数量字段
  watch([writeValues, manualDataType, runMode, functionCode], () => {
    const isMultiWrite = [ModbusFunctionCode.WRITE_MULTIPLE_COILS, ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS].includes(functionCode.value);
    if (!isMultiWrite) return;

    if (runMode.value === 'auto') {
      if ((currentRegisterObj.value?.data_type as string) === 'block') {
        quantity.value = currentRegisterObj.value?.count || 1;
        return;
      }
      const vals = writeValues.value.split(',').filter(s => s.trim() !== '');
      quantity.value = vals.length;
    } else {
      if (manualDataType.value === 'string') return;
      const vals = writeValues.value.split(',').filter(s => s.trim() !== '');
      const multiplier = ['float32', 'int32', 'uint32'].includes(manualDataType.value) ? 2 : 1;
      quantity.value = vals.length * multiplier;
    }
  });

  // ✅ selectedGatewayId 双向同步
  const onlineGateways = computed(() => deviceStore.gateways.filter(g => g.online));

  watch(
    () => deviceStore.mqttConfig,
    config => {
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

  watch(selectedGatewayId, value => {
    if (!value) return;
    const parts = value.split('/');
    if (parts.length !== 2) return;
    const [siteId, gatewayId] = parts;
    if (deviceStore.mqttConfig.siteId !== siteId || deviceStore.mqttConfig.gatewayId !== gatewayId) {
      deviceStore.saveMqttConfig({ siteId, gatewayId });
    }
  });

  return {
    runMode,
    connectionType,
    selectedProfileId,
    selectedRegisterName,
    isProfilePickerShow,
    selectedProfile,
    currentRegisterObj,
    slaveAddress,
    functionCode,
    startAddress,
    quantity,
    writeValue,
    writeValues,
    useBase1,
    manualDataType,
    manualEndian,
    showMqttDialog,
    showGatewayManager,
    selectedGatewayId,
    displayFormat,
    toast,
    plcAddress,
    isWriteConfirmShow,
    pendingWriteInfo,
    isBlockWriteShow,
    isBlockLoading,
    currentBlockReg,
    blockFieldValues,
    lastSentContext,
    onlineGateways,
  };
}
