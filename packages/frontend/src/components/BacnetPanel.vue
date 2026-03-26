<script setup lang="ts">
import { ref, onMounted, onActivated, onUnmounted, watch, computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ProtocolType } from '@shared/types/protocol.types';
import { BacnetService } from '@/protocols/bacnet';
import { BacnetPropertyIdentifier, BACNET_PROPERTY_NAMES } from '@/protocols/bacnet/constants';
import { 
  Network, 
  Cpu, 
  Box, 
  List, 
  Terminal, 
  Trash2, 
  Play, 
  Square, 
  Search,
  ChevronRight,
  ChevronDown,
  Server,
  Radio,
  Edit3
} from 'lucide-vue-next';

const deviceStore = useDeviceStore();

// --- 状态定义 ---
const protocolMode = ref<'mstp' | 'ip'>('ip');
const targetIp = ref('127.0.0.1');
const msTpMac = ref(0);
const isScanning = ref(false);
const useForeignDevice = ref(false);
const ttl = ref(60);

// --- 校验状态 ---
const ipError = ref(false);
const macError = ref(false);

const validateInputs = () => {
  let isValid = true;
  if (protocolMode.value === 'ip') {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    ipError.value = !ipRegex.test(targetIp.value);
    isValid = !ipError.value;
  } else {
    macError.value = typeof msTpMac.value !== 'number' || msTpMac.value < 0 || msTpMac.value > 127;
    isValid = !macError.value;
  }
  return isValid;
};

// 树形结构展开状态
const expandedNodes = ref<Set<string>>(new Set(['root', 'link-ip', 'link-mstp']));

// 扫描到的设备
const devices = ref<any[]>([]);

// 当前选中的条目
const selectedItem = ref<any>(null);

// --- 定时器与资源管理 ---
const activeTimers = new Set<ReturnType<typeof setInterval>>();
const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

let invokeIdCounter = 1;

interface PendingRequest {
    item: any;
    propId: string;
    index?: number;
    timestamp: number;
}
const pendingRequests = new Map<number, PendingRequest>();

// 清理超时请求的定时器
const requestCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, req] of pendingRequests.entries()) {
        if (now - req.timestamp > 10000) { // 10秒超时
            if (req.item && req.item.details) {
                // 不在列表结束时标记不支持，以免覆盖正常状态
                if (!req.item.details[req.propId] && req.propId !== BacnetPropertyIdentifier.ObjectList.toString()) {
                    req.item.details[req.propId] = "(超时)";
                }
            }
            pendingRequests.delete(id);
        }
    }
}, 5000);

onUnmounted(() => {
    activeTimers.forEach(clearInterval);
    activeTimeouts.forEach(clearTimeout);
    clearInterval(requestCleanupTimer);
    pendingRequests.clear();
});

// 提取所有展示属性 (基础信息 + 协议内部属性)
const displayProperties = computed(() => {
  if (!selectedItem.value) return [];
  const details = selectedItem.value.details || {};
  const results: any[] = [];
  
  // 1. 基础信息 (Address, SNET, SADR)
  if (selectedItem.value.type === 'device') {
    results.push({ name: 'Address', value: selectedItem.value.address });
    results.push({ name: 'SNET', value: details['SNET'] || '0' });
    results.push({ name: 'SADR', value: details['SADR'] || '' });
  }

  // 2. 协议内部属性 (BACnet PIDs)
  const pids = selectedItem.value.type === 'device'
    ? [121, 77, 75, 120, 70, 28, 62] // 将 62 (APDU) 移到最后
    : [85, 81, 111, 117, 36, 77, 79, 75, 28, 65, 69];

  pids.forEach(pid => {
    let name = BACNET_PROPERTY_NAMES[pid] || pid.toString();
    
    // 针对最大 APDU 长度进行分行处理
    if (pid === 62) {
      name = name.replace('(', '<br>(');
    }

    results.push({
      name,
      value: details[pid.toString()] !== undefined ? details[pid.toString()] : '(读取中...)'
    });
  });

  return results;
});

