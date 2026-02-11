/**
 * 设备连接状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { WebSerialTransport } from '@/transports/WebSerialTransport';
import { WebSocketGatewayTransport } from '@/transports/WebSocketGatewayTransport';
import { ModbusRtuAdapter, ModbusTcpAdapter } from '@/protocols/modbus';
import type { ConnectionConfig } from '@shared/types/transport.types';
import { FrameCheckResult, type IProtocolAdapter } from '@shared/types/protocol.types';
import type { ModbusRtuCommand, ModbusRtuResponse } from '@/protocols/modbus';

// 物理连接通道
export type ConnectionType = 'serial' | 'gateway';

// 网关转发目标协议
export type GatewayProtocol = 'tcp' | 'rtu';

// 网关配置结构
export interface GatewayConfig {
    address: string;
    wsPort?: number;
    protocol: GatewayProtocol;
    tcpTarget: {
        ip: string;
        port: number;
        unitId: number;
    };
    rtuTarget: {
        slaveId: number;
        baudRate: number;
        dataBits: 8;
        stopBits: 1 | 2;
        parity: 'none' | 'even' | 'odd';
    };
}

export type GatewayStatus = 'online' | 'offline';

export interface Gateway {
    id: string;
    name: string;
    host: string;
    port: number;
    status: GatewayStatus;
    latency: number | null;
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
    unitId: number;
}

const GATEWAYS_STORAGE_KEY = 'anyport_gateways';

function loadGatewaysFromStorage(): Gateway[] {
    if (typeof window === 'undefined') {
        return [];
    }
    const raw = window.localStorage.getItem(GATEWAYS_STORAGE_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as Gateway[];
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map(item => ({
                id: item.id,
                name: item.name,
                host: item.host,
                port: item.port,
                status: (item.status === 'online' ? 'online' : 'offline') as GatewayStatus,
                latency: typeof item.latency === 'number' ? item.latency : null
            }))
            .filter(g => !!g.id && !!g.host);
    } catch {
        return [];
    }
}

function saveGatewaysToStorage(list: Gateway[]): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(GATEWAYS_STORAGE_KEY, JSON.stringify(list));
    } catch {
    }
}

export const useDeviceStore = defineStore('device', () => {
    // 状态
    const transport = ref<WebSerialTransport | null>(null);
    const gatewayTransport = ref<WebSocketGatewayTransport | null>(null);
    const rtuAdapter = new ModbusRtuAdapter();
    const tcpAdapter = new ModbusTcpAdapter();
    const adapter = ref<IProtocolAdapter<ModbusRtuCommand, ModbusRtuResponse>>(rtuAdapter);
    const isConnected = ref(false);
    const isConnecting = ref(false);
    const lastError = ref<string | null>(null);
    const logs = ref<LogEntry[]>([]);
    const receiveBuffer = ref<Uint8Array>(new Uint8Array(0));
    const modbusMode = ref<ModbusMode>('rtu');
    const tcpOptions = ref<ModbusTcpOptions>({
        ip: '127.0.0.1',
        port: 502,
        unitId: 1
    });
    const connectionType = ref<ConnectionType>('serial');
    const gatewayOptions = ref<GatewayConfig>({
        address: 'anyport.local',
        wsPort: 81,
        protocol: 'tcp',
        tcpTarget: {
            ip: '192.168.1.5',
            port: 502,
            unitId: 1
        },
        rtuTarget: {
            slaveId: 1,
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        }
    });
    const gateways = ref<Gateway[]>(loadGatewaysFromStorage());

    function addGateway(input: { id?: string; name: string; host: string; port: number }): Gateway {
        const id = input.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
        const gateway: Gateway = {
            id,
            name: input.name,
            host: input.host,
            port: input.port,
            status: 'offline',
            latency: null
        };
        gateways.value = [...gateways.value, gateway];
        saveGatewaysToStorage(gateways.value);
        return gateway;
    }

    function updateGateway(id: string, updates: Partial<Omit<Gateway, 'id'>>): void {
        gateways.value = gateways.value.map(g => (g.id === id ? { ...g, ...updates } : g));
        saveGatewaysToStorage(gateways.value);
    }

    function deleteGateway(id: string): void {
        gateways.value = gateways.value.filter(g => g.id !== id);
        saveGatewaysToStorage(gateways.value);
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
                if (gatewayTransport.value && gatewayTransport.value.isConnected) {
                    await gatewayTransport.value.disconnect();
                }
                gatewayTransport.value = null;

                const instance = new WebSerialTransport();
                transport.value = instance;

                instance.onData(handleData);
                instance.onError(handleError);
                instance.onStateChange(handleSerialStateChange);

                await instance.connect(connectionConfig.value);
                isConnected.value = true;
            } else {
                if (transport.value && transport.value.isConnected) {
                    await transport.value.disconnect();
                }
                transport.value = null;

                const instance = new WebSocketGatewayTransport();
                gatewayTransport.value = instance;

                instance.onData(handleData);
                instance.onError(handleError);
                instance.onStateChange(handleGatewayStateChange);

                await instance.connect(gatewayOptions.value);
                isConnected.value = true;
            }
        } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error);
            transport.value = null;
            gatewayTransport.value = null;
            isConnected.value = false;
        } finally {
            isConnecting.value = false;
        }
    }

    async function disconnect(): Promise<void> {
        if (!transport.value && !gatewayTransport.value) return;

        try {
            if (transport.value) {
                await transport.value.disconnect();
            }
            if (gatewayTransport.value) {
                await gatewayTransport.value.disconnect();
            }
        } catch (error) {
            console.error('断开连接失败:', error);
        } finally {
            transport.value = null;
            gatewayTransport.value = null;
            isConnected.value = false;
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    async function sendCommand(command: ModbusRtuCommand): Promise<ModbusRtuResponse | null> {
        const serialInstance = transport.value;
        const gatewayInstance = gatewayTransport.value;

        const activeTransport =
            serialInstance && serialInstance.isConnected
                ? serialInstance
                : gatewayInstance && gatewayInstance.isConnected
                    ? gatewayInstance
                    : null;

        if (!activeTransport || !isConnected.value) {
            throw new Error('未连接设备');
        }

        const frame = adapter.value.encode(command);
        await activeTransport.send(frame);

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

    function handleGatewayStateChange(connected: boolean): void {
        isConnected.value = connected;
        if (!connected) {
            gatewayTransport.value = null;
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

    function setModbusMode(mode: ModbusMode): void {
        modbusMode.value = mode;
        adapter.value = mode === 'rtu' ? rtuAdapter : tcpAdapter;
    }

    function updateTcpOptions(options: Partial<ModbusTcpOptions>): void {
        tcpOptions.value = {
            ...tcpOptions.value,
            ...options
        };
    }

    function setConnectionType(type: ConnectionType): void {
        connectionType.value = type;
    }

    function updateGatewayOptions(options: Partial<GatewayConfig>): void {
        gatewayOptions.value = {
            ...gatewayOptions.value,
            ...options
        };
    }

    async function checkGatewayStatus(id: string): Promise<void> {
        const target = gateways.value.find(g => g.id === id);
        if (!target) {
            return;
        }
        const start = performance.now();
        let url = target.host;
        if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
            url = `ws://${target.host}:${target.port}`;
        }
        await new Promise<void>(resolve => {
            let settled = false;
            try {
                const ws = new WebSocket(url);
                const timeoutId = window.setTimeout(() => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    ws.close();
                    updateGateway(id, { status: 'offline', latency: null });
                    resolve();
                }, 5000);
                ws.onopen = () => {
                    if (settled) {
                        return;
                    }
                    const latency = Math.round(performance.now() - start);
                    settled = true;
                    window.clearTimeout(timeoutId);
                    updateGateway(id, { status: 'online', latency });
                    ws.close();
                    resolve();
                };
                ws.onerror = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    window.clearTimeout(timeoutId);
                    updateGateway(id, { status: 'offline', latency: null });
                    resolve();
                };
                ws.onclose = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    window.clearTimeout(timeoutId);
                    updateGateway(id, { status: 'offline', latency: null });
                    resolve();
                };
            } catch {
                if (!settled) {
                    updateGateway(id, { status: 'offline', latency: null });
                    resolve();
                }
            }
        });
    }

    return {
        // 状态
        isConnected,
        isConnecting,
        isSupported,
        lastError,
        logs,
        connectionConfig,
        adapter,
        modbusMode,
        tcpOptions,
        connectionType,
        gatewayOptions,
        gateways,
        // 方法
        connect,
        disconnect,
        sendCommand,
        clearLogs,
        updateConfig,
        setModbusMode,
        updateTcpOptions,
        setConnectionType,
        updateGatewayOptions,
        addGateway,
        updateGateway,
        deleteGateway,
        checkGatewayStatus
    };
});
