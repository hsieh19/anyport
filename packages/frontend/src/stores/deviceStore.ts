import { defineStore } from 'pinia';
import { ref, shallowRef, computed, watch, onMounted } from 'vue';
import { WebSerialTransport } from '@/transports/WebSerialTransport';
import { MqttTransport } from '@/transports/MqttTransport';
import { LocalBridgeTransport } from '@/transports/LocalBridgeTransport';
import { ModbusRtuAdapter, ModbusTcpAdapter } from '@/protocols/modbus';
import { BacnetMsTpAdapter, BacnetIpAdapter } from '@/protocols/bacnet';
import { ProtocolType, FrameCheckResult, type IProtocolAdapter } from '@shared/types/protocol.types';
import { type ConnectionConfig as GlobalConnectionConfig, type ITransportAdapter } from '@shared/types/transport.types';
import { bytesToHexSpaced } from '@/utils/hex';

// --- 类型定义 ---
export type ConnectionType = 'serial' | 'mqtt' | 'bridge';
export type ModbusMode = 'rtu' | 'tcp';

export interface LogEntry {
    id: string;
    timestamp: Date;
    direction: 'tx' | 'rx';
    data: Uint8Array;
    hex: string;
    parsed?: any;
    pingResult?: any;
}

export interface WebSerialConfig {
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string;
}

export interface ModbusTcpOptions {
    ip: string;
    port: number;
}

export interface MqttConfig {
    brokerUrl: string;
    username?: string;
    password?: string;
    clientId?: string;
    topicPrefix: string;
    siteId: string;
    gatewayId: string;
}

export interface GatewayConfig {
    protocol: ModbusMode;
    tcpTarget: { ip: string; port: number };
    rtuTarget: { baudRate: number; dataBits: number; stopBits: number; parity: string };
}