// --- 逻辑处理 ---
function updateProtocolState() {
  const type = protocolMode.value === 'mstp' ? ProtocolType.BACNET_MSTP : ProtocolType.BACNET_IP;
  deviceStore.setProtocol(type);
  // 仅支持本地和本地桥接模式
  deviceStore.setConnectionType(protocolMode.value === 'ip' ? 'bridge' : 'serial');
}

onMounted(() => {
  updateProtocolState();
});

onActivated(() => {
  updateProtocolState();
});

watch(protocolMode, () => {
  updateProtocolState();
});

async function toggleConnection() {
  if (deviceStore.isBacnetConnected) {
    try { await deviceStore.disconnect(); } catch(e) { console.error("Disconnect Error", e); }
  } else {
    if (!validateInputs()) return;
    
    if (protocolMode.value === 'ip') {
      deviceStore.setConnectionType('bridge');
      deviceStore.updateGatewayOptions({
        protocol: 'udp',
        tcpTarget: { ip: targetIp.value, port: 47808 }
      });
    } else {
      deviceStore.setConnectionType('serial');
    }
    
    try {
        await deviceStore.connect();
        // 如果启用了外来设备模式，连接后立即注册
        if (useForeignDevice.value && protocolMode.value === 'ip') {
          await registerForeignDevice();
        }
    } catch (e: any) {
        console.error("Connect Error:", e.message);
    }
  }
}

async function registerForeignDevice() {
  if (!deviceStore.isBacnetConnected) return;
  
  try {
      await deviceStore.sendCommand({
        protocol: ProtocolType.BACNET_IP,
        bvlcFunction: 0x05, 
        data: BacnetService.createRegisterForeignDevicePayload(ttl.value)
      });
  } catch (e) {
      console.error("Register FD Error:", e);
  }
}

function toggleNode(id: string) {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id);
  } else {
    expandedNodes.value.add(id);
  }
}

function selectItem(item: any) {
  selectedItem.value = item;
  
  const typeParts = item.id.replace('obj-', '').split('-');
  const typeId = typeParts.length > 1 ? typeParts[0] : '8';
  const instanceId = typeParts.length > 1 ? typeParts[1] : item.id.replace('dev-', '');

  if (!item.details) item.details = {};
  
  // 仅在未读取到时预填，如果有真实值则保留
  if (!item.details['75']) item.details['75'] = `(${item.type === 'device' ? 'Device' : typeId}, ${instanceId})`;
  if (item.type !== 'device' && !item.details['79']) {
     item.details['79'] = item.name.split(',')[0].replace('(', '');
  }
  
  const propsToFetch = item.type === 'device' 
    ? [121, 62, 77, 75, 120, 70, 28] 
    : [85, 81, 111, 117, 36, 77, 79, 75, 28, 65, 69];
  
  if (item.type === 'device' && !item.objectsLoaded && !item.loadingObjects) {
    discoverObjects(item);
  }

  propsToFetch.forEach((pid, index) => {
    const to = setTimeout(() => fetchProperty(item, pid), index * 300);
    activeTimeouts.add(to);
  });
}

async function fetchProperty(item: any, propertyId: number) {
  if (!deviceStore.isBacnetConnected) return;
  
  const invId = (invokeIdCounter % 254) + 1; // 1-254
  invokeIdCounter = invId;
  pendingRequests.set(invId, { item, propId: propertyId.toString(), timestamp: Date.now() });

  let objType = 0;
  let objInstance = 0;
  
  if (item.type === 'device') {
    objType = 8;
    objInstance = parseInt(item.id.replace('dev-', ''));
  } else {
    // 处理 obj-type-instance 格式
    const parts = item.id.replace('obj-', '').split('-');
    objType = parseInt(parts[0]);
    objInstance = parseInt(parts[1]);
  }

  const payload = BacnetService.createReadPropertyPayload(objType, objInstance, propertyId, invId);
  const device = item.type === 'device' ? item : devices.value.find(d => d.objects?.includes(item));
  
  try {
      if (protocolMode.value === 'ip') {
        await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: payload });
      } else if (device) {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_MSTP,
          destinationAddress: parseInt(device.address?.split(':')[1] || '0'), 
          sourceAddress: msTpMac.value,
          frameType: 0x05, 
          data: payload
        });
      }
  } catch (e) {
      console.error(`Fetch Property ${propertyId} Error:`, e);
      pendingRequests.delete(invId);
  }
}

