/**
 * Modbus RTU 协议适配器
 * 支持功能码 01/02/03/04/05/06/15/16
 */

import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter,
    type ProtocolCommand,
    type ProtocolResponse
} from '@shared/types/protocol.types';
import { calculateCRC16, crcToBytes, verifyCRC16 } from './crc16';

/**
 * Modbus 功能码
 */
export enum ModbusFunctionCode {
    /** 读线圈 */
    READ_COILS = 0x01,
    /** 读离散输入 */
    READ_DISCRETE_INPUTS = 0x02,
    /** 读保持寄存器 */
    READ_HOLDING_REGISTERS = 0x03,
    /** 读输入寄存器 */
    READ_INPUT_REGISTERS = 0x04,
    /** 写单个线圈 */
    WRITE_SINGLE_COIL = 0x05,
    /** 写单个寄存器 */
    WRITE_SINGLE_REGISTER = 0x06,
    /** 写多个线圈 */
    WRITE_MULTIPLE_COILS = 0x0F,
    /** 写多个寄存器 */
    WRITE_MULTIPLE_REGISTERS = 0x10
}

/**
 * Modbus RTU 命令
 */
export interface ModbusRtuCommand extends ProtocolCommand {
    protocol: ProtocolType.MODBUS_RTU;
    /** 从站地址 (1-247) */
    slaveAddress: number;
    /** 功能码 */
    functionCode: ModbusFunctionCode;
    /** 起始地址 */
    startAddress: number;
    /** 数量（寄存器/线圈数量）或写入值 */
    quantity?: number;
    /** 写入值（用于写操作）*/
    values?: number[];
}

/**
 * Modbus 响应（用于 RTU/TCP 共用解析结果）
 */
export interface ModbusRtuResponse extends ProtocolResponse {
    protocol: ProtocolType.MODBUS_RTU | ProtocolType.MODBUS_TCP;
    /** 从站地址 */
    slaveAddress?: number;
    /** 功能码 */
    functionCode?: number;
    /** 是否为异常响应 */
    isException?: boolean;
    /** 异常码 */
    exceptionCode?: number;
    /** 读取的数据（寄存器值数组）*/
    registers?: number[];
    /** 读取的位数据（线圈/离散输入）*/
    coils?: boolean[];
}

/**
 * Modbus RTU 适配器
 */
export class ModbusRtuAdapter implements IProtocolAdapter<ModbusRtuCommand, ModbusRtuResponse> {
    readonly protocolType = ProtocolType.MODBUS_RTU;

    /**
     * 编码 Modbus RTU 请求
     */
    encode(command: ModbusRtuCommand): Uint8Array {
        const { slaveAddress, functionCode, startAddress, quantity, values } = command;

        let pdu: Uint8Array;

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS:
                // 读操作：地址 + 功能码 + 起始地址(2) + 数量(2)
                pdu = new Uint8Array(6);
                pdu[0] = slaveAddress;
                pdu[1] = functionCode;
                pdu[2] = (startAddress >> 8) & 0xFF;
                pdu[3] = startAddress & 0xFF;
                pdu[4] = ((quantity ?? 1) >> 8) & 0xFF;
                pdu[5] = (quantity ?? 1) & 0xFF;
                break;

            case ModbusFunctionCode.WRITE_SINGLE_COIL:
                // 写单个线圈：地址 + 功能码 + 线圈地址(2) + 值(2)
                pdu = new Uint8Array(6);
                pdu[0] = slaveAddress;
                pdu[1] = functionCode;
                pdu[2] = (startAddress >> 8) & 0xFF;
                pdu[3] = startAddress & 0xFF;
                // 0xFF00 = ON, 0x0000 = OFF
                const coilValue = (values?.[0] ?? 0) ? 0xFF00 : 0x0000;
                pdu[4] = (coilValue >> 8) & 0xFF;
                pdu[5] = coilValue & 0xFF;
                break;

            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
                // 写单个寄存器：地址 + 功能码 + 寄存器地址(2) + 值(2)
                pdu = new Uint8Array(6);
                pdu[0] = slaveAddress;
                pdu[1] = functionCode;
                pdu[2] = (startAddress >> 8) & 0xFF;
                pdu[3] = startAddress & 0xFF;
                const regValue = values?.[0] ?? 0;
                pdu[4] = (regValue >> 8) & 0xFF;
                pdu[5] = regValue & 0xFF;
                break;

            case ModbusFunctionCode.WRITE_MULTIPLE_COILS: {
                // 写多个线圈
                const coilCount = values?.length ?? 0;
                const byteCount = Math.ceil(coilCount / 8);
                pdu = new Uint8Array(7 + byteCount);
                pdu[0] = slaveAddress;
                pdu[1] = functionCode;
                pdu[2] = (startAddress >> 8) & 0xFF;
                pdu[3] = startAddress & 0xFF;
                pdu[4] = (coilCount >> 8) & 0xFF;
                pdu[5] = coilCount & 0xFF;
                pdu[6] = byteCount;
                // 打包线圈值
                for (let i = 0; i < coilCount; i++) {
                    if (values?.[i]) {
                        pdu[7 + Math.floor(i / 8)]! |= (1 << (i % 8));
                    }
                }
                break;
            }

            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS: {
                // 写多个寄存器
                const regCount = values?.length ?? 0;
                pdu = new Uint8Array(7 + regCount * 2);
                pdu[0] = slaveAddress;
                pdu[1] = functionCode;
                pdu[2] = (startAddress >> 8) & 0xFF;
                pdu[3] = startAddress & 0xFF;
                pdu[4] = (regCount >> 8) & 0xFF;
                pdu[5] = regCount & 0xFF;
                pdu[6] = regCount * 2;
                for (let i = 0; i < regCount; i++) {
                    const val = values?.[i] ?? 0;
                    pdu[7 + i * 2] = (val >> 8) & 0xFF;
                    pdu[8 + i * 2] = val & 0xFF;
                }
                break;
            }

            default:
                throw new Error(`不支持的功能码: ${functionCode}`);
        }

