import { defineStore } from 'pinia';
import { ref, shallowRef, triggerRef, watch } from 'vue';
import { useDeviceStore } from './deviceStore';
import { historyDb } from '@/utils/db';
import { parseAutoValue, normalizeFuncCodes, getModbusOffset, ModbusFunctionCode } from '@/protocols/modbus';
import { ProtocolType } from '@shared/types/protocol.types';

export interface CollectionChannel {
    id: string; // unique id
    name: string;
    slaveAddr: number; // 从站地址
    addr: number | string;
    func_code: any;
    data_type?: string;
    count?: number;
    unit?: string;
    scale?: number;
    mapping?: Record<string, string>;
    endian?: string;
}

export interface DataPoint {
    timestamp: number;
    value: number | string | null;
}

export const useCollectionStore = defineStore('collection', () => {
    const deviceStore = useDeviceStore();

    // --- State ---
    const isCollecting = ref(false);
    const interval = ref(1000); // ms
    const xAxisStep = ref(1); // X轴步长（显示时间跨度，单位：分钟）
    const yAxisStep = ref(0.1); // Y轴步长（最小刻度间距）
    const sessionStartTime = ref<number | null>(null); // 本次轮询开始时间
    const slaveId = ref(1); 
    const useBase1 = ref(false);
    const currentProfile = ref<any>(null); 
    const selectedChannels = ref<CollectionChannel[]>([]);
    const chartData = shallowRef<Record<string, DataPoint[]>>({}); 
    
    const successCount = ref(0);
    const errorCount = ref(0);
    const lastCollectTime = ref(0);
    const isManualInterventionActive = ref(false);
    let manualInterventionTimer: any = null;

    // --- Internal State ---
    let pollingTimeout: any = null;
    let waitForResponseTimeout: any = null;
    let currentChannelIndex = 0;
    let currentTickTimestamp = 0; 
    let lastRequestTime = 0;
    let pendingRequest: { slaveAddr: number; fc: number; addr: number; channelId: string } | null = null;
    const pendingDataBuffer: any[] = []; 

    // --- Manual Data Helper ---
    const manualDataTypeOptions = [
        { label: 'UInt16', value: 'uint16', count: 1 },
        { label: 'Int16', value: 'int16', count: 1 },
        { label: 'UInt32', value: 'uint32', count: 2 },
        { label: 'Int32', value: 'int32', count: 2 },
        { label: 'Float32', value: 'float32', count: 2 },
        { label: 'Coil/Discrete', value: 'coil', count: 1 }
    ];

    // --- Actions ---

    function addCustomChannel(config: Partial<CollectionChannel> & { name: string; addr: any; func_code: any; slaveAddr: number }) {
        // ID 包含从站地址、起始地址和功能码，确保多设备不冲突
        const id = config.id || `${config.slaveAddr}_${config.func_code}_${config.addr}`;
        const typeOpt = manualDataTypeOptions.find(o => o.value === config.data_type);
        
        const newChannel: CollectionChannel = {
            id,
            name: config.name,
            slaveAddr: config.slaveAddr,
            addr: config.addr,
            func_code: config.func_code,
            data_type: config.data_type || 'int16',
            count: config.count || typeOpt?.count || 1,
            unit: config.unit,
            scale: config.scale,
            mapping: config.mapping,
            endian: config.endian
        };

        const existingIdx = selectedChannels.value.findIndex(c => c.id === id);
        if (existingIdx > -1) {
            selectedChannels.value[existingIdx] = newChannel;
        } else {
            selectedChannels.value.push(newChannel);
        }
    }

    function removeChannel(id: string) {
        const idx = selectedChannels.value.findIndex(c => c.id === id);
        if (idx > -1) selectedChannels.value.splice(idx, 1);
    }

    function pauseForManual() {
        isManualInterventionActive.value = true;
        clearTimeout(manualInterventionTimer);
        manualInterventionTimer = setTimeout(() => {
            isManualInterventionActive.value = false;
        }, 2000); 
    }

    async function performCleanup() {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        await historyDb.clearOldData(sevenDaysAgo);
        await historyDb.limitRecords(50000);
    }

    function startCollection() {
        if (isCollecting.value) return;
        if (selectedChannels.value.length === 0) return;
        if (!deviceStore.isModbusConnected) return;

        isCollecting.value = true;
        sessionStartTime.value = Date.now();
        currentChannelIndex = 0;
        successCount.value = 0;
        errorCount.value = 0;
        isManualInterventionActive.value = false;
        performCleanup();
        lastCollectTime.value = Date.now();
        tick();
    }

    function stopCollection() {
        isCollecting.value = false;
        clearTimeout(pollingTimeout);
        clearTimeout(waitForResponseTimeout);
        clearTimeout(manualInterventionTimer);
        pendingRequest = null;
        flushBuffer();
    }

    async function flushBuffer() {
        if (pendingDataBuffer.length > 0) {
            const dataToSave = [...pendingDataBuffer];
            pendingDataBuffer.length = 0;
            await historyDb.addBulk(dataToSave);
        }
    }

    function tick() {
        if (!isCollecting.value || !deviceStore.isModbusConnected) {
            stopCollection();
            return;
        }

        if (isManualInterventionActive.value) {
            pollingTimeout = setTimeout(tick, 500);
            return;
        }

        if (currentChannelIndex === 0) {
            currentTickTimestamp = Date.now();
        }

        if (currentChannelIndex >= selectedChannels.value.length) {
            currentChannelIndex = 0;
            const now = Date.now();
            const timeSinceLast = now - lastCollectTime.value;
            const waitTime = Math.max(0, interval.value - timeSinceLast);
            
            pollingTimeout = setTimeout(() => {
                lastCollectTime.value = Date.now();
                tick();
            }, waitTime);
            return;
        }

        const channel = selectedChannels.value[currentChannelIndex];
        const fcList = normalizeFuncCodes(channel.func_code);
        const fc = fcList[0] || ModbusFunctionCode.READ_HOLDING_REGISTERS;
        let physicalAddr = getModbusOffset(channel.addr, fc);
        
        // ✅ 核心修复：应用 Base 0/1 偏移逻辑
        if (useBase1.value) {
            physicalAddr = Math.max(0, physicalAddr - 1);
        }

        pendingRequest = {
            slaveAddr: channel.slaveAddr, 
            fc,
            addr: physicalAddr,
            channelId: channel.id
        };

        lastRequestTime = Date.now();

        deviceStore.sendCommand({
            protocol: deviceStore.modbusMode === 'rtu' ? ProtocolType.MODBUS_RTU : ProtocolType.MODBUS_TCP,
            slaveAddress: channel.slaveAddr, 
            functionCode: fc,
            startAddress: physicalAddr,
            quantity: channel.count || 1
        }).catch(err => {
            console.error('[Collection] Send error:', err);
            handleError();
        });

        waitForResponseTimeout = setTimeout(() => {
            if (pendingRequest) {
                console.warn('[Collection] Response timeout for', channel.name);
                handleError();
            }
        }, 3000);
    }

    function handleError() {
        errorCount.value++;
        pendingRequest = null;
        clearTimeout(waitForResponseTimeout);
        currentChannelIndex++;
        tick();
    }

    function clearData() {
        chartData.value = {};
        successCount.value = 0;
        errorCount.value = 0;
    }

    // --- Watchers ---

    watch(() => deviceStore.modbusLogs.length, () => {
        if (!isCollecting.value || !pendingRequest) return;

        const latestLog = deviceStore.modbusLogs[0];
        if (!latestLog || latestLog.direction !== 'rx') return;

        if (Date.now() - lastRequestTime > 3000) return;
        
        if (!latestLog.parsed || latestLog.parsed.error) {
            if (latestLog.parsed?.error) {
                handleError();
            }
            return;
        }

        const registers = latestLog.parsed.registers || latestLog.parsed.coils;
        if (!registers) return;

        const channel = selectedChannels.value.find(c => c.id === pendingRequest?.channelId);
        if (!channel) return;

        const defaultEndian = currentProfile.value?.data?.protocol_summary?.default_endian || 'ABCD';
        const parsedStr = parseAutoValue(channel, registers, 0, channel.endian || defaultEndian, 4);
        
        if (!parsedStr) {
            handleError();
            return;
        }

        const numericMatch = parsedStr.match(/(-?\d+\.?\d*)/);
        const numericValue = numericMatch ? parseFloat(numericMatch[1]) : NaN;
        
        if (isNaN(numericValue)) {
            handleError();
            return;
        }

        const timestamp = currentTickTimestamp || Date.now();

        const currentPoints = chartData.value[channel.id] || [];
        const newPoints = [...currentPoints, { timestamp, value: numericValue }];
        if (newPoints.length > 500) newPoints.shift();
        
        // [修复3.2] 直接原地修改 + triggerRef，避免通道数量多时展开整个对象的性能开销
        chartData.value[channel.id] = newPoints;
        triggerRef(chartData);

        pendingDataBuffer.push({
            timestamp,
            deviceLabel: `Slave ${channel.slaveAddr}`,
            slaveAddr: channel.slaveAddr,
            registerAddr: pendingRequest.addr,
            rawValue: Array.isArray(latestLog.parsed.registers) ? latestLog.parsed.registers.slice(0, channel.count || 1) : (latestLog.parsed.coils || []),
            parsedValue: parsedStr,
            profileId: currentProfile.value?.id || null 
        });

        if (pendingDataBuffer.length >= 10) {
            flushBuffer();
        }

        successCount.value++;
        pendingRequest = null;
        clearTimeout(waitForResponseTimeout);
        currentChannelIndex++;
        tick();
    });

    return {
        isCollecting,
        interval,
        xAxisStep,
        yAxisStep,
        sessionStartTime,
        slaveId,
        useBase1,
        currentProfile,
        selectedChannels,
        chartData,
        successCount,
        errorCount,
        lastCollectTime,
        startCollection,
        stopCollection,
        pauseForManual,
        clearData,
        addCustomChannel,
        removeChannel
    };
});
