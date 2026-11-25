export enum TransportType {
    /** Web Serial API - 本地直连 */
    WEB_SERIAL = 'web_serial',
    /** WebSocket - 服务器中转 (第二期) */
    WEBSOCKET = 'websocket',
    /** MQTT - ESP32 远程采集 */
    MQTT = 'mqtt',
    /** Local Bridge - 本地桥接程序 (WebSocket -> Go Bridge -> UDP/TCP) */
    BRIDGE = 'bridge'
}

export interface ConnectionConfig {
    serial?: {
        baudRate: number;
        dataBits?: 5 | 6 | 7 | 8;
        stopBits?: 1 | 2;
        parity?: 'none' | 'even' | 'odd';
        flowControl?: 'none' | 'hardware';
    };
    mqtt?: {
        brokerUrl: string;
        username: string;
        password: string;
        siteId: string;
        gatewayId: string;
        topicPrefix?: string;
        clientId?: string;
        deviceId?: string;
    };
}

export interface ITransportAdapter {
    readonly type: TransportType;

    readonly isConnected: boolean;

    connect(config: ConnectionConfig): Promise<void>;

    disconnect(): Promise<void>;

    send(data: Uint8Array): Promise<void>;

    onData(callback: (data: Uint8Array) => void): void;

    onError(callback: (error: Error) => void): void;

    onStateChange(callback: (connected: boolean) => void): void;
}

export interface GatewayStatusInfo {
    siteId: string;
    gatewayId: string;
    online: boolean;
    timestamp: number;
    config?: {
        version?: string;
        baud?: number;
        parity?: string;
        stopBits?: number;
        ethIp?: string;
        wifiIp?: string;
    };
}

export interface SendWithTargetPayload {
    protocol: 'tcp' | 'rtu';
    tcpTarget: { ip: string; port: number };
    rtuTarget: {
        baudRate: number;
        dataBits: number;
        stopBits: number;
        parity: string;
    };
}

/** MqttTransport 专属扩展接口（超出 ITransportAdapter 的方法） */
export interface IMqttTransport extends ITransportAdapter {
    onGatewayStatus(callback: (info: GatewayStatusInfo) => void): void;
    onPingResult(callback: (result: Record<string, unknown>) => void): void;
    selectGateway(siteId: string, gatewayId: string): Promise<void>;
    startDiscovery(): Promise<void>;
    sendWithTarget(data: Uint8Array, target: SendWithTargetPayload): Promise<void>;
    sendPing(ip: string, port: number, seq: number): Promise<void>;
}
