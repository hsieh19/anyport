import {
    ProtocolType,
    FrameCheckResult,
    type IProtocolAdapter,
    type ProtocolCommand,
    type ProtocolResponse
} from '@shared/types/protocol.types';

/**
 * BACnet/IP BVLC 功能码
 */
export enum BacnetIpBvlcFunction {
    Result = 0x00,
    WriteBroadcastDistributionTable = 0x01,
    ReadBroadcastDistributionTable = 0x02,
    ForwardedNPDU = 0x04,
    RegisterForeignDevice = 0x05,
    ReadForeignDeviceTable = 0x06,
    DeleteForeignDeviceTableEntry = 0x07,
    DistributeBroadcastToNetwork = 0x09,
    OriginalUnicastNPDU = 0x0A,
    OriginalBroadcastNPDU = 0x0B
}

/**
 * BACnet/IP 命令
 */
export interface BacnetIpCommand extends ProtocolCommand {
    protocol: ProtocolType.BACNET_IP;
    /** BVLC 功能码 */
    bvlcFunction: BacnetIpBvlcFunction;
    /** 数据负载 (NPDU + APDU) */
    data?: Uint8Array;
}

/**
 * BACnet/IP 响应
 */
export interface BacnetIpResponse extends ProtocolResponse {
    protocol: ProtocolType.BACNET_IP;
    /** BVLC 功能码 */
    bvlcFunction?: BacnetIpBvlcFunction;
}

/**
 * BACnet/IP 适配器
 */
export class BacnetIpAdapter implements IProtocolAdapter<BacnetIpCommand, BacnetIpResponse> {
    readonly protocolType = ProtocolType.BACNET_IP;

    private readonly BVLC_TYPE = 0x81;

    /**
     * 编码 BACnet/IP 帧 (BVLCI)
     */
    encode(command: BacnetIpCommand): Uint8Array {
        const { bvlcFunction, data } = command;
        const dataLength = data ? data.length : 0;
        const totalLength = 4 + dataLength;

        const frame = new Uint8Array(totalLength);
        frame[0] = this.BVLC_TYPE;
        frame[1] = bvlcFunction;
        frame[2] = (totalLength >> 8) & 0xFF;
        frame[3] = totalLength & 0xFF;

        if (data && dataLength > 0) {
            frame.set(data, 4);
        }

        return frame;
    }

    /**
     * 解码 BACnet/IP 帧
     */
    decode(data: Uint8Array): BacnetIpResponse | null {
        if (data.length < 4) return null;

        if (data[0] !== this.BVLC_TYPE) {
            return {
                protocol: ProtocolType.BACNET_IP,
                success: false,
                error: '非法 BVLC 类型',
                raw: data
            };
        }

        const bvlcFunction = data[1]!;
        const totalLength = (data[2]! << 8) | data[3]!;

        if (data.length < totalLength) return null; // 数据不足

        const payload = data.slice(4, totalLength);

        return {
            protocol: ProtocolType.BACNET_IP,
            success: true,
            bvlcFunction,
            data: payload,
            raw: data.slice(0, totalLength)
        };
    }

    /**
     * 检查帧完整性
     */
    checkFrame(buffer: Uint8Array): FrameCheckResult {
        if (buffer.length < 4) return FrameCheckResult.INCOMPLETE;

        if (buffer[0] !== this.BVLC_TYPE) {
            return FrameCheckResult.INVALID;
        }

        const totalLength = (buffer[2]! << 8) | buffer[3]!;
        if (buffer.length < totalLength) {
            return FrameCheckResult.INCOMPLETE;
        }

        return FrameCheckResult.COMPLETE;
    }
}
