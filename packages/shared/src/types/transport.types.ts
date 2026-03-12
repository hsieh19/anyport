import type { ModbusRequest, ModbusResponse } from './protocol.types';

export enum TransportType {
    /** Web Serial API - 本地直连 */
    WEB_SERIAL = 'web_serial',
    /** WebSocket - 服务器中转 (第二期) */
    WEBSOCKET = 'websocket',
    /** MQTT - ESP32 远程采集 */
    MQTT = 'mqtt',
    /** Local Bridge - 本地桥接程序 (WebSocket -> Go Bridge -> UDP) */
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

export interface MqttTopicContext {
    siteId: string;
    gatewayId: string;
}

export interface MqttSessionTopicContext extends MqttTopicContext {
    sessionId: string;
}

export type MqttRequestTopic = `anyport/${string}/${string}/request/${string}`;

export type MqttResponseTopic = `anyport/${string}/${string}/response/${string}`;

export type MqttStatusTopic = `anyport/${string}/${string}/status`;

export type MqttStatusPayload = 'online' | 'offline';

export type MqttRequestPayload = ModbusRequest;

export type MqttResponsePayload = ModbusResponse;
