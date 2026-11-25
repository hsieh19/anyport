/**
 * Modbus PDU (Protocol Data Unit) 公共编解码核心
 * 供 Modbus RTU 与 Modbus TCP 适配器复用，消除双端重复代码
 */

import { ModbusFunctionCode, type ModbusRtuCommand } from './ModbusRtuAdapter';

/**
 * 构建不含从站地址与校验码的纯 Modbus 请求 PDU (FunctionCode + Data)
 */
export function encodeModbusRequestPdu(command: ModbusRtuCommand): Uint8Array {
  const { functionCode, startAddress, quantity, values } = command;

  switch (functionCode) {
    case ModbusFunctionCode.READ_COILS:
    case ModbusFunctionCode.READ_DISCRETE_INPUTS:
    case ModbusFunctionCode.READ_HOLDING_REGISTERS:
    case ModbusFunctionCode.READ_INPUT_REGISTERS: {
      const qty = quantity ?? 1;
      return new Uint8Array([
        functionCode,
        (startAddress >> 8) & 0xff,
        startAddress & 0xff,
        (qty >> 8) & 0xff,
        qty & 0xff,
      ]);
    }

    case ModbusFunctionCode.WRITE_SINGLE_COIL: {
      const coilValue = (values?.[0] ?? 0) ? 0xff00 : 0x0000;
      return new Uint8Array([
        functionCode,
        (startAddress >> 8) & 0xff,
        startAddress & 0xff,
        (coilValue >> 8) & 0xff,
        coilValue & 0xff,
      ]);
    }

    case ModbusFunctionCode.WRITE_SINGLE_REGISTER: {
      const regValue = values?.[0] ?? 0;
      return new Uint8Array([
        functionCode,
        (startAddress >> 8) & 0xff,
        startAddress & 0xff,
        (regValue >> 8) & 0xff,
        regValue & 0xff,
      ]);
    }

    case ModbusFunctionCode.WRITE_MULTIPLE_COILS: {
      const coilCount = values?.length ?? 0;
      const byteCount = Math.ceil(coilCount / 8);
      const pdu = new Uint8Array(6 + byteCount);
      pdu[0] = functionCode;
      pdu[1] = (startAddress >> 8) & 0xff;
      pdu[2] = startAddress & 0xff;
      pdu[3] = (coilCount >> 8) & 0xff;
      pdu[4] = coilCount & 0xff;
      pdu[5] = byteCount;
      for (let i = 0; i < coilCount; i++) {
        if (values?.[i]) {
          pdu[6 + Math.floor(i / 8)]! |= 1 << (i % 8);
        }
      }
      return pdu;
    }

    case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS: {
      const regCount = values?.length ?? 0;
      const pdu = new Uint8Array(6 + regCount * 2);
      pdu[0] = functionCode;
      pdu[1] = (startAddress >> 8) & 0xff;
      pdu[2] = startAddress & 0xff;
      pdu[3] = (regCount >> 8) & 0xff;
      pdu[4] = regCount & 0xff;
      pdu[5] = regCount * 2;
      for (let i = 0; i < regCount; i++) {
        const val = values?.[i] ?? 0;
        pdu[6 + i * 2] = (val >> 8) & 0xff;
        pdu[7 + i * 2] = val & 0xff;
      }
      return pdu;
    }

    default:
      throw new Error(`不支持的功能码: ${functionCode}`);
  }
}

/**
 * 解析 Modbus 正常响应中的寄存器或线圈负载数据
 * @param functionCode 功能码
 * @param data 原始帧数据
 * @param byteCountOffset byteCount 字节在 data 中的索引（RTU 为 2，TCP 为 8）
 */
export function decodeModbusReadPayload(
  functionCode: number,
  data: Uint8Array,
  byteCountOffset: number
): { coils?: boolean[]; registers?: number[] } {
  switch (functionCode) {
    case ModbusFunctionCode.READ_COILS:
    case ModbusFunctionCode.READ_DISCRETE_INPUTS: {
      const byteCount = data[byteCountOffset]!;
      const coils: boolean[] = [];
      const dataStart = byteCountOffset + 1;
      for (let i = 0; i < byteCount; i++) {
        for (let bit = 0; bit < 8; bit++) {
          coils.push((data[dataStart + i]! & (1 << bit)) !== 0);
        }
      }
      return { coils };
    }

    case ModbusFunctionCode.READ_HOLDING_REGISTERS:
    case ModbusFunctionCode.READ_INPUT_REGISTERS: {
      const byteCount = data[byteCountOffset]!;
      const registers: number[] = [];
      const dataStart = byteCountOffset + 1;
      for (let i = 0; i < byteCount / 2; i++) {
        registers.push((data[dataStart + i * 2]! << 8) | data[dataStart + 1 + i * 2]!);
      }
      return { registers };
    }

    default:
      return {};
  }
}