async function discoverObjects(device: any) {
  if (!deviceStore.isBacnetConnected || device.loadingObjects) return;
  
  device.loadingObjects = true;
  device.currentIndex = 0; 
  device.processedCount = 0;
  device.totalObjects = 20000; 
  device.objects = [];
  device.isScanFinished = false;
  
  const deviceInstance = parseInt(device.id.replace('dev-', ''));
  console.log(`正在启动 [索引极限探测] 扫描...`);
  
  const invId = (invokeIdCounter % 254) + 1;
  invokeIdCounter = invId;
  const propId = BacnetPropertyIdentifier.ObjectList;
  const reqCount = BacnetService.createReadPropertyPayload(8, deviceInstance, propId, invId, 0);
  pendingRequests.set(invId, { item: device, propId: propId.toString(), index: 0, timestamp: Date.now() });
  
  try {
      if (protocolMode.value === 'ip') {
        await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: reqCount });
      } else {
        await deviceStore.sendCommand({ 
          protocol: ProtocolType.BACNET_MSTP, 
          destinationAddress: parseInt(device.address?.replace('MAC:', '') || '0'), 
          sourceAddress: msTpMac.value, frameType: 0x05, data: reqCount 
        });
      }
  } catch (e) {
      console.error("Discover Objects Init Error:", e);
      device.loadingObjects = false;
      return;
  }

  const monitorId = setInterval(async () => {
    if (device.loadingObjects && !device.isScanFinished && device.currentIndex < device.totalObjects) {
      device.currentIndex++;
      const iId = (invokeIdCounter % 254) + 1;
      invokeIdCounter = iId;
      const nextIdx = device.currentIndex;
      const nextReq = BacnetService.createReadPropertyPayload(8, deviceInstance, propId, iId, nextIdx);
      pendingRequests.set(iId, { item: device, propId: propId.toString(), index: nextIdx, timestamp: Date.now() });
      
      try {
          if (protocolMode.value === 'ip') {
            await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: nextReq });
          } else {
            await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_MSTP, destinationAddress: parseInt(device.address?.replace('MAC:', '') || '0'), sourceAddress: msTpMac.value, frameType: 0x05, data: nextReq });
          }
      } catch (e) {
          console.error("Discover Objects Polling Error:", e);
      }
    } else if (!device.loadingObjects) {
      clearInterval(monitorId);
      activeTimers.delete(monitorId);
    }
  }, 2000);
  activeTimers.add(monitorId);
}

function clearDevices() {
  devices.value = [];
  selectedItem.value = null;
}

// 扫描逻辑
async function scanDevices() {
  if (!deviceStore.isBacnetConnected || isScanning.value) return;
  if (!validateInputs()) return;
  
  isScanning.value = true;
  devices.value = [];
  selectedItem.value = null;
  
  const to = setTimeout(() => { if (isScanning.value) isScanning.value = false; }, 3000);
  activeTimeouts.add(to);
  
  try {
      const whoIsPayload = BacnetService.createWhoIsPayload();
      
      if (protocolMode.value === 'ip') {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_IP,
          bvlcFunction: useForeignDevice.value ? 0x09 : 0x0B, 
          data: whoIsPayload
        });
      } else {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_MSTP,
          destinationAddress: 255, // Broadcast
          sourceAddress: msTpMac.value,
          frameType: 0x06, // BacnetDataNotExpectingReply
          data: whoIsPayload
        });
      }
  } catch(e) {
      console.error("Scan Error:", e);
      isScanning.value = false;
  }
}

