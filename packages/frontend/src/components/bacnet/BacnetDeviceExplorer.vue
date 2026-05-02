<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import { ProtocolType } from '@shared/types/protocol.types';
import { BacnetService } from '@/protocols/bacnet';
import { BacnetPropertyIdentifier, BACNET_PROPERTY_NAMES } from '@/protocols/bacnet/constants';
import {
  Network,
  Cpu,
  Box,
  List,
  Trash2,
  ChevronRight,
  ChevronDown,
  Server,
  Radio
} from 'lucide-vue-next';
import { watch } from 'vue';

const props = defineProps<{
  protocolMode: 'mstp' | 'ip';
  targetIp: string;
  msTpMac: number;
  isConnected: boolean;
}>();

const emit = defineEmits<{
  scan: [];
}>();

const deviceStore = useDeviceStore();

// --- 状态 ---
const isScanning = ref(false);
const expandedNodes = ref<Set<string>>(new Set(['root', 'link-ip', 'link-mstp']));
const devices = ref<any[]>([]);
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

// 清理超时请求
const requestCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, req] of pendingRequests.entries()) {
        if (now - req.timestamp > 10000) {
            if (req.item && req.item.details) {
                if (!req.item.details[req.propId] && req.propId !== BacnetPropertyIdentifier.ObjectList.toString()) {
                    req.item.details[req.propId] = '(超时)';
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

// --- 计算属性 ---
const displayProperties = computed(() => {
  if (!selectedItem.value) return [];
  const details = selectedItem.value.details || {};
  const results: any[] = [];

  if (selectedItem.value.type === 'device') {
    results.push({ name: 'Address', value: selectedItem.value.address });
    results.push({ name: 'SNET', value: details['SNET'] || '0' });
    results.push({ name: 'SADR', value: details['SADR'] || '' });
  }

  const pids = selectedItem.value.type === 'device'
    ? [121, 77, 75, 120, 70, 28, 62]
    : [85, 81, 111, 117, 36, 77, 79, 75, 28, 65, 69];

  pids.forEach(pid => {
    let name = BACNET_PROPERTY_NAMES[pid] || pid.toString();
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

// --- 动作函数 ---
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
  if (!props.isConnected) return;

  const invId = (invokeIdCounter % 254) + 1;
  invokeIdCounter = invId;
  pendingRequests.set(invId, { item, propId: propertyId.toString(), timestamp: Date.now() });

  let objType = 0;
  let objInstance = 0;

  if (item.type === 'device') {
    objType = 8;
    objInstance = parseInt(item.id.replace('dev-', ''));
  } else {
    const parts = item.id.replace('obj-', '').split('-');
    objType = parseInt(parts[0]);
    objInstance = parseInt(parts[1]);
  }

  const payload = BacnetService.createReadPropertyPayload(objType, objInstance, propertyId, invId);
  const device = item.type === 'device' ? item : devices.value.find(d => d.objects?.includes(item));

  try {
      if (props.protocolMode === 'ip') {
        await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: payload });
      } else if (device) {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_MSTP,
          destinationAddress: parseInt(device.address?.split(':')[1] || '0'),
          sourceAddress: props.msTpMac,
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
  if (!props.isConnected || device.loadingObjects) return;

  device.loadingObjects = true;
  device.currentIndex = 0;
  device.processedCount = 0;
  device.totalObjects = 20000;
  device.objects = [];
  device.isScanFinished = false;

  const deviceInstance = parseInt(device.id.replace('dev-', ''));
  const invId = (invokeIdCounter % 254) + 1;
  invokeIdCounter = invId;
  const propId = BacnetPropertyIdentifier.ObjectList;
  const reqCount = BacnetService.createReadPropertyPayload(8, deviceInstance, propId, invId, 0);
  pendingRequests.set(invId, { item: device, propId: propId.toString(), index: 0, timestamp: Date.now() });

  try {
      if (props.protocolMode === 'ip') {
        await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: reqCount });
      } else {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_MSTP,
          destinationAddress: parseInt(device.address?.replace('MAC:', '') || '0'),
          sourceAddress: props.msTpMac, frameType: 0x05, data: reqCount
        });
      }
  } catch (e) {
      console.error('Discover Objects Init Error:', e);
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
          if (props.protocolMode === 'ip') {
            await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_IP, bvlcFunction: 0x0A, data: nextReq });
          } else {
            await deviceStore.sendCommand({ protocol: ProtocolType.BACNET_MSTP, destinationAddress: parseInt(device.address?.replace('MAC:', '') || '0'), sourceAddress: props.msTpMac, frameType: 0x05, data: nextReq });
          }
      } catch (e) {
          console.error('Discover Objects Polling Error:', e);
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

async function scanDevices() {
  if (!props.isConnected || isScanning.value) return;

  isScanning.value = true;
  devices.value = [];
  selectedItem.value = null;

  const to = setTimeout(() => { if (isScanning.value) isScanning.value = false; }, 3000);
  activeTimeouts.add(to);

  try {
      const whoIsPayload = BacnetService.createWhoIsPayload();

      if (props.protocolMode === 'ip') {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_IP,
          bvlcFunction: 0x0B,
          data: whoIsPayload
        });
      } else {
        await deviceStore.sendCommand({
          protocol: ProtocolType.BACNET_MSTP,
          destinationAddress: 255,
          sourceAddress: props.msTpMac,
          frameType: 0x06,
          data: whoIsPayload
        });
      }
  } catch(e) {
      console.error('Scan Error:', e);
      isScanning.value = false;
  }
}

// 响应处理 - 监听 BACnet 日志
watch(
  () => deviceStore.bacnetLogs[0],
  (lastLog) => {
      if (!lastLog || lastLog.direction !== 'rx') return;

      const hex = lastLog.hex.replace(/\s/g, '').toUpperCase();

      // 1. 处理 I-Am（发现设备）
      const deviceId = BacnetService.parseIAmDeviceId(hex);
      if (deviceId !== null) {
          const devId = `dev-${deviceId}`;
          if (!devices.value.find(d => d.id === devId)) {
            const parsed = lastLog.parsed as any;
            devices.value.push({
              id: devId,
              name: `Device:${deviceId}`,
              type: 'device',
              protocol: props.protocolMode,
              address: props.protocolMode === 'ip' ? `${props.targetIp}:47808` : `MAC:${parsed?.sourceAddress ?? '?'}`,
              objects: [],
              loadingObjects: false,
              objectsLoaded: false,
              details: {}
            });
            expandedNodes.value.add(`link-${props.protocolMode}`);
            isScanning.value = false;
          }
          return;
      }

      // 2. 处理其他报文
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

              if (parsedData.propId === BacnetPropertyIdentifier.ObjectList.toString() && parsedData.foundObjects) {
                  const activeDevice = devices.value.find(d => d.loadingObjects);
                  if (activeDevice) {
                      const existingIds = new Set(activeDevice.objects.map((o: any) => o.id));
                      const newObjects = parsedData.foundObjects.filter((o: any) => !existingIds.has(o.id));
                      newObjects.forEach((o: any) => o.protocol = activeDevice.protocol);
                      activeDevice.objects.push(...newObjects);
                      activeDevice.objectsLoaded = true;
                  }
              }

              if (req) {
                  if (parsedData.value !== undefined) {
                      req.item.details[req.propId] = parsedData.value;
                  }

                  if (parsedData.isError) {
                      if (!parsedData.isEndOfList) {
                          req.item.details[req.propId] = parsedData.value;
                      }
                  }

                  if (req.propId === BacnetPropertyIdentifier.ObjectList.toString()) {
                      if (parsedData.isEndOfList) {
                          req.item.isScanFinished = true;
                          req.item.loadingObjects = false;
                          req.item.objectsLoaded = true;
                      } else {
                          const devInst = parseInt(req.item.id.replace('dev-', ''));
                          const batchSize = 10;

                          if (req.index === 0 && parsedData.totalCount !== undefined) {
                              for (let i = 1; i <= batchSize; i++) {
                                req.item.currentIndex = i;
                                const iId = (invokeIdCounter % 254) + 1;
                                invokeIdCounter = iId;
                                const nextReq = BacnetService.createReadPropertyPayload(8, devInst, BacnetPropertyIdentifier.ObjectList, iId, i);
                                pendingRequests.set(iId, { item: req.item, propId: req.propId, index: i, timestamp: Date.now() });
                                if (props.protocolMode === 'ip') {
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
                              if (props.protocolMode === 'ip') {
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

// 向外暴露扫描接口，供 BacnetPanel 工具栏调用
defineExpose({ scanDevices, isScanning });
</script>

<template>
  <div class="explorer-root">
    <!-- 三栏主布局 -->
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

      <!-- 2. 中间：属性面板 -->
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
    </div>
  </div>
</template>

<style scoped>
.explorer-root {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.upper-layout {
  flex: 1;
  display: flex;
  min-height: 0;
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
  width: 550px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--color-surface);
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

.table-container {
  flex: 1;
  overflow: auto;
}

.property-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.property-table th {
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

.property-table td {
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
.loading-text.clickable { cursor: pointer; text-decoration: underline; }
.node-children { padding-left: 1rem; }
.node-label.object { color: var(--color-text-secondary); }
.node-label.object.selected { color: white; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spinning { animation: spin 1s linear infinite; }
</style>
