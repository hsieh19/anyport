/**
 * 设备连接状态管理 Store
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { WebSerialTransport } from '@/transports/WebSerialTransport';
import { ModbusRtuAdapter } from '@/protocols/modbus';
import type { ConnectionConfig } from '@shared/types/transport.types';
import { FrameCheckResult } from '@shared/types/protocol.types';
import type { ModbusRtuCommand, ModbusRtuResponse } from '@/protocols/modbus';

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

export const useDeviceStore = defineStore('device', () => {
    // 状态
    const transport = ref<WebSerialTransport | null>(null);
    const adapter = ref<ModbusRtuAdapter>(new ModbusRtuAdapter());
    const isConnected = ref(false);
    const isConnecting = ref(false);
    const lastError = ref<string | null>(null);
    const logs = ref<LogEntry[]>([]);
    const receiveBuffer = ref<Uint8Array>(new Uint8Array(0));

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
            transport.value = new WebSerialTransport();

            // 注册回调
            transport.value.onData(handleData);
            transport.value.onError(handleError);
            transport.value.onStateChange(handleStateChange);

            await transport.value.connect(connectionConfig.value);
            isConnected.value = true;
        } catch (error) {
            lastError.value = error instanceof Error ? error.message : String(error);
            transport.value = null;
        } finally {
            isConnecting.value = false;
        }
    }

    async function disconnect(): Promise<void> {
        if (!transport.value) return;

        try {
            await transport.value.disconnect();
        } catch (error) {
            console.error('断开连接失败:', error);
        } finally {
            transport.value = null;
            isConnected.value = false;
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    async function sendCommand(command: ModbusRtuCommand): Promise<ModbusRtuResponse | null> {
        if (!transport.value || !isConnected.value) {
            throw new Error('未连接设备');
        }

        // 编码并发送
        const frame = adapter.value.encode(command);
        await transport.value.send(frame);

        // 记录发送日志
        addLog('tx', frame);

        return null; // 响应通过 onData 回调处理
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

    function handleStateChange(connected: boolean): void {
        isConnected.value = connected;
        if (!connected) {
            transport.value = null;
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

    return {
        // 状态
        isConnected,
        isConnecting,
        isSupported,
        lastError,
        logs,
        connectionConfig,
        // 方法
        connect,
        disconnect,
        sendCommand,
        clearLogs,
        updateConfig
    };
});