// --- Store 定义 ---
export const useDeviceStore = defineStore('device', () => {
    // 状态
    const transport = shallowRef<WebSerialTransport | null>(null);
    const mqttTransport = shallowRef<MqttTransport | null>(null);
    const bridgeTransport = shallowRef<LocalBridgeTransport | null>(null);
    const rtuAdapter = new ModbusRtuAdapter();
    const tcpAdapter = new ModbusTcpAdapter();
    const bacnetMsTpAdapter = new BacnetMsTpAdapter();
    const bacnetIpAdapter = new BacnetIpAdapter();
    const adapter = ref<IProtocolAdapter<any, any>>(rtuAdapter);

    // 连接状态
    const isModbusConnected = ref(false);
    const isBacnetConnected = ref(false);
    const isModbusConnecting = ref(false);
    const isBacnetConnecting = ref(false);
    const isMqttBrokerConnected = ref(false);
    const isMqttBrokerConnecting = ref(false);

    // 计算得到的聚合状态
    const isConnected = computed(() => isModbusConnected.value || isBacnetConnected.value);
    const isConnecting = computed(() => isModbusConnecting.value || isBacnetConnecting.value);

    // 协议特定的错误信息
    const modbusError = ref<string | null>(null);
    const bacnetError = ref<string | null>(null);
    const lastError = computed(() => {
        if (currentProtocol.value.includes('bacnet')) return bacnetError.value;
        return modbusError.value;
    });

    // 分协议状态
    const modbusLogs = ref<LogEntry[]>([]);
    const bacnetLogs = ref<LogEntry[]>([]);
    const currentProtocol = ref<ProtocolType>(ProtocolType.MODBUS_RTU);
    const receiveBuffer = ref<Uint8Array>(new Uint8Array(0));
    const modbusMode = ref<ModbusMode>('rtu');
    const defaultMqttConfig: MqttConfig = {
        brokerUrl: 'wss://broker.emqx.io:8084/mqtt',
        username: '',
        password: '',
        clientId: '',
        topicPrefix: 'anyport',
        siteId: '',
        gatewayId: ''
    };

    const savedMqttConfig = localStorage.getItem('anyport_mqtt_config');
    let initialMqttConfig = savedMqttConfig ? { ...defaultMqttConfig, ...JSON.parse(savedMqttConfig) } : defaultMqttConfig;

    // 强制清除缓存的 clientId，确保每次重载页面都是新会话，防止 EMQX 会话接管冲突
    if (initialMqttConfig.clientId) {
        initialMqttConfig.clientId = '';
    }

    const mqttConfig = ref<MqttConfig>(initialMqttConfig);

    watch(mqttConfig, (newVal) => {
        localStorage.setItem('anyport_mqtt_config', JSON.stringify(newVal));
    }, { deep: true });

    // 独立的连接类型
    const modbusConnectionType = ref<ConnectionType>('serial');
    const bacnetConnectionType = ref<ConnectionType>('mqtt');
    const connectionType = computed<ConnectionType>({
        get: () => currentProtocol.value.includes('bacnet') ? bacnetConnectionType.value : modbusConnectionType.value,
        set: (val: ConnectionType) => {
            if (currentProtocol.value.includes('bacnet')) {
                bacnetConnectionType.value = val;
            } else {
                modbusConnectionType.value = val;
            }
        }
    });

    const isSupported = ref('serial' in navigator);
    const serialConfig = ref<WebSerialConfig>({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });

    const gatewayOptions = ref<GatewayConfig>({
        protocol: 'rtu',
        tcpTarget: { ip: '192.168.1.5', port: 502 },
        rtuTarget: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' }
    });
    const gateways = ref<any[]>([]);

    // --- Watchers ---

    // 初始化传输层
    onMounted(() => {
        if (typeof window !== 'undefined') {
            transport.value = new WebSerialTransport();
            transport.value.onData(handleData);
            transport.value.onStateChange(handleSerialStateChange);
            transport.value.onError(handleError);
        }
    });

    function handleSerialStateChange(state: boolean): void {
        const connectedRef = currentProtocol.value.includes('bacnet') ? isBacnetConnected : isModbusConnected;
        connectedRef.value = state;
    }

    async function connectMqttBroker(): Promise<void> {
        if (isMqttBrokerConnected.value || isMqttBrokerConnecting.value) return;
        isMqttBrokerConnecting.value = true;
        try {
            if (mqttTransport.value) {
                try {
                    await mqttTransport.value.disconnect();
                } catch {
                }
                mqttTransport.value = null;
                isMqttBrokerConnected.value = false;
                // 拉长硬延迟，确保浏览器彻底回收 WebSocket 端口资源，防止由于旧端口未释放导致的第一次连接失败
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            mqttTransport.value = new MqttTransport();
            mqttTransport.value.onData(handleData);
            mqttTransport.value.onError(handleError);
            mqttTransport.value.onStateChange((connected: boolean) => {
                isMqttBrokerConnected.value = connected;
                if (!connected) {
                    isModbusConnected.value = false;
                    isBacnetConnected.value = false;
                    stopPing();
                    stopGatewayHeartbeatMonitor();
                }
            });
            const config: GlobalConnectionConfig = {
                mqtt: {
                    brokerUrl: mqttConfig.value.brokerUrl,
                    username: mqttConfig.value.username || '',
                    password: mqttConfig.value.password || '',
                    // 第一次连接 Broker 时，强制使用空 ID 占位，走发现逻辑，防止缓存 ID 干扰连接
                    siteId: '',
                    gatewayId: '',
                    topicPrefix: mqttConfig.value.topicPrefix,
                    clientId: mqttConfig.value.clientId
                }
            };
            await mqttTransport.value.connect(config);
            if ((mqttTransport.value as any).onGatewayStatus) {
                (mqttTransport.value as any).onGatewayStatus((info: any) => {
                    const existing = gateways.value.find(g => g.siteId === info.siteId && g.gatewayId === info.gatewayId);
                    if (existing) {
                        existing.online = info.online;
                        existing.lastSeen = info.timestamp;
                        if (info.config) existing.config = { ...existing.config, ...info.config };
                    } else {
                        gateways.value.push({
                            ...info,
                            id: `${info.siteId}/${info.gatewayId}`,
                            lastSeen: info.timestamp
                        });
                    }
                });
            }
            if ((mqttTransport.value as any).onPingResult) {
                (mqttTransport.value as any).onPingResult(handlePingResult);
            }
            startGatewayHeartbeatMonitor();
            if ((mqttTransport.value as any).startDiscovery) {
                await (mqttTransport.value as any).startDiscovery();
            }
        } catch (error: any) {
            handleError(error);
            throw error;
        } finally {
            isMqttBrokerConnecting.value = false;
        }
    }

    async function connectMqtt(): Promise<void> {
        const connectedRef = currentProtocol.value.includes('bacnet') ? isBacnetConnected : isModbusConnected;
        const connectingRef = currentProtocol.value.includes('bacnet') ? isBacnetConnecting : isModbusConnecting;
        const errorRef = currentProtocol.value.includes('bacnet') ? bacnetError : modbusError;

        errorRef.value = null;
        if (connectedRef.value) return;

        connectingRef.value = true;
        try {
            if (!mqttTransport.value || !isMqttBrokerConnected.value) {
                await connectMqttBroker();
            }
            if ((mqttTransport.value as any).selectGateway) {
                await (mqttTransport.value as any).selectGateway(mqttConfig.value.siteId, mqttConfig.value.gatewayId);
            }
            connectedRef.value = true;
        } catch (error: any) {
            errorRef.value = error.message;
            throw error;
        } finally {
            connectingRef.value = false;
        }
    }

    async function connect(): Promise<void> {
        const protocol = currentProtocol.value;
        const connectedRef = protocol.includes('bacnet') ? isBacnetConnected : isModbusConnected;
        const connectingRef = protocol.includes('bacnet') ? isBacnetConnecting : isModbusConnecting;
        const errorRef = protocol.includes('bacnet') ? bacnetError : modbusError;

        errorRef.value = null;
        if (connectedRef.value || connectingRef.value) return;

        connectingRef.value = true;
        try {
            if (connectionType.value === 'mqtt') {
                await connectMqtt();
                return;
            }
            if (connectionType.value === 'bridge') {
                if (!bridgeTransport.value) {
                    bridgeTransport.value = new LocalBridgeTransport();
                    bridgeTransport.value.onData(handleData);
                }
                await bridgeTransport.value.connect(gatewayOptions.value as any);
                connectedRef.value = true;
                return;
            }
            // Serial
            if (!transport.value) throw new Error('串口未初始化');
            const config: GlobalConnectionConfig = {
                serial: {
                    baudRate: serialConfig.value.baudRate,
                    dataBits: serialConfig.value.dataBits as any,
                    stopBits: serialConfig.value.stopBits as any,
                    parity: serialConfig.value.parity as any
                }
            };
            await transport.value.connect(config);
            connectedRef.value = true;
        } catch (error: any) {
            errorRef.value = error.message;
            throw error;
        } finally {
            connectingRef.value = false;
        }
    }

    async function disconnect(): Promise<void> {
        const connectedRef = currentProtocol.value.includes('bacnet') ? isBacnetConnected : isModbusConnected;

        try {
            if (connectionType.value === 'serial' && transport.value) {
                await transport.value.disconnect();
            } else if (connectionType.value === 'mqtt' && mqttTransport.value) {
                await mqttTransport.value.disconnect();
            } else if (connectionType.value === 'bridge' && bridgeTransport.value) {
                await bridgeTransport.value.disconnect();
            }
        } catch (error) {
            console.error('断开连接失败:', error);
        } finally {
            connectedRef.value = false;
            if (!isModbusConnected.value && !isBacnetConnected.value) {
                receiveBuffer.value = new Uint8Array(0);
                stopPing();
            }
        }
    }

    async function disconnectGateway(): Promise<void> {
        const protocol = currentProtocol.value;
        if (protocol.includes('bacnet')) {
            isBacnetConnected.value = false;
        } else {
            isModbusConnected.value = false;
        }
        stopPing();
        if (!isModbusConnected.value && !isBacnetConnected.value) {
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    async function disconnectBroker(): Promise<void> {
        if (mqttTransport.value) {
            await mqttTransport.value.disconnect();
            mqttTransport.value = null;
        }
        gateways.value = [];
        isMqttBrokerConnected.value = false;
        isModbusConnected.value = false;
        isBacnetConnected.value = false;
        stopPing();
        stopGatewayHeartbeatMonitor();
    }

    async function sendCommand(command: any): Promise<any | null> {
        const protocol = currentProtocol.value;
        const connectedRef = protocol.includes('bacnet') ? isBacnetConnected : isModbusConnected;

        const serialInstance = transport.value;
        const mqttInstance = mqttTransport.value;
        const bridgeInstance = bridgeTransport.value;

        let activeTransport: ITransportAdapter | null = null;

        if (connectionType.value === 'serial') {
            activeTransport = serialInstance && serialInstance.isConnected ? serialInstance : null;
        } else if (connectionType.value === 'mqtt') {
            activeTransport = mqttInstance && mqttInstance.isConnected ? mqttInstance : null;
        } else if (connectionType.value === 'bridge') {
            activeTransport = bridgeInstance && bridgeInstance.isConnected ? bridgeInstance : null;
        }

        if (!activeTransport || !connectedRef.value) {
            throw new Error('未连接设备');
        }

        const frame = adapter.value.encode(command);

        if (connectionType.value === 'mqtt' && mqttInstance && activeTransport === mqttInstance && !protocol.includes('bacnet')) {
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
        const newBuffer = new Uint8Array(receiveBuffer.value.length + data.length);
        newBuffer.set(receiveBuffer.value);
        newBuffer.set(data, receiveBuffer.value.length);
        receiveBuffer.value = newBuffer;

        const result = adapter.value.checkFrame(receiveBuffer.value);
        if (result === FrameCheckResult.COMPLETE) {
            const decoded = adapter.value.decode(receiveBuffer.value);
            addLog('rx', receiveBuffer.value, decoded ?? undefined);
            receiveBuffer.value = new Uint8Array(0);
        } else if (result === FrameCheckResult.INVALID) {
            addLog('rx', receiveBuffer.value);
            receiveBuffer.value = new Uint8Array(0);
        }
    }

    function addLog(direction: 'tx' | 'rx', data: Uint8Array, parsed?: any): void {
        const entry: LogEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            timestamp: new Date(),
            direction,
            data: new Uint8Array(data),
            hex: bytesToHexSpaced(data),
            parsed
        };
        const targetLogs = currentProtocol.value.includes('bacnet') ? bacnetLogs : modbusLogs;
        targetLogs.value.unshift(entry);
        if (targetLogs.value.length > 500) targetLogs.value.pop();
    }


    function setProtocol(type: ProtocolType): void {
        currentProtocol.value = type;
        if (type === ProtocolType.MODBUS_RTU) adapter.value = rtuAdapter;
        else if (type === ProtocolType.MODBUS_TCP) adapter.value = tcpAdapter;
        else if (type === ProtocolType.BACNET_MSTP) adapter.value = bacnetMsTpAdapter;
        else if (type === ProtocolType.BACNET_IP) adapter.value = bacnetIpAdapter;
    }

    function setModbusMode(mode: ModbusMode): void {
        modbusMode.value = mode;
        adapter.value = mode === 'rtu' ? rtuAdapter : tcpAdapter;
        currentProtocol.value = mode === 'rtu' ? ProtocolType.MODBUS_RTU : ProtocolType.MODBUS_TCP;
    }

    function updateConfig(config: any) { serialConfig.value = { ...serialConfig.value, ...config }; }
    function updateGatewayOptions(opts: any) { gatewayOptions.value = { ...gatewayOptions.value, ...opts }; }
    function saveMqttConfig(cfg: any) { mqttConfig.value = { ...mqttConfig.value, ...cfg }; }
    function setConnectionType(type: ConnectionType) { connectionType.value = type; }
    function clearLogs() { if (currentProtocol.value.includes('bacnet')) bacnetLogs.value = []; else modbusLogs.value = []; }
    function handleError(err: any): void {
        const msg = typeof err === 'string' ? err : (err.message || String(err));
        const errorRef = currentProtocol.value.includes('bacnet') ? bacnetError : modbusError;
        errorRef.value = msg;

        // 将错误记录入通信日志，方便观察时序
        const entry: LogEntry = {
            id: 'err-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            timestamp: new Date(),
            direction: 'rx',
            data: new Uint8Array(0),
            hex: 'ERROR: ' + msg,
            parsed: { success: false, error: msg }
        };
        const targetLogs = currentProtocol.value.includes('bacnet') ? bacnetLogs : modbusLogs;
        targetLogs.value.unshift(entry);
        if (targetLogs.value.length > 500) targetLogs.value.pop();

        console.error('通信错误:', msg);
    }

    // Ping 逻辑复写 (ModbusPanel 使用)
    const isPinging = ref(false);
    let pingTimer: number | null = null;
    let pingSeq = 1;

    function handlePingResult(result: Record<string, any>): void {
        const entry: LogEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            timestamp: new Date(),
            direction: 'rx',
            data: new Uint8Array(0),
            hex: '',
            pingResult: {
                success: result.success,
                ip: result.pingTarget?.ip ?? result.ip,
                port: result.pingTarget?.port ?? result.port,
                latency: result.latency,
                error: result.error,
                seq: result.seq,
                localIp: result.localIp,
                link: result.link
            }
        };

        const targetLogs = currentProtocol.value.includes('bacnet') ? bacnetLogs : modbusLogs;
        targetLogs.value.unshift(entry);
        if (targetLogs.value.length > 500) targetLogs.value.pop();
    }

    function startPing() {
        if (!isModbusConnected.value || connectionType.value !== 'mqtt' || gatewayOptions.value.protocol !== 'tcp') {
            return;
        }
        if (isPinging.value) return;
        isPinging.value = true;
        pingSeq = 1;
        const targetIp = gatewayOptions.value.tcpTarget.ip;
        const targetPort = gatewayOptions.value.tcpTarget.port;

        const sendOnePing = () => {
            if (!mqttTransport.value || !isModbusConnected.value) {
                stopPing();
                return;
            }
            (mqttTransport.value as any).sendPing(targetIp, targetPort, pingSeq++).catch((err: any) => {
                console.error('Ping send error:', err);
            });
        };

        sendOnePing();
        pingTimer = window.setInterval(sendOnePing, 2000);
    }

    function stopPing() {
        isPinging.value = false;
        if (pingTimer !== null) {
            window.clearInterval(pingTimer);
            pingTimer = null;
        }
        pingSeq = 1;
    }

    function removeGateway(id: string) {
        gateways.value = gateways.value.filter(g => g.gatewayId !== id);
    }

    function clearOfflineGateways() {
        gateways.value = gateways.value.filter(g => g.online);
    }

    // --- 网关离线检查逻辑 ---
    let heartbeatTimer: number | null = null;
    function startGatewayHeartbeatMonitor() {
        if (heartbeatTimer) return;
        const offlineThresholdMs = 45000;
        heartbeatTimer = window.setInterval(() => {
            const now = Date.now();
            gateways.value.forEach(gw => {
                if (gw.online && now - gw.lastSeen > offlineThresholdMs) {
                    gw.online = false;
                }
            });
        }, 5000);
    }

    function stopGatewayHeartbeatMonitor() {
        if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }



    return {
        transport, mqttTransport, bridgeTransport, adapter,
        isModbusConnected, isBacnetConnected, isModbusConnecting, isBacnetConnecting,
        isConnected, isConnecting, isMqttBrokerConnected, isMqttBrokerConnecting,
        modbusError, bacnetError, lastError,
        modbusLogs, bacnetLogs, currentProtocol, modbusMode,
        mqttConfig, connectionType, serialConfig, gatewayOptions, gateways,
        isSupported, connect, connectMqtt, connectMqttBroker,
        disconnect, disconnectGateway, disconnectBroker,
        sendCommand, addLog, clearLogs,
        updateConfig, updateGatewayOptions, saveMqttConfig, setModbusMode, setProtocol, setConnectionType,
        isPinging, startPing, stopPing, removeGateway, clearOfflineGateways
    };
});
