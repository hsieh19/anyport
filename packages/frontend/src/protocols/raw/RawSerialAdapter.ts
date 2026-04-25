import { ProtocolType, FrameCheckResult, type IProtocolAdapter } from '@shared/types/protocol.types';

export interface RawSerialCommand {
    protocol: ProtocolType.HEX_RAW;
    type: 'hex' | 'ascii';
    data: string;
    suffix?: 'none' | 'cr' | 'lf' | 'crlf';
}

export class RawSerialAdapter implements IProtocolAdapter<RawSerialCommand, any> {
    readonly protocolType = ProtocolType.HEX_RAW;

    /**
     * 编码：支持将输入转换成字节数组
     */
    encode(command: RawSerialCommand): Uint8Array {
        let bytes: number[] = [];
        
        if (command.type === 'hex') {
            // 过滤掉所有空白字符
            const hexStr = command.data.replace(/\s+/g, '');
            for (let i = 0; i < hexStr.length; i += 2) {
                // 如果只剩下一个字符，补0
                const chunk = hexStr.substring(i, i + 2);
                bytes.push(parseInt(chunk.length === 1 ? chunk + '0' : chunk, 16));
            }
        } else {
            // ASCII 模式，处理转义字符
            const str = command.data
                .replace(/\\r/g, '\r')
                .replace(/\\n/g, '\n')
                .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                
            for (let i = 0; i < str.length; i++) {
                bytes.push(str.charCodeAt(i));
            }
        }

        if (command.suffix === 'cr') bytes.push(0x0D);
        else if (command.suffix === 'lf') bytes.push(0x0A);
        else if (command.suffix === 'crlf') bytes.push(0x0D, 0x0A);

        return new Uint8Array(bytes);
    }

    /**
     * 解码：直接抛出原始数据
     */
    decode(data: Uint8Array): any {
        return { raw: Array.from(data) };
    }

    /**
     * 对于 Raw 协议，我们在 Store 的 handleData 中使用空闲超时分包机制，
     * 所以此方法仅作为接口兼容，返回 INCOMPLETE 即可，防止 Store 传统逻辑立刻清空 buffer。
     * 但如果是传统的完整检测，这里不能做 idle timeout，必须交由外部或者专门适配。
     */
    checkFrame(_buffer: Uint8Array): FrameCheckResult {
        return FrameCheckResult.INCOMPLETE;
    }
}
