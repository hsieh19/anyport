/**
 * 传输层类型定义
 * 支持 Web Serial、WebSocket、MQTT 等多种传输方式
 */

/**
 * 传输类型枚举
 */
export enum TransportType {
    /** Web Serial API - 本地直连 */
    WEB_SERIAL = 'web_serial',
    /** WebSocket - 服务器中转 (第二期) */
    WEBSOCKET = 'websocket',
    /** MQTT - ESP32 远程采集 (第二期) */
    MQTT = 'mqtt'
}

/**
 * 连接配置
 */
export interface ConnectionConfig {
    /** 串口配置 */
    serial?: {
        baudRate: number;
        dataBits?: 5 | 6 | 7 | 8;
        stopBits?: 1 | 2;
        parity?: 'none' | 'even' | 'odd';
        flowControl?: 'none' | 'hardware';
    };
    /** WebSocket 配置 (第二期) */
    websocket?: {
        url: string;
        deviceId?: string;
    };
    /** MQTT 配置 (第二期) */
    mqtt?: {
        brokerUrl: string;
        clientId: string;
        deviceId: string;
    };
}

/**
 * 传输层适配器接口
 * 所有传输方式都必须实现此接口
 */
export interface ITransportAdapter {
    /** 传输类型 */
    readonly type: TransportType;

    /** 是否已连接 */
    readonly isConnected: boolean;

    /**
     * 建立连接
     * @param config 连接配置
     */
    connect(config: ConnectionConfig): Promise<void>;

    /**
     * 断开连接
     */
    disconnect(): Promise<void>;

    /**
     * 发送数据
     * @param data 要发送的数据
     */
    send(data: Uint8Array): Promise<void>;

    /**
     * 注册数据接收回调
     * @param callback 数据接收回调函数
     */
    onData(callback: (data: Uint8Array) => void): void;

    /**
     * 注册错误回调
     * @param callback 错误回调函数
     */
    onError(callback: (error: Error) => void): void;

    /**
     * 注册连接状态变化回调
     * @param callback 状态变化回调函数
     */
    onStateChange(callback: (connected: boolean) => void): void;
}
