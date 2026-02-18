/**
 * 设备连接状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { WebSerialTransport } from '@/transports/WebSerialTransport';
import { MqttTransport } from '@/transports/MqttTransport';
import { ModbusRtuAdapter, ModbusTcpAdapter } from '@/protocols/modbus';
import { type ConnectionConfig } from '@shared/types/transport.types';
import { FrameCheckResult, type IProtocolAdapter } from '@shared/types/protocol.types';
import type { ModbusRtuCommand, ModbusRtuResponse } from '@/protocols/modbus';

// 物理连接通道
export type ConnectionType = 'serial' | 'mqtt';

// 网关配置结构（下游 Modbus 目标配置）
export interface GatewayConfig {
    protocol: 'tcp' | 'rtu';
    tcpTarget: {
        ip: string;
        port: number;
    };
    rtuTarget: {
        baudRate: number;
        dataBits: 8;
        stopBits: 1 | 2;
        parity: 'none' | 'even' | 'odd';
    };
}

/**
 * 通信日志条目
 */
export interface LogEntry {
    id: string;
    timestamp: Date;
    direction: 'tx' | 'rx';
    data: Uint8Array;
    hex: string;
    parsed?: ModbusRtuResponse;
}

type ModbusMode = 'rtu' | 'tcp';

interface ModbusTcpOptions {
    ip: string;
    port: number;
}

interface MqttConfig {
    brokerUrl: string;
    username: string;
    password: string;
    clientId: string;
    topicPrefix: string;
    siteId: string;
    gatewayId: string;
}

interface DiscoveredGateway {
    id: string;
    siteId: string;
    gatewayId: string;
    online: boolean;
    lastSeen: number;
    config?: {
        version?: string;
        baud?: number;
        parity?: string;
        stopBits?: number;
        ethIp?: string;   // W5500 以太网 IP
        wifiIp?: string;  // WiFi IP
    };
}

