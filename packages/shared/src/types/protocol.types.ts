/**
 * 协议层类型定义
 * 支持 Modbus、DL/T 645 等多种工业协议
 */

/**
 * 协议类型枚举
 */
export enum ProtocolType {
    /** Modbus RTU */
    MODBUS_RTU = 'modbus_rtu',
    /** Modbus TCP */
    MODBUS_TCP = 'modbus_tcp',
    /** DL/T 645 电力协议 (第二期) */
    DLT645 = 'dlt645',
    /** RS232/RS485 Hex 透传 (第二期) */
    HEX_RAW = 'hex_raw',
    /** BACnet MS/TP (第二期) */
    BACNET_MSTP = 'bacnet_mstp'
}

/**
 * 帧检测结果
 */
export enum FrameCheckResult {
    /** 帧完整 */
    COMPLETE = 'complete',
    /** 帧不完整，需要继续接收 */
    INCOMPLETE = 'incomplete',
    /** 帧无效 */
    INVALID = 'invalid'
}

/**
 * 协议命令基类
 */
export interface ProtocolCommand {
    /** 协议类型 */
    protocol: ProtocolType;
    /** 原始命令数据 */
    raw?: Uint8Array;
}

/**
 * 协议响应基类
 */
export interface ProtocolResponse {
    /** 协议类型 */
    protocol: ProtocolType;
    /** 是否成功 */
    success: boolean;
    /** 错误信息 */
    error?: string;
    /** 原始响应数据 */
    raw?: Uint8Array;
    /** 解析后的数据 */
    data?: unknown;
}

export type ModbusRequest = ProtocolCommand;

export type ModbusResponse = ProtocolResponse;

/**
 * 协议适配器接口
 * 所有协议都必须实现此接口
 */
export interface IProtocolAdapter<
    TCommand extends ProtocolCommand = ProtocolCommand,
    TResponse extends ProtocolResponse = ProtocolResponse
> {
    /** 协议类型 */
    readonly protocolType: ProtocolType;

    /**
     * 编码命令
     * @param command 命令对象
     * @returns 编码后的字节数组
     */
    encode(command: TCommand): Uint8Array;

    /**
     * 解码响应
     * @param data 接收到的字节数组
     * @returns 解析后的响应，如果数据不完整返回 null
     */
    decode(data: Uint8Array): TResponse | null;

    /**
     * 检查帧完整性
     * @param buffer 接收缓冲区
     * @returns 帧检测结果
     */
    checkFrame(buffer: Uint8Array): FrameCheckResult;
}
