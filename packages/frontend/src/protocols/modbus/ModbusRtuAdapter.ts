/**
 * Modbus RTU 协议适配器
 * 支持功能码 01/02/03/04/05/06/15/16
 */

import { getExceptionMessage } from './modbusErrors';
import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter,
    type ProtocolCommand,
    type ProtocolResponse
} from '@shared/types/protocol.types';
import { appendCRC16, verifyCRC16 } from './crc16';
import { encodeModbusRequestPdu, decodeModbusReadPayload } from './modbusPdu';

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
        const pdu = encodeModbusRequestPdu(command);
        const body = new Uint8Array(1 + pdu.length);
        body[0] = command.slaveAddress & 0xFF;
        body.set(pdu, 1);
        return appendCRC16(body);
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
                error: getExceptionMessage(data[2]!),
                raw: data
            };
        }

        return {
            protocol: ProtocolType.MODBUS_RTU,
            success: true,
            slaveAddress,
            functionCode,
            raw: data,
            ...decodeModbusReadPayload(functionCode, data, 2)
        };
    }

    /**
     * 检查帧完整性
     */
    checkFrame(buffer: Uint8Array): FrameCheckResult {
        if (buffer.length < 5) {
            return FrameCheckResult.INCOMPLETE;
        }

        const functionCode = buffer[1]!;

        // 异常响应固定 5 字节
        if (functionCode & 0x80) {
            return verifyCRC16(buffer.slice(0, 5))
                ? FrameCheckResult.COMPLETE
                : FrameCheckResult.INVALID;
        }

        // 计算期望长度
        let expectedLength: number;

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS:
                expectedLength = 3 + buffer[2]! + 2; // 地址+功能码+字节数 + 数据 + CRC
                break;

            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
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

        return verifyCRC16(buffer.slice(0, expectedLength))
            ? FrameCheckResult.COMPLETE
            : FrameCheckResult.INVALID;
    }
}