        // 计算并附加 CRC
        const crc = calculateCRC16(pdu);
        const frame = new Uint8Array(pdu.length + 2);
        frame.set(pdu);
        frame.set(crcToBytes(crc), pdu.length);

        return frame;
    }

    /**
     * 解码 Modbus RTU 响应
     */
    decode(data: Uint8Array): ModbusRtuResponse | null {
        if (data.length < 5) {
            return null; // 数据不完整
        }

        // 验证 CRC
        if (!verifyCRC16(data)) {
            return {
                protocol: ProtocolType.MODBUS_RTU,
                success: false,
                error: 'CRC 校验失败',
                raw: data
            };
        }

        const slaveAddress = data[0]!;
        const functionCode = data[1]!;

        // 检查是否为异常响应（功能码最高位为 1）
        if (functionCode & 0x80) {
            return {
                protocol: ProtocolType.MODBUS_RTU,
                success: false,
                slaveAddress,
                functionCode: functionCode & 0x7F,
                isException: true,
                exceptionCode: data[2],
                error: this.getExceptionMessage(data[2]!),
                raw: data
            };
        }

        // 解析正常响应
        const response: ModbusRtuResponse = {
            protocol: ProtocolType.MODBUS_RTU,
            success: true,
            slaveAddress,
            functionCode,
            raw: data
        };

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS: {
                const byteCount = data[2]!;
                const coils: boolean[] = [];
                for (let i = 0; i < byteCount; i++) {
                    for (let bit = 0; bit < 8; bit++) {
                        coils.push((data[3 + i]! & (1 << bit)) !== 0);
                    }
                }
                response.coils = coils;
                break;
            }

            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS: {
                const byteCount = data[2]!;
                const registers: number[] = [];
                for (let i = 0; i < byteCount / 2; i++) {
                    registers.push((data[3 + i * 2]! << 8) | data[4 + i * 2]!);
                }
                response.registers = registers;
                break;
            }

            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                // 写操作响应，只需确认成功
                break;
        }

        return response;
    }

    /**
     * 检查帧完整性
     */
    checkFrame(buffer: Uint8Array): FrameCheckResult {
        if (buffer.length < 5) {
            // 这里我们至少需要读到功能码(index 1)和异常码(index 2)或者字节数(index 2)
            // 所以长度限制至少要能判断出后续逻辑
            // 不过标准的最小帧是异常帧 5 字节
            // 如果还不到5字节，肯定是 INCOMPLETE (除非是特短的非标协议，但 Modbus RTU 最小就是5)
            return FrameCheckResult.INCOMPLETE;
        }

        const functionCode = buffer[1]!;

        // 异常响应固定 5 字节
        if (functionCode & 0x80) {
            if (buffer.length >= 5) {
                return verifyCRC16(buffer.slice(0, 5))
                    ? FrameCheckResult.COMPLETE
                    : FrameCheckResult.INVALID;
            }
            return FrameCheckResult.INCOMPLETE;
        }

        // 计算期望长度
        let expectedLength: number;

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS:
                if (buffer.length < 3) return FrameCheckResult.INCOMPLETE;
                expectedLength = 3 + buffer[2]! + 2; // 地址+功能码+字节数 + 数据 + CRC
                break;

            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
                expectedLength = 8;
                break;

            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                expectedLength = 8;
                break;

            default:
                return FrameCheckResult.INVALID;
        }

        if (buffer.length < expectedLength) {
            return FrameCheckResult.INCOMPLETE;
        }

        // 验证 CRC
        return verifyCRC16(buffer.slice(0, expectedLength))
            ? FrameCheckResult.COMPLETE
            : FrameCheckResult.INVALID;
    }

    /**
     * 获取异常码描述
     */
    private getExceptionMessage(code: number): string {
        const messages: Record<number, string> = {
            0x01: '非法功能码',
            0x02: '非法数据地址',
            0x03: '非法数据值',
            0x04: '从站设备故障',
            0x05: '确认',
            0x06: '从站设备忙',
            0x08: '存储奇偶性差错',
            0x0A: '不可用网关路径',
            0x0B: '网关目标设备响应失败'
        };
        return messages[code] ?? `未知异常 (0x${code.toString(16).toUpperCase()})`;
    }
}