export const useDeviceStore = defineStore('device', () => {
    // 状态
    const transport = ref<WebSerialTransport | null>(null);
    const mqttTransport = ref<MqttTransport | null>(null);
    const rtuAdapter = new ModbusRtuAdapter();
    const tcpAdapter = new ModbusTcpAdapter();
    const adapter = ref<IProtocolAdapter<ModbusRtuCommand, ModbusRtuResponse>>(rtuAdapter);
    const isConnected = ref(false);
    const isConnecting = ref(false);
    const isMqttBrokerConnected = ref(false);  // MQTT Broker 连接状态（独立于网关连接）
    const isMqttBrokerConnecting = ref(false);
    const lastError = ref<string | null>(null);
    const logs = ref<LogEntry[]>([]);
    const receiveBuffer = ref<Uint8Array>(new Uint8Array(0));
    const modbusMode = ref<ModbusMode>('rtu');
    const tcpOptions = ref<ModbusTcpOptions>({
        ip: '127.0.0.1',
        port: 502
    });
    const mqttConfig = ref<MqttConfig>({
        brokerUrl: 'wss://broker.emqx.io:8084/mqtt',
        username: '',
        password: '',
        clientId: '',
        topicPrefix: 'anyport',
        siteId: '',
        gatewayId: ''
    });
    const connectionType = ref<ConnectionType>('serial');
    const gatewayOptions = ref<GatewayConfig>({
        protocol: 'tcp',
        tcpTarget: {
            ip: '192.168.1.5',
            port: 502
        },
        rtuTarget: {
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        }
    });
    const gateways = ref<DiscoveredGateway[]>([]);

    const GATEWAY_OFFLINE_TIMEOUT_MS = 30000;
    let gatewayHeartbeatTimer: number | null = null;

    function updateGatewayStatus(
        siteId: string,
        gatewayId: string,
        online: boolean,
        timestamp: number,
        config?: { version?: string; baud?: number; parity?: string; stopBits?: number }
    ): void {
        const id = `${siteId}/${gatewayId}`;
        const existingIndex = gateways.value.findIndex(g => g.id === id);
        if (existingIndex === -1) {
            gateways.value = [
                ...gateways.value,
                {
                    id,
                    siteId,
                    gatewayId,
                    online,
                    lastSeen: timestamp,
                    config
                }
            ];
        } else {
            const current = gateways.value[existingIndex]!;
            gateways.value.splice(existingIndex, 1, {
                ...current,
                online,
                lastSeen: timestamp,
                // config 有新值时更新，没有则保留旧值
                config: config ?? current.config
            });
        }
    }

    function startGatewayHeartbeatMonitor(): void {
        if (gatewayHeartbeatTimer !== null) {
            return;
        }
        gatewayHeartbeatTimer = window.setInterval(() => {
            const now = Date.now();
            let changed = false;
            const next: DiscoveredGateway[] = gateways.value.map(gateway => {
                if (gateway.online && now - gateway.lastSeen > GATEWAY_OFFLINE_TIMEOUT_MS) {
                    changed = true;
                    return {
                        ...gateway,
                        online: false
                    };
                }
                return gateway;
            });
            if (changed) {
                gateways.value = next;
            }
        }, 5000);
    }

    function removeGateway(id: string): void {
        gateways.value = gateways.value.filter(g => g.id !== id);
    }

    function clearOfflineGateways(): void {
        gateways.value = gateways.value.filter(g => g.online);
    }

    function updateGatewayOptions(options: Partial<GatewayConfig>): void {
        gatewayOptions.value = {
            ...gatewayOptions.value,
            ...options
        };
    }

    // 连接配置
    const connectionConfig = ref<ConnectionConfig>({
        serial: {
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        }
    });

    // 计算属性
    const isSupported = computed(() => WebSerialTransport.isSupported());

    // 方法
    async function connect(): Promise<void> {
        if (isConnected.value || isConnecting.value) return;

        isConnecting.value = true;
        lastError.value = null;

        try {
            if (connectionType.value === 'serial') {
                if (mqttTransport.value && mqttTransport.value.isConnected) {
                    await mqttTransport.value.disconnect();
                }
                mqttTransport.value = null;

                const instance = new WebSerialTransport();
                transport.value = instance;

                instance.onData(handleData);
                instance.onError(handleError);
                instance.onStateChange(handleSerialStateChange);

                await instance.connect(connectionConfig.value);
                isConnected.value = true;
            }
        } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error);
            transport.value = null;
            mqttTransport.value = null;
            isConnected.value = false;
        } finally {
            isConnecting.value = false;
        }
    }

    // 连接 MQTT Broker（只订阅通配符，用于自动发现网关，不影响 isConnected）
    async function connectMqttBroker(): Promise<void> {
        if (isMqttBrokerConnected.value || isMqttBrokerConnecting.value) return;

        isMqttBrokerConnecting.value = true;
        lastError.value = null;

        try {
            // 如果已有旧连接，先断开
            if (mqttTransport.value) {
                await mqttTransport.value.disconnect();
                mqttTransport.value = null;
            }
            isConnected.value = false;

            const instance = new MqttTransport();
            mqttTransport.value = instance;

            instance.onData(handleData);
            instance.onError(handleError);
            instance.onStateChange(connected => {
                isMqttBrokerConnected.value = connected;
                if (!connected) {
                    isConnected.value = false;
                    if (mqttTransport.value === instance) {
                        mqttTransport.value = null;
                    }
                    receiveBuffer.value = new Uint8Array(0);
                }
            });
            instance.onGatewayStatus(info => {
                updateGatewayStatus(info.siteId, info.gatewayId, info.online, info.timestamp, info.config);
            });

            const opts = mqttConfig.value;
            // Broker 连接阶段：siteId/gatewayId 用占位符，只订阅通配符
            const config: ConnectionConfig = {
                mqtt: {
                    brokerUrl: opts.brokerUrl,
                    username: opts.username,
                    password: opts.password,
                    siteId: opts.siteId || '_',
                    gatewayId: opts.gatewayId || '_',
                    topicPrefix: opts.topicPrefix,
                    clientId: opts.clientId || `anyport-web-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`
                }
            };

            await instance.connect(config);
            isMqttBrokerConnected.value = true;
        } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error);
            mqttTransport.value = null;
            isMqttBrokerConnected.value = false;
        } finally {
            isMqttBrokerConnecting.value = false;
        }
    }

    // 连接网关（在 Broker 已连的基础上，重连并绑定具体 siteId/gatewayId）
    async function connectMqtt(): Promise<void> {
        if (isConnected.value || isConnecting.value) return;
        if (!isMqttBrokerConnected.value) {
            // Broker 未连，先连 Broker 再连网关
            await connectMqttBroker();
            if (!isMqttBrokerConnected.value) return;
        }

        isConnecting.value = true;
        lastError.value = null;

        try {
            // 断开旧连接，用正确的 siteId/gatewayId 重新连接
            if (mqttTransport.value) {
                await mqttTransport.value.disconnect();
                mqttTransport.value = null;
            }
            isMqttBrokerConnected.value = false;

            const instance = new MqttTransport();
            mqttTransport.value = instance;

            instance.onData(handleData);
            instance.onError(handleError);
            instance.onStateChange(connected => {
                isMqttBrokerConnected.value = connected;
                isConnected.value = connected;
                if (!connected && mqttTransport.value === instance) {
                    mqttTransport.value = null;
                    receiveBuffer.value = new Uint8Array(0);
                }
            });
            instance.onGatewayStatus(info => {
                updateGatewayStatus(info.siteId, info.gatewayId, info.online, info.timestamp, info.config);
            });

            const opts = mqttConfig.value;
            const config: ConnectionConfig = {
                mqtt: {
                    brokerUrl: opts.brokerUrl,
                    username: opts.username,
                    password: opts.password,
                    siteId: opts.siteId,
                    gatewayId: opts.gatewayId,
                    topicPrefix: opts.topicPrefix,
                    clientId: opts.clientId || `anyport-web-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`
                }
            };

            await instance.connect(config);
            isMqttBrokerConnected.value = true;
            isConnected.value = true;
        } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error);
            mqttTransport.value = null;
            isMqttBrokerConnected.value = false;
            isConnected.value = false;
        } finally {
            isConnecting.value = false;
        }
    }

    async function disconnectGateway(): Promise<void> {
        if (!isConnected.value) return;
        // 断开网关连接，但保持 Broker 连接（重新以通配符模式连接）
        isConnected.value = false;
        isMqttBrokerConnected.value = false;
        if (mqttTransport.value) {
            await mqttTransport.value.disconnect();
            mqttTransport.value = null;
        }
        receiveBuffer.value = new Uint8Array(0);
        // 自动重连 Broker 以继续发现网关
        connectMqttBroker().catch(() => { });
    }

    async function disconnectBroker(): Promise<void> {
        isConnected.value = false;
        isMqttBrokerConnected.value = false;
        if (mqttTransport.value) {
            await mqttTransport.value.disconnect();
            mqttTransport.value = null;
        }
        receiveBuffer.value = new Uint8Array(0);
        gateways.value = [];
    }

    async function disconnect(): Promise<void> {
        if (!transport.value && !mqttTransport.value) return;

        try {
            if (transport.value) {
                await transport.value.disconnect();
            }
            if (mqttTransport.value) {
                await mqttTransport.value.disconnect();
            }
        } catch (error) {
            console.error('断开连接失败:', error);
        } finally {
            transport.value = null;
            mqttTransport.value = null;
            isConnected.value = false;
            isMqttBrokerConnected.value = false;
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    async function sendCommand(command: ModbusRtuCommand): Promise<ModbusRtuResponse | null> {
        const serialInstance = transport.value;
        const mqttInstance = mqttTransport.value;

        const activeTransport =
            serialInstance && serialInstance.isConnected
                ? serialInstance
                : mqttInstance && mqttInstance.isConnected
                    ? mqttInstance
                    : null;

        if (!activeTransport || !isConnected.value) {
            throw new Error('未连接设备');
        }

        const frame = adapter.value.encode(command);

        if (mqttInstance && activeTransport === mqttInstance) {
            const target = gatewayOptions.value;
            const payloadTarget = {
                protocol: target.protocol,
                tcpTarget: {
                    ip: target.tcpTarget.ip,
                    port: target.tcpTarget.port
                },
                rtuTarget: {
                    baudRate: target.rtuTarget.baudRate,
                    dataBits: target.rtuTarget.dataBits,
                    stopBits: target.rtuTarget.stopBits,
                    parity: target.rtuTarget.parity
                }
            };

            await (mqttInstance as any).sendWithTarget(frame, payloadTarget);
        } else {
            await activeTransport.send(frame);
        }

        addLog('tx', frame);

        return null;
    }

    function handleData(data: Uint8Array): void {
        // 追加到接收缓冲区
        const newBuffer = new Uint8Array(receiveBuffer.value.length + data.length);
        newBuffer.set(receiveBuffer.value);
        newBuffer.set(data, receiveBuffer.value.length);
        receiveBuffer.value = newBuffer;

        // 检查帧完整性
        const frameResult = adapter.value.checkFrame(receiveBuffer.value);

        if (frameResult === FrameCheckResult.COMPLETE) {
            // 解码响应
            const response = adapter.value.decode(receiveBuffer.value);
            addLog('rx', receiveBuffer.value, response ?? undefined);
            receiveBuffer.value = new Uint8Array(0);
        } else if (frameResult === FrameCheckResult.INVALID) {
            // 无效帧，清空缓冲区
            addLog('rx', receiveBuffer.value);
            receiveBuffer.value = new Uint8Array(0);
        }
        // INCOMPLETE: 继续等待更多数据
    }

    function handleError(error: Error): void {
        lastError.value = error.message;
        console.error('通信错误:', error);
    }

    function handleSerialStateChange(connected: boolean): void {
        isConnected.value = connected;
        if (!connected) {
            transport.value = null;
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    function addLog(direction: 'tx' | 'rx', data: Uint8Array, parsed?: ModbusRtuResponse): void {
        const entry: LogEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            timestamp: new Date(),
            direction,
            data: new Uint8Array(data),
            hex: bytesToHex(data),
            parsed
        };

        logs.value.unshift(entry);

        // 限制日志数量
        if (logs.value.length > 500) {
            logs.value.pop();
        }
    }

    function clearLogs(): void {
        logs.value = [];
    }

    function bytesToHex(data: Uint8Array): string {
        return Array.from(data)
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(' ');
    }

    function updateConfig(config: Partial<ConnectionConfig['serial']>): void {
        connectionConfig.value.serial = {
            ...connectionConfig.value.serial!,
            ...config
        };
    }

    function saveMqttConfig(config: Partial<MqttConfig>): void {
        mqttConfig.value = {
            ...mqttConfig.value,
            ...config
        };
    }

    function setModbusMode(mode: ModbusMode): void {
        modbusMode.value = mode;
        adapter.value = mode === 'rtu' ? rtuAdapter : tcpAdapter;
    }

    function setConnectionType(type: ConnectionType): void {
        connectionType.value = type;
    }

    startGatewayHeartbeatMonitor();

    return {
        isConnected,
        isConnecting,
        isMqttBrokerConnected,
        isMqttBrokerConnecting,
        isSupported,
        lastError,
        logs,
        connectionConfig,
        adapter,
        modbusMode,
        tcpOptions,
        mqttConfig,
        connectionType,
        gatewayOptions,
        gateways,
        connect,
        connectMqtt,
        connectMqttBroker,
        disconnectGateway,
        disconnectBroker,
        disconnect,
        sendCommand,
        clearLogs,
        updateConfig,
        setModbusMode,
        setConnectionType,
        updateGatewayOptions,
        saveMqttConfig,
        removeGateway,
        clearOfflineGateways
    };
});