// 仅监听最早的一条日志变动，避免 deep:true 导致多包乱发卡顿
watch(
  () => deviceStore.bacnetLogs[0], 
  (lastLog) => {
      if (!lastLog || lastLog.direction !== 'rx') return;

      const hex = lastLog.hex.replace(/\s/g, '').toUpperCase();
      
      // 1. 处理 I-Am (发现设备)
      const deviceId = BacnetService.parseIAmDeviceId(hex);
      if (deviceId !== null) {
          const devId = `dev-${deviceId}`;
          if (!devices.value.find(d => d.id === devId)) {
            const parsed = lastLog.parsed as any;
            devices.value.push({
              id: devId,
              name: `Device:${deviceId}`,
              type: 'device',
              protocol: protocolMode.value,
              address: protocolMode.value === 'ip' ? `${targetIp.value}:47808` : `MAC:${parsed?.sourceAddress ?? '?'}`,
              objects: [],
              loadingObjects: false,
              objectsLoaded: false,
              details: {}
            });
            expandedNodes.value.add(`link-${protocolMode.value}`);
          }
          return; // I-Am 解析完成
      }

      // 2. 处理其他报文 (需要根据挂起的请求来定位)
      // 使用更有效率的循环，而非扫描所有以提高性能
      // 从 hex 中大概提取 Invoke ID
      let apduIndex = -1;
      if (hex.startsWith('81')) apduIndex = 12;
      else if (hex.startsWith('55FF')) apduIndex = 20;
      
      if (apduIndex !== -1 && hex.length > apduIndex + 6) {
          const invokeId = parseInt(hex.substring(apduIndex + 2, apduIndex + 4), 16);
          const req = pendingRequests.get(invokeId);
          
          const result = BacnetService.parseResponse(hex, req);
          if (!result) return;
          
          if (result.data) {
              const parsedData = result.data;
              
              // 特殊情况：发现对象列表
              if (parsedData.propId === BacnetPropertyIdentifier.ObjectList.toString() && parsedData.foundObjects) {
                  const activeDevice = devices.value.find(d => d.loadingObjects);
                  if (activeDevice) {
                      const existingIds = new Set(activeDevice.objects.map((o: any) => o.id));
                      const newObjects = parsedData.foundObjects.filter((o:any) => !existingIds.has(o.id));
                      newObjects.forEach((o:any) => o.protocol = activeDevice.protocol);
                      activeDevice.objects.push(...newObjects);
                      activeDevice.objectsLoaded = true;
                  }
              }

              if (req) {
                  // 数据写入 details
                  if (parsedData.value !== undefined) {
                      req.item.details[req.propId] = parsedData.value;
                  }
                  
                  if (parsedData.isError) {
                      if (!parsedData.isEndOfList) {
                          req.item.details[req.propId] = parsedData.value;
                      }
                  }
                  
                  // 针对扫点逻辑的滑动窗口和处理
                  if (req.propId === BacnetPropertyIdentifier.ObjectList.toString()) {
                      if (parsedData.isEndOfList) {
                          console.log(`[扫描终点] 探测到索引越界 (${req.index})，全量同步完成。`);
                          req.item.isScanFinished = true;
                          req.item.loadingObjects = false;
                          req.item.objectsLoaded = true;
                      } else {
                          const devInst = parseInt(req.item.id.replace('dev-', ''));
                          const batchSize = 10;
                          
                          if (req.index === 0 && parsedData.totalCount !== undefined) {
                              console.log(`江森报告点位数: ${parsedData.totalCount} (当前探测深度: ${req.item.totalObjects})`);
                              for (let i = 1; i <= batchSize; i++) {
                                req.item.currentIndex = i;
                                const iId = (invokeIdCounter % 254) + 1;
                                invokeIdCounter = iId;
                                const nextReq = BacnetService.createReadPropertyPayload(8, devInst, BacnetPropertyIdentifier.ObjectList, iId, i);
                                pendingRequests.set(iId, { item: req.item, propId: req.propId, index: i, timestamp: Date.now() });
                                if (protocolMode.value === 'ip') {
                                    deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: nextReq }).catch(console.error);
                                }
                              }
                          } else if (req.index !== undefined && req.index > 0 && req.item.currentIndex < req.item.totalObjects && !req.item.isScanFinished) {
                              req.item.currentIndex++;
                              const nextIdx = req.item.currentIndex;
                              const iId = (invokeIdCounter % 254) + 1;
                              invokeIdCounter = iId;
                              const nextReq = BacnetService.createReadPropertyPayload(8, devInst, BacnetPropertyIdentifier.ObjectList, iId, nextIdx);
                              pendingRequests.set(iId, { item: req.item, propId: req.propId, index: nextIdx, timestamp: Date.now() });
                              if (protocolMode.value === 'ip') {
                                  deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: nextReq }).catch(console.error);
                              }
                              req.item.processedCount = (req.item.processedCount || 0) + 1;
                          }
                      }
                  }
              }
              
              if (result.invokeId) {
                  pendingRequests.delete(result.invokeId);
              }
          }
      }
  }
);

