import { getExceptionMessage } from './modbusErrors';
import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter
} from '@shared/types/protocol.types';
import {
    type ModbusRtuCommand,
    type ModbusRtuResponse
} from './ModbusRtuAdapter';
import { encodeModbusRequestPdu, decodeModbusReadPayload } from './modbusPdu';

export class ModbusTcpAdapter implements IProtocolAdapter<ModbusRtuCommand, ModbusRtuResponse> {
    readonly protocolType = ProtocolType.MODBUS_TCP;

    private transactionId = 0;

    /**
     * 编码命令（正式发送，会自增事务 ID）
     */
    encode(command: ModbusRtuCommand): Uint8Array {
        this.transactionId = (this.transactionId + 1) & 0xFFFF;
        return this.internalEncode(command, this.transactionId);
    }

    /**
     * 预览报文（无副作用，显示即将使用的 ID）
     */
    preview(command: ModbusRtuCommand): Uint8Array {
        const nextId = (this.transactionId + 1) & 0xFFFF;
        return this.internalEncode(command, nextId);
    }

    /**
     * 内部编码逻辑 (MBAP 7字节报头 + PDU)
     */
    private internalEncode(command: ModbusRtuCommand, tid: number): Uint8Array {
        const pdu = encodeModbusRequestPdu(command);
        const unitId = command.slaveAddress & 0xFF;
        const adu = new Uint8Array(7 + pdu.length);

        adu[0] = (tid >> 8) & 0xFF;
        adu[1] = tid & 0xFF;
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
                error: getExceptionMessage(exceptionCode),
                raw: data
            };
        }

        return {
            protocol: ProtocolType.MODBUS_TCP,
            success: true,
            slaveAddress: unitId,
            functionCode,
            raw: data,
            ...decodeModbusReadPayload(functionCode, data, 8)
        };
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
}
