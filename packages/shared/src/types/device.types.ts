/**
 * 设备类型定义
 */

import { ProtocolType } from './protocol.types';
import { TransportType, ConnectionConfig } from './transport.types';

/**
 * 设备状态
 */
export enum DeviceStatus {
    /** 已断开 */
    DISCONNECTED = 'disconnected',
    /** 连接中 */
    CONNECTING = 'connecting',
    /** 已连接 */
    CONNECTED = 'connected',
    /** 错误 */
    ERROR = 'error'
}

/**
 * 设备配置
 */
export interface DeviceConfig {
    /** 设备唯一标识 */
    id: string;
    /** 设备名称 */
    name: string;
    /** 协议类型 */
    protocol: ProtocolType;
    /** 传输类型 */
    transport: TransportType;
    /** 连接配置 */
    connection: ConnectionConfig;
    /** 自定义配置（协议相关） */
    protocolConfig?: Record<string, unknown>;
}

/**
 * 设备实例
 */
export interface Device extends DeviceConfig {
    /** 当前状态 */
    status: DeviceStatus;
    /** 最后活动时间 */
    lastActiveAt?: Date;
    /** 错误信息 */
    lastError?: string;
}