</script>

<template>
  <div class="bacnet-scan-container">
    <!-- 顶部工具栏 -->
    <div class="top-toolbar">
      <div class="toolbar-group">
        <button class="tool-btn" @click="toggleConnection" :class="{ connected: deviceStore.isBacnetConnected }">
          <Play v-if="!deviceStore.isBacnetConnected" :size="16" />
          <Square v-else :size="16" />
          <span>{{ deviceStore.isBacnetConnected ? '断开' : '连接' }}</span>
        </button>
        <button class="tool-btn" :disabled="!deviceStore.isBacnetConnected || isScanning" @click="scanDevices">
          <Search :size="16" :class="{ spinning: isScanning }" />
          <span>{{ isScanning ? '扫描中...' : '扫描' }}</span>
        </button>
      </div>
      <div class="divider"></div>
      <div class="toolbar-group">
        <select v-model="protocolMode" class="toolbar-select">
          <option value="ip">BACnet IP</option>
          <option value="mstp">BACnet MS/TP</option>
        </select>
        <input 
          v-if="protocolMode === 'ip'" 
          v-model="targetIp" 
          placeholder="网关 IP" 
          class="toolbar-input"
          :class="{ 'error-input': ipError }"
          @input="validateInputs"
        />
        <input 
          v-else 
          v-model="msTpMac" 
          type="number" 
          placeholder="MAC" 
          class="toolbar-input small"
          :class="{ 'error-input': macError }"
          @input="validateInputs"
        />
        
        <div v-if="protocolMode === 'ip'" class="toolbar-checkbox">
          <input type="checkbox" id="fd-reg" v-model="useForeignDevice" />
          <label for="fd-reg">外来设备</label>
          <input v-if="useForeignDevice" type="number" v-model="ttl" min="1" max="65535" title="TTL" class="toolbar-input tiny" />
        </div>
      </div>
    </div>


    <!-- 主工作区 -->
    <div class="main-workspace">
      <!-- 上部：三栏布局 -->
      <div class="upper-layout">
        <!-- 1. 左侧：设备树 -->
        <aside class="sidebar-tree">
          <div class="tree-header">
            <div class="header-left">
              <Network :size="14" />
              <span>BACnet 网络</span>
            </div>
            <button class="header-action-btn" @click="clearDevices" title="清除设备列表">
              <Trash2 :size="12" />
            </button>
          </div>
          <div class="tree-content">
            <div class="tree-node root">
              <div class="node-label" @click="toggleNode('root')">
                <ChevronDown v-if="expandedNodes.has('root')" :size="14" />
                <ChevronRight v-else :size="14" />
                <Server :size="14" />
                <span>BACnet</span>
              </div>
              
              <div v-if="expandedNodes.has('root')" class="node-children">
                <!-- IP 链路 -->
                <div class="tree-node">
                  <div class="node-label" @click="toggleNode('link-ip')">
                    <ChevronDown v-if="expandedNodes.has('link-ip')" :size="14" />
                    <ChevronRight v-else :size="14" />
                    <Network :size="14" />
                    <span>BACnet IP</span>
                  </div>
                  <div v-if="expandedNodes.has('link-ip')" class="node-children">
                    <div v-for="dev in devices.filter(d => d.protocol === 'ip')" :key="dev.id" class="tree-node">
                      <div class="node-label" 
                           :class="{ selected: selectedItem?.id === dev.id }"
                           @click="selectItem(dev); toggleNode(dev.id)">
                        <ChevronDown v-if="expandedNodes.has(dev.id)" :size="14" />
                        <ChevronRight v-else :size="14" />
                        <Cpu :size="14" />
                        <span>{{ dev.name }}</span>
                      </div>
                      <div v-if="expandedNodes.has(dev.id)" class="node-children">
                        <div v-if="dev.loadingObjects" class="loading-text">
                          正在读取 ({{ (dev.processedCount || 0) }}/{{ (dev.totalObjects || '?') }})...
                        </div>
                        <div v-else-if="!dev.objectsLoaded" class="loading-text clickable" @click="discoverObjects(dev)">点击获取点位</div>
                        <div v-for="obj in dev.objects" :key="obj.id" 
                             class="node-label object"
                             :class="{ selected: selectedItem?.id === obj.id }"
                             @click="selectItem(obj)">
                          <Box :size="14" />
                          <span>{{ obj.name }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- MS/TP 链路 -->
                <div class="tree-node">
                  <div class="node-label" @click="toggleNode('link-mstp')">
                    <ChevronDown v-if="expandedNodes.has('link-mstp')" :size="14" />
                    <ChevronRight v-else :size="14" />
                    <Radio :size="14" />
                    <span>BACnet MS/TP</span>
                  </div>
                  <div v-if="expandedNodes.has('link-mstp')" class="node-children">
                    <div v-for="dev in devices.filter(d => d.protocol === 'mstp')" :key="dev.id" class="tree-node">
                      <div class="node-label" 
                           :class="{ selected: selectedItem?.id === dev.id }"
                           @click="selectItem(dev); toggleNode(dev.id)">
                        <ChevronDown v-if="expandedNodes.has(dev.id)" :size="14" />
                        <ChevronRight v-else :size="14" />
                        <Cpu :size="14" />
                        <span>{{ dev.name }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- 2. 中间：属性表 (高密度显示) -->
        <section class="property-view">
          <div class="view-header">
            <div class="header-left">
              <List :size="14" />
              <span>属性列表</span>
            </div>
          </div>
          <div class="table-container">
            <table class="property-table">
              <thead>
                <tr>
                  <th style="width: 40%">属性</th>
                  <th style="width: 60%">值</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="prop in displayProperties" :key="prop.name">
                  <td class="prop-name" v-html="prop.name"></td>
                  <td class="prop-value">{{ prop.value }}</td>
                </tr>
                <tr v-if="!selectedItem">
                  <td colspan="2" class="empty-row">未选点位</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 3. 右侧：通信日志 (报文优先) -->
        <aside class="side-logs">
          <div class="view-header">
            <div class="header-left">
              <Terminal :size="14" />
              <span>通信日志</span>
            </div>
            <button class="header-action-btn" @click="deviceStore.clearLogs()" title="清除日志">
              <Trash2 :size="12" />
            </button>
          </div>
          <div class="log-table-container">
            <table class="log-table">
              <thead>
                <tr>
                  <th style="width: 75px">时间</th>
                  <th style="width: 55px">收发</th>
                  <th>原始报文 (HEX)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in deviceStore.bacnetLogs" :key="log.id" :class="log.direction">
                  <td class="time">{{ log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</td>
                  <td class="dir">
                    <span class="dir-tag" :class="log.direction">{{ log.direction.toUpperCase() }}</span>
                  </td>
                  <td class="hex">{{ log.hex }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </aside>
      </div>

      <!-- 下部：写命令控制区 (占位) -->
      <footer class="command-control-panel">
        <div class="view-header">
          <div class="header-left">
            <Edit3 :size="14" />
            <span>写命令控制区</span>
          </div>
        </div>
        <div class="command-area-placeholder">
          <div class="placeholder-content">
            <Edit3 :size="32" class="placeholder-icon" />
            <p>写命令控制功能正在开发中...</p>
            <p class="sub-text">此处将支持 <b>Present Value</b> 写入、优先级选择及命令下发日志</p>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.bacnet-scan-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  overflow: hidden;
}

.top-toolbar {
  height: 48px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 1rem;
  gap: 1rem;
  flex-shrink: 0;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  cursor: pointer;
}

.tool-btn:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.tool-btn.connected {
  color: #ef4444;
  border-color: #ef4444;
}

.divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
}

.toolbar-select, .toolbar-input {
  height: 28px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.toolbar-input.small {
  width: 60px;
}

.toolbar-input.tiny {
  width: 70px;
  height: 28px;
}

.toolbar-checkbox {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.toolbar-checkbox input[type="checkbox"] {
  width: 14px;
  height: 14px;
}

.main-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.upper-layout {
  flex: 7;
  display: flex;
  min-height: 0;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-tree {
  width: 280px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  flex-shrink: 0;
}

.property-view {
  width: 550px; /* 已增加到 550px */
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--color-surface);
}

.side-logs {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg);
}

.command-control-panel {
  flex: 3;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  min-height: 180px;
}

.command-area-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.view-header, .tree-header {
  height: 32px;
  background: rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-action-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}

.header-action-btn:hover {
  background: rgba(255,255,255,0.1);
  color: #ef4444;
}

.table-container, .log-table-container {
  flex: 1;
  overflow: auto;
}

.property-table, .log-table {
  width: 100%;
  border-collapse: collapse;
}

.property-table {
  table-layout: fixed; /* 强制锁定列宽比例 */
}

.property-table th, .log-table th {
  position: sticky;
  top: 0;
  background: var(--color-surface);
  text-align: left;
  padding: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
  white-space: nowrap;
}

.property-table td, .log-table td {
  padding: 0.4rem 0.5rem;
  font-size: 0.82rem;
  border-bottom: 1px solid rgba(255,255,255,0.02);
}

.prop-name {
  color: var(--color-text-secondary);
  white-space: normal;
  font-size: 0.75rem;
  width: 40%;
}

.prop-value {
  font-family: 'Consolas', monospace;
  color: #7dd3fc;
  white-space: normal;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.4;
}



.dir-tag {
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 4px;
  border-radius: 2px;
}

.dir-tag.tx { background: rgba(14, 165, 233, 0.2); color: #38bdf8; }
.dir-tag.rx { background: rgba(34, 197, 94, 0.2); color: #4ade80; }

.log-table .hex {
  font-family: 'Consolas', monospace;
  color: var(--color-text-secondary);
  word-break: break-all;
  opacity: 0.8;
}

.empty-row {
  text-align: center;
  padding: 2rem !important;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.8rem;
}

.tree-content { flex: 1; overflow-y: auto; padding: 0.5rem; }
.tree-node .node-label {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.6rem;
  cursor: pointer; font-size: 0.85rem; border-radius: 4px; white-space: nowrap;
}
.tree-node .node-label:hover { background: rgba(255,255,255,0.05); }
.tree-node .node-label.selected { background: var(--color-primary); color: white; }
.loading-text { font-size: 0.75rem; color: var(--color-text-secondary); padding: 0.3rem 0.6rem; font-style: italic; }
.node-children { padding-left: 1rem; }
.node-label.object { color: var(--color-text-secondary); }
.node-label.object.selected { color: white; }
</style>
