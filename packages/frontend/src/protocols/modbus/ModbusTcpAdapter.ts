import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter
} from '@shared/types/protocol.types';
import {
    ModbusFunctionCode,
    type ModbusRtuCommand,
    type ModbusRtuResponse
} from './ModbusRtuAdapter';

export class ModbusTcpAdapter implements IProtocolAdapter<ModbusRtuCommand, ModbusRtuResponse> {
    readonly protocolType = ProtocolType.MODBUS_TCP;

    private transactionId = 0;

    encode(command: ModbusRtuCommand): Uint8Array {
        const { slaveAddress, functionCode, startAddress, quantity, values } = command;

        let pdu: Uint8Array;

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS: {
                pdu = new Uint8Array(5);
                pdu[0] = functionCode;
                pdu[1] = (startAddress >> 8) & 0xFF;
                pdu[2] = startAddress & 0xFF;
                const qty = quantity ?? 1;
                pdu[3] = (qty >> 8) & 0xFF;
                pdu[4] = qty & 0xFF;
                break;
            }

            case ModbusFunctionCode.WRITE_SINGLE_COIL: {
                pdu = new Uint8Array(5);
                pdu[0] = functionCode;
                pdu[1] = (startAddress >> 8) & 0xFF;
                pdu[2] = startAddress & 0xFF;
                const coilValue = (values?.[0] ?? 0) ? 0xFF00 : 0x0000;
                pdu[3] = (coilValue >> 8) & 0xFF;
                pdu[4] = coilValue & 0xFF;
                break;
            }

            case ModbusFunctionCode.WRITE_SINGLE_REGISTER: {
                pdu = new Uint8Array(5);
                pdu[0] = functionCode;
                pdu[1] = (startAddress >> 8) & 0xFF;
                pdu[2] = startAddress & 0xFF;
                const regValue = values?.[0] ?? 0;
                pdu[3] = (regValue >> 8) & 0xFF;
                pdu[4] = regValue & 0xFF;
                break;
            }

            case ModbusFunctionCode.WRITE_MULTIPLE_COILS: {
                const coilCount = values?.length ?? 0;
                const byteCount = Math.ceil(coilCount / 8);
                pdu = new Uint8Array(6 + byteCount);
                pdu[0] = functionCode;
                pdu[1] = (startAddress >> 8) & 0xFF;
                pdu[2] = startAddress & 0xFF;
                pdu[3] = (coilCount >> 8) & 0xFF;
                pdu[4] = coilCount & 0xFF;
                pdu[5] = byteCount;
                for (let i = 0; i < coilCount; i++) {
                    if (values?.[i]) {
                        pdu[6 + Math.floor(i / 8)]! |= 1 << (i % 8);
                    }
                }
                break;
            }

            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS: {
                const regCount = values?.length ?? 0;
                pdu = new Uint8Array(6 + regCount * 2);
                pdu[0] = functionCode;
                pdu[1] = (startAddress >> 8) & 0xFF;
                pdu[2] = startAddress & 0xFF;
                pdu[3] = (regCount >> 8) & 0xFF;
                pdu[4] = regCount & 0xFF;
                pdu[5] = regCount * 2;
                for (let i = 0; i < regCount; i++) {
                    const val = values?.[i] ?? 0;
                    pdu[6 + i * 2] = (val >> 8) & 0xFF;
                    pdu[7 + i * 2] = val & 0xFF;
                }
                break;
            }

            default:
                throw new Error(`不支持的功能码: ${functionCode}`);
        }

        const unitId = command.slaveAddress & 0xFF;

        this.transactionId = (this.transactionId + 1) & 0xFFFF;
        const adu = new Uint8Array(7 + pdu.length);

        adu[0] = (this.transactionId >> 8) & 0xFF;
        adu[1] = this.transactionId & 0xFF;
        adu[2] = 0;
        adu[3] = 0;

        const length = pdu.length + 1;
        adu[4] = (length >> 8) & 0xFF;
        adu[5] = length & 0xFF;

        adu[6] = unitId;

        adu.set(pdu, 7);

        return adu;
    }

    decode(data: Uint8Array): ModbusRtuResponse | null {
        if (data.length < 9) {
            return null;
        }

        const lengthField = (data[4]! << 8) | data[5]!;
        const expectedLength = 6 + lengthField;

        if (data.length < expectedLength) {
            return null;
        }

        const unitId = data[6]!;
        const functionCode = data[7]!;

        if (functionCode & 0x80) {
            const exceptionCode = data[8]!;
            return {
                protocol: ProtocolType.MODBUS_TCP,
                success: false,
                slaveAddress: unitId,
                functionCode: functionCode & 0x7F,
                isException: true,
                exceptionCode,
                error: this.getExceptionMessage(exceptionCode),
                raw: data
            };
        }

        const response: ModbusRtuResponse = {
            protocol: ProtocolType.MODBUS_TCP,
            success: true,
            slaveAddress: unitId,
            functionCode,
            raw: data
        };

        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS: {
                const byteCount = data[8]!;
                const coils: boolean[] = [];
                for (let i = 0; i < byteCount; i++) {
                    for (let bit = 0; bit < 8; bit++) {
                        coils.push((data[9 + i]! & (1 << bit)) !== 0);
                    }
                }
                response.coils = coils;
                break;
            }

            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS: {
                const byteCount = data[8]!;
                const registers: number[] = [];
                for (let i = 0; i < byteCount / 2; i++) {
                    registers.push((data[9 + i * 2]! << 8) | data[10 + i * 2]!);
                }
                response.registers = registers;
                break;
            }

            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                break;
        }

        return response;
    }

    checkFrame(buffer: Uint8Array): FrameCheckResult {
        if (buffer.length < 9) {
            return FrameCheckResult.INCOMPLETE;
        }

        const lengthField = (buffer[4]! << 8) | buffer[5]!;
        if (lengthField <= 0) {
            return FrameCheckResult.INVALID;
        }

        const expectedLength = 6 + lengthField;
        if (buffer.length < expectedLength) {
            return FrameCheckResult.INCOMPLETE;
        }

        return FrameCheckResult.COMPLETE;
    }

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

