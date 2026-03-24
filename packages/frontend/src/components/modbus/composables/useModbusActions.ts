import { watch, type ComputedRef } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ProtocolType } from '@shared/types/protocol.types';
import { 
  ModbusFunctionCode, 
  type ModbusRtuCommand, 
  encodeValue,
  getModbusOffset,
  normalizeFuncCodes,
  getExtendedValue
} from '@/protocols/modbus';
import { bytesToHexSpaced } from '@/utils/hex';

import type { useModbusState } from './useModbusState';

export function useModbusActions(state: ReturnType<typeof useModbusState>, latestReadResults?: ComputedRef<any[]>) {
  const deviceStore = useDeviceStore();

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    state.toast.value = { show: true, message, type };
    setTimeout(() => {
      state.toast.value.show = false;
    }, 3000);
  };

  // ✅ 监听日志，捕获 RX 响应并匹配 TX 上下文（原始逻辑）
  watch(() => deviceStore.modbusLogs.length, () => {
    const latestLog = deviceStore.modbusLogs[0];
    if (!latestLog || latestLog.direction !== 'rx' || !state.lastSentContext.value) return;

    const now = Date.now();
    if (now - state.lastSentContext.value.time > 2000) return;

    const hexs = latestLog.hex.split(' ');
    const resFCHex = hexs[1] || '00';
    const resFC = parseInt(resFCHex, 16);
    const sentFC = state.lastSentContext.value.fc;

    if (resFC === sentFC) {
      showToast(`指令执行成功 (FC ${sentFC.toString(16).toUpperCase()})`, 'success');
      state.lastSentContext.value = null;
    } else if (resFC === sentFC + 0x80) {
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
      state.lastSentContext.value = null;
    }
  });

  // --- 解析写入值 ---
  function getWriteValues(): number[] | undefined {
    const runMode = state.runMode.value;
    const reg = state.currentRegisterObj.value;
    const isSingle = [ModbusFunctionCode.WRITE_SINGLE_COIL, ModbusFunctionCode.WRITE_SINGLE_REGISTER].includes(state.functionCode.value);

    if (runMode === 'auto' && reg) {
      const valStr = (isSingle ? String(state.writeValue.value) : state.writeValues.value.split(',')[0]) || '0';
      const defaultEndian = state.selectedProfile.value?.data.protocol_summary.default_endian || 'ABCD';
      return encodeValue(valStr, reg.data_type || 'uint16', reg.endian || defaultEndian);
    }

    const type = state.manualDataType.value;
    const endian = state.manualEndian.value;

    if (isSingle) {
      return encodeValue(String(state.writeValue.value), type, endian);
    }

    if (type === 'string') {
      const text = state.writeValues.value;
      const bytes = new TextEncoder().encode(text);
      const len = Math.max(state.quantity.value * 2, bytes.length);
      const buf = new Uint8Array(len);
      buf.set(bytes);
      const regs = [];
      for (let i = 0; i < buf.length; i += 2) {
        regs.push((buf[i] << 8) | (buf[i+1] || 0));
      }
      return regs;
    }

    const valStrs = state.writeValues.value.split(',').filter(s => s.trim() !== '');
    let allRegs: number[] = [];
    valStrs.forEach(s => {
      allRegs = allRegs.concat(encodeValue(s.trim(), type, endian));
    });
    return allRegs;
  }

  // ✅ 实际执行写入（由弹窗确认后调用）
  async function executeActualWrite() {
    state.isWriteConfirmShow.value = false;
    const reg = state.currentRegisterObj.value;
    const physicalAddress = state.useBase1.value ? Math.max(0, state.startAddress.value - 1) : state.startAddress.value;
    
    // ✅ 自动解锁逻辑
    if (state.runMode.value === 'auto' && reg?.unlock_required && state.selectedProfile.value) {
      const unlockCfg = reg.unlock_required;
      const unlockTargetReg = state.selectedProfile.value.data.registers.find((r: any) => r.name === unlockCfg.target);
      if (unlockTargetReg) {
        console.log(`[Modbus] 正在自动解锁: ${unlockCfg.target}`);
        const unlockRawVal = typeof unlockCfg.value === 'string' && unlockCfg.value.startsWith('0x') ? parseInt(unlockCfg.value, 16) : Number(unlockCfg.value);
        const unlockPhysicalAddr = getModbusOffset(String(unlockTargetReg.addr || 0), String(ModbusFunctionCode.WRITE_SINGLE_REGISTER));
        await deviceStore.sendCommand({
          protocol: ProtocolType.MODBUS_RTU,
          slaveAddress: state.slaveAddress.value,
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

    state.lastSentContext.value = { fc: state.functionCode.value, addr: physicalAddress, time: Date.now() };

    const command: ModbusRtuCommand = {
      protocol: ProtocolType.MODBUS_RTU,
      slaveAddress: state.slaveAddress.value,
      functionCode: state.functionCode.value,
      startAddress: physicalAddress,
      quantity: state.functionCode.value === ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS ? state.quantity.value : undefined,
      values: getWriteValues()
    };

    try {
      await deviceStore.sendCommand(command);
    } catch (error) {
      showToast('报文发送失败', 'error');
    }
  }

  // ✅ 发送命令入口（含写入确认弹窗逻辑）
  async function sendCommand() {
    if (!deviceStore.isModbusConnected) {
      showToast('请先连接网关', 'error');
      return;
    }

    const isRead = [
      ModbusFunctionCode.READ_COILS,
      ModbusFunctionCode.READ_DISCRETE_INPUTS,
      ModbusFunctionCode.READ_HOLDING_REGISTERS,
      ModbusFunctionCode.READ_INPUT_REGISTERS
    ].includes(state.functionCode.value);

    const physicalAddress = state.useBase1.value ? Math.max(0, state.startAddress.value - 1) : state.startAddress.value;
    const reg = state.currentRegisterObj.value;

    // ✅ 区块写入分支
    if (!isRead && state.runMode.value === 'auto' && (reg?.data_type as string) === 'block') {
      await openBlockWriteDialog(reg);
      return;
    }

    if (isRead) {
      state.lastSentContext.value = { fc: state.functionCode.value, addr: physicalAddress, time: Date.now() };
      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: state.slaveAddress.value,
        functionCode: state.functionCode.value,
        startAddress: physicalAddress,
        quantity: state.quantity.value
      });
      return;
    }

    // ✅ 写入确认弹窗
    const isSingle = [ModbusFunctionCode.WRITE_SINGLE_COIL, ModbusFunctionCode.WRITE_SINGLE_REGISTER].includes(state.functionCode.value);
    const readFC = [ModbusFunctionCode.WRITE_SINGLE_COIL, ModbusFunctionCode.WRITE_MULTIPLE_COILS].includes(state.functionCode.value)
      ? ModbusFunctionCode.READ_COILS
      : ModbusFunctionCode.READ_HOLDING_REGISTERS;

    state.pendingWriteInfo.value = {
      regName: reg ? reg.name : '未知寄存器',
      address: state.startAddress.value,
      newValue: isSingle ? String(state.writeValue.value) : state.writeValues.value,
      oldValue: '读取中...',
      type: reg?.data_type || 'int16'
    };
    state.isWriteConfirmShow.value = true;

    try {
      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: state.slaveAddress.value,
        functionCode: readFC,
        startAddress: physicalAddress,
        quantity: (reg && ['float32', 'int32', 'uint32'].includes(reg.data_type)) ? 2 : (reg?.count || 1)
      });
      // ✅ 不再使用延时，监听 latestReadResults 的更新
      // (监听逻辑已在 useModbusActions 返回前统一设置，或在此处设置一个临时监听)
    } catch (err) {
      state.pendingWriteInfo.value.oldValue = '读取失败';
    }
  }

  // ✅ 打开区块写入弹窗
  async function openBlockWriteDialog(reg: any) {
    state.currentBlockReg.value = reg;
    state.blockFieldValues.value = {};
    reg.block_fields.forEach((f: any) => {
      state.blockFieldValues.value[f.name] = undefined;
    });
    state.isBlockWriteShow.value = true;

    const allowedCodes = normalizeFuncCodes(reg.func_code);
    const canRead = allowedCodes.includes(ModbusFunctionCode.READ_HOLDING_REGISTERS) ||
                    allowedCodes.includes(ModbusFunctionCode.READ_INPUT_REGISTERS);

    if (!canRead) {
      state.isBlockLoading.value = false;
      return;
    }

    state.isBlockLoading.value = true;

    try {
      const physicalAddress = state.useBase1.value ? Math.max(0, state.startAddress.value - 1) : state.startAddress.value;
      const readFC = allowedCodes.includes(ModbusFunctionCode.READ_INPUT_REGISTERS)
        ? ModbusFunctionCode.READ_INPUT_REGISTERS
        : ModbusFunctionCode.READ_HOLDING_REGISTERS;

      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: state.slaveAddress.value,
        functionCode: readFC,
        startAddress: physicalAddress,
        quantity: reg.count || 1
      });

      setTimeout(() => syncBlockValues(), 800);
    } catch (e) {
      showToast('区块初始值读取失败，请手动填写', 'info');
      state.isBlockLoading.value = false;
    }
  }

  // ✅ 从日志同步区块字段初始值
  function syncBlockValues() {
    if (!state.currentBlockReg.value || !state.isBlockWriteShow.value) return;
    const reg = state.currentBlockReg.value;

    try {
      const lastRx = deviceStore.modbusLogs.find(log =>
        log.direction === 'rx' && log.parsed && log.parsed.registers
      );
      if (!lastRx || !lastRx.parsed.registers) return;
      const allVals = lastRx.parsed.registers;
      const defaultEndian = state.selectedProfile.value?.data.protocol_summary?.default_endian || 'ABCD';

      reg.block_fields.forEach((f: any) => {
        const subOffset = f.offset || 0;
        const rawValue = getExtendedValue(allVals, subOffset, f.data_type || 'uint16', f.endian || defaultEndian);
        if (rawValue !== null) {
          state.blockFieldValues.value[f.name] = rawValue;
        }
      });
    } finally {
      state.isBlockLoading.value = false;
    }
  }

  // ✅ 执行区块一键写入
  async function executeBlockWrite() {
    if (!state.currentBlockReg.value) return;
    const reg = state.currentBlockReg.value;
    const count = reg.count || 1;
    const payload = new Array(count).fill(0);
    const defaultEndian = state.selectedProfile.value?.data.protocol_summary?.default_endian || 'ABCD';

    try {
      reg.block_fields.forEach((f: any) => {
        const userVal = state.blockFieldValues.value[f.name];
        if (userVal === undefined || userVal === null) return;
        const encoded = encodeValue(String(userVal), f.data_type || 'uint16', f.endian || defaultEndian);
        const subOffset = f.offset || 0;
        encoded.forEach((word: number, wordIndex: number) => {
          if (subOffset + wordIndex < count) {
            payload[subOffset + wordIndex] = word;
          }
        });
      });

      const physicalAddress = state.useBase1.value ? Math.max(0, state.startAddress.value - 1) : state.startAddress.value;
      state.lastSentContext.value = { fc: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, addr: physicalAddress, time: Date.now() };

      await deviceStore.sendCommand({
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: state.slaveAddress.value,
        functionCode: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS,
        startAddress: physicalAddress,
        quantity: count,
        values: payload
      });

      state.isBlockWriteShow.value = false;
    } catch (e) {
      showToast('区块写入下发失败', 'error');
    }
  }

  // ✅ 动态报文预览计算（原始逻辑）
  function getFullRawFrame(isReadOperation: boolean): string {
    try {
      const physicalAddress = state.useBase1.value ? Math.max(0, state.startAddress.value - 1) : state.startAddress.value;
      const command: ModbusRtuCommand = {
        protocol: ProtocolType.MODBUS_RTU,
        slaveAddress: state.slaveAddress.value,
        functionCode: state.functionCode.value,
        startAddress: physicalAddress,
        quantity: isReadOperation ? state.quantity.value : undefined,
        values: isReadOperation ? undefined : getWriteValues()
      };
      const ad: any = deviceStore.adapter;
      if (!ad) return '---';
      const frame = typeof ad.preview === 'function' ? ad.preview(command) : ad.encode(command);
      return bytesToHexSpaced(frame as Uint8Array);
    } catch (e) {
      return '---';
    }
  }
  
  // ✅ 开启监听：当写入确认弹窗显示时，一旦有新的解析结果，立即同步到 oldValue
  if (latestReadResults) {
    watch(latestReadResults, (newResults) => {
      if (!state.isWriteConfirmShow.value) return;
      const lastRes = newResults.find(r => r.type === 'summary');
      if (lastRes && (lastRes as any).text) {
        state.pendingWriteInfo.value.oldValue = (lastRes as any).text;
      }
    }, { deep: true });
  }

  return {
    sendCommand,
    executeActualWrite,
    executeBlockWrite,
    openBlockWriteDialog,
    showToast,
    getFullRawFrame,
    getWriteValues,
  };
}
