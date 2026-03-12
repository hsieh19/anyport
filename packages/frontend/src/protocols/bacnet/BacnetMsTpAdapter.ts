import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter,
    type ProtocolCommand,
    type ProtocolResponse
} from '@shared/types/protocol.types';
import { getBacnetCrc8, getBacnetCrc16 } from './bacnetCrc';

/**
 * BACnet MS/TP 帧类型
 */
export enum BacnetMsTpFrameType {
    Token = 0x00,
    PollForMaster = 0x01,
    ReplyToPollForMaster = 0x02,
    TestRequest = 0x03,
    TestResponse = 0x04,
    BacnetDataExpectingReply = 0x05,
    BacnetDataNotExpectingReply = 0x06,
    ReplyPostponed = 0x07
}

/**
 * BACnet MS/TP 命令
 */
export interface BacnetMsTpCommand extends ProtocolCommand {
    protocol: ProtocolType.BACNET_MSTP;
    /** 目标地址 (0-127, 255 为广播) */
    destinationAddress: number;
    /** 源地址 (通常由网关自动填充，但此处可预留) */
    sourceAddress: number;
    /** 帧类型 */
    frameType: BacnetMsTpFrameType;
    /** 数据负载 (NPDU + APDU) */
    data?: Uint8Array;
}

/**
 * BACnet MS/TP 响应
 */
export interface BacnetMsTpResponse extends ProtocolResponse {
    protocol: ProtocolType.BACNET_MSTP;
    /** 帧类型 */
    frameType?: BacnetMsTpFrameType;
    /** 源地址 */
    sourceAddress?: number;
    /** 目标地址 */
    destinationAddress?: number;
}

/**
 * BACnet MS/TP 适配器
 */
export class BacnetMsTpAdapter implements IProtocolAdapter<BacnetMsTpCommand, BacnetMsTpResponse> {
    readonly protocolType = ProtocolType.BACNET_MSTP;

    private readonly PREAMBLE1 = 0x55;
    private readonly PREAMBLE2 = 0xFF;

    /**
     * 编码 BACnet MS/TP 帧
     */
    encode(command: BacnetMsTpCommand): Uint8Array {
        const { destinationAddress, sourceAddress, frameType, data } = command;
        const dataLength = data ? data.length : 0;

        // 帧结构: P1 + P2 + Type + Dest + Src + Len(2) + HCRC + Data + DCRC(2)
        const headerLength = 8;
        const totalLength = headerLength + dataLength + (dataLength > 0 ? 2 : 0);
        const frame = new Uint8Array(totalLength);

        frame[0] = this.PREAMBLE1;
        frame[1] = this.PREAMBLE2;
        frame[2] = frameType;
        frame[3] = destinationAddress;
        frame[4] = sourceAddress;
        frame[5] = (dataLength >> 8) & 0xFF;
        frame[6] = dataLength & 0xFF;

        // 计算 Header CRC
        frame[7] = getBacnetCrc8(frame.slice(2, 7));

        if (dataLength > 0 && data) {
            frame.set(data, headerLength);
            const dataCrc = getBacnetCrc16(data);
            frame[headerLength + dataLength] = dataCrc & 0xFF; // LSB first? Standard says LSB then MSB for CRC16
            frame[headerLength + dataLength + 1] = (dataCrc >> 8) & 0xFF;

            // Wait, BACnet CRC16 is usually transmitted LSB first. 
            // Standard 135-2020 Clause 9.3: "CRC-16 is 16 bits... The low order byte shall be transmitted first".
            // My CRC tool for Modbus was MSB first. I should check my bacnetCrc implementation.
            // Actually getBacnetCrc16 returns the number, how it's placed in buffer matters.
        }

        return frame;
    }

    /**
     * 解码 BACnet MS/TP 帧
     */
    decode(data: Uint8Array): BacnetMsTpResponse | null {
        if (data.length < 8) return null;

        // 验证前导码
        if (data[0] !== this.PREAMBLE1 || data[1] !== this.PREAMBLE2) {
            return {
                protocol: ProtocolType.BACNET_MSTP,
                success: false,
                error: '非法前导码',
                raw: data
            };
        }

        // 验证 Header CRC
        const headerCrc = getBacnetCrc8(data.slice(2, 7));
        if (headerCrc !== data[7]) {
            return {
                protocol: ProtocolType.BACNET_MSTP,
                success: false,
                error: 'Header CRC 校验失败',
                raw: data
            };
        }

        const frameType = data[2]!;
        const destAddr = data[3]!;
        const srcAddr = data[4]!;
        const dataLen = (data[5]! << 8) | data[6]!;

        const response: BacnetMsTpResponse = {
            protocol: ProtocolType.BACNET_MSTP,
            success: true,
            frameType,
            destinationAddress: destAddr,
            sourceAddress: srcAddr,
            raw: data
        };

        if (dataLen > 0) {
            if (data.length < 8 + dataLen + 2) return null; // 数据不足

            const payload = data.slice(8, 8 + dataLen);
            const receivedDataCrc = (data[8 + dataLen + 1]! << 8) | data[8 + dataLen]!;
            const calculatedDataCrc = getBacnetCrc16(payload);

            if (receivedDataCrc !== calculatedDataCrc) {
                return {
                    ...response,
                    success: false,
                    error: 'Data CRC 校验失败',
                    data: payload
                };
            }
            response.data = payload;
        }

        return response;
    }

    /**
     * 检查帧完整性
     */
    checkFrame(buffer: Uint8Array): FrameCheckResult {
        if (buffer.length < 8) return FrameCheckResult.INCOMPLETE;

        // 寻找前导码起始位
        let start = -1;
        for (let i = 0; i <= buffer.length - 8; i++) {
            if (buffer[i] === this.PREAMBLE1 && buffer[i + 1] === this.PREAMBLE2) {
                start = i;
                break;
            }
        }

        if (start === -1) {
            // 如果缓冲区很长了还没找到前导码，说明是无效数据
            return buffer.length > 512 ? FrameCheckResult.INVALID : FrameCheckResult.INCOMPLETE;
        }

        // 必须从 start 开始检查
        const dataLen = (buffer[start + 5]! << 8) | buffer[start + 6]!;
        const expectedTotalLen = 8 + (dataLen > 0 ? dataLen + 2 : 0);

        if (buffer.length - start < expectedTotalLen) {
            return FrameCheckResult.INCOMPLETE;
        }

        // 验证 Header CRC
        const hCrc = getBacnetCrc8(buffer.slice(start + 2, start + 7));
        if (hCrc !== buffer[start + 7]) {
            return FrameCheckResult.INVALID;
        }

        return FrameCheckResult.COMPLETE;
    }
}
