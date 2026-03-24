import { computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { 
  getModbusOffset, 
  normalizeFuncCodes, 
  parseAutoValue 
} from '@/protocols/modbus/modbusUtils';

import type { useModbusState } from './useModbusState';

export function useModbusLogs(state: ReturnType<typeof useModbusState>) {
  const deviceStore = useDeviceStore();

  function formatBin(val: number): string {
    const bin = val.toString(2).padStart(16, '0');
    return bin.match(/.{1,4}/g)?.join(' ') ?? bin;
  }



  function formatTime(timestamp: number | Date) {
    const d = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  }



  // 计算属性：提取最近一次成功读取的寄存器结果 (核心搬迁自 ModbusPanel.vue)
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

    // 获取对应的 TX 上下文
    let physicalStartAddr = 0;
    let requestedQuantity = 0;

    for (let i = lastRxIndex + 1; i < deviceStore.modbusLogs.length; i++) {
        const log = deviceStore.modbusLogs[i];
        if (log && log.direction === 'tx') {
           const hexs = log.hex.split(' ');
           if (hexs.length >= 6) {
             physicalStartAddr = (parseInt(hexs[2] || '0', 16) << 8) | parseInt(hexs[3] || '0', 16);
             requestedQuantity = (parseInt(hexs[4] || '0', 16) << 8) | parseInt(hexs[5] || '0', 16);
           }
           break;
        }
    }

    const results: Array<any> = [];
    
    // 保持寄存器/输入寄存器 (03, 04)
    if (lastReadLog.parsed.registers) {
      const allVals = lastReadLog.parsed.registers;
      const displayVals = requestedQuantity > 0 ? allVals.slice(0, requestedQuantity) : allVals;
      let pendingSummary: any = null;

      displayVals.forEach((val: number, index: number) => {
        const currentPhysicalAddr = physicalStartAddr + index;
        const displayAddr = state.useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;
        
        let matchedReg = null;
        let isFollower = false;

        if (state.runMode.value === 'auto' && state.selectedProfile.value) {
            const profileData = state.selectedProfile.value.data;
            const defaultEndian = profileData.protocol_summary?.default_endian || 'ABCD';
            const parsed = lastReadLog.parsed as any;
            const currentFC = parsed.functionCode || parsed.fc || 0;
            
            matchedReg = profileData.registers.find((r: any) => {
              const logicOffset = getModbusOffset(r.addr || 0, currentFC);
              const expectedPhysicalAddr = state.useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
              return expectedPhysicalAddr === currentPhysicalAddr && normalizeFuncCodes(r.func_code).includes(currentFC);
            });
            
            const parentReg = profileData.registers.find((r: any) => {
              const logicOffset = getModbusOffset(r.addr || 0, currentFC);
              const expectedPhysicalAddr = state.useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
              return normalizeFuncCodes(r.func_code).includes(currentFC) && 
                     currentPhysicalAddr > expectedPhysicalAddr && 
                     currentPhysicalAddr < (expectedPhysicalAddr + (r.count || 1));
            });

            if (matchedReg) {
                const parsedValue = parseAutoValue(matchedReg, allVals, index, defaultEndian);
                pendingSummary = {
                  type: 'summary',
                  text: `${matchedReg.name} == ${parsedValue}`,
                  triggerAddr: currentPhysicalAddr + (matchedReg.count || 1) - 1
                };
            } else if (parentReg) {
                isFollower = true;
            }
        } else if (state.runMode.value === 'manual') {
            const count = ['float32', 'int32', 'uint32'].includes(state.manualDataType.value) ? 2 : 1;
            if (index % count === 0 && index + count <= displayVals.length) {
                const parsedValue = parseAutoValue({ data_type: state.manualDataType.value, endian: state.manualEndian.value }, allVals, index);
                pendingSummary = {
                  type: 'summary',
                  text: `解析结果 (${state.manualDataType.value}) == ${parsedValue}`,
                  triggerAddr: currentPhysicalAddr + count - 1
                };
            } else if (index % count !== 0) {
                isFollower = true;
            }
        }

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

        if (pendingSummary && currentPhysicalAddr === pendingSummary.triggerAddr) {
          results.push(pendingSummary);
          pendingSummary = null;
        }
      });
    }
    
  // ✅ 处理线圈/离散输入 (FC01, FC02) — 原始逻辑完整移植
  if (lastReadLog.parsed.coils) {
    const allCoils = lastReadLog.parsed.coils;
    const displayCoils = requestedQuantity > 0 ? allCoils.slice(0, requestedQuantity) : allCoils;
    let pendingSummaryC: any = null;

    displayCoils.forEach((val: boolean, index: number) => {
      const currentPhysicalAddr = physicalStartAddr + index;
      const displayAddr = state.useBase1.value ? currentPhysicalAddr + 1 : currentPhysicalAddr;

      let matchedReg = null;
      let isFollower = false;

      if (state.runMode.value === 'auto' && state.selectedProfile.value) {
        const profileData = state.selectedProfile.value.data;
        const parsed = lastReadLog.parsed as any;
        const currentFC = parsed.functionCode || parsed.fc || 0;

        matchedReg = profileData.registers.find((r: any) => {
          const logicOffset = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = state.useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
          return expectedPhysicalAddr === currentPhysicalAddr && normalizeFuncCodes(r.func_code).includes(currentFC);
        });

        const parentReg = profileData.registers.find((r: any) => {
          const logicOffset = getModbusOffset(r.addr || 0, currentFC);
          const expectedPhysicalAddr = state.useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
          return normalizeFuncCodes(r.func_code).includes(currentFC) &&
                 currentPhysicalAddr > expectedPhysicalAddr &&
                 currentPhysicalAddr < (expectedPhysicalAddr + (r.count || 1));
        });

        if (matchedReg) {
          const parsedValue = parseAutoValue(matchedReg, allCoils, index);
          const logicOffset = getModbusOffset(matchedReg.addr || 0, currentFC);
          const expectedPhysicalAddr = state.useBase1.value ? Math.max(0, logicOffset - 1) : logicOffset;
          pendingSummaryC = {
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

      if (pendingSummaryC && currentPhysicalAddr === pendingSummaryC.triggerAddr) {
        results.push(pendingSummaryC);
        pendingSummaryC = null;
      }
    });
  }

    return results;
  });

  return {
    latestReadResults,
    logs: computed(() => deviceStore.modbusLogs),
    clearLogs: () => deviceStore.clearLogs(),
    displayFormat: state.displayFormat,
    formatTime
  };
}
