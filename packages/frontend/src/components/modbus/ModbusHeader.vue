<script setup lang="ts">
import { computed } from 'vue';
import { useDeviceStore } from '@/stores/deviceStore';
import type { useModbusState } from './composables/useModbusState';
import type { useModbusActions } from './composables/useModbusActions';

const props = defineProps<{
  state: ReturnType<typeof useModbusState>;
  actions: ReturnType<typeof useModbusActions>;
}>();

const { state, actions } = props;
const deviceStore = useDeviceStore();

const baudRateOptions = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const isSecure = window.isSecureContext;

const currentGateway = computed(() => {
  return deviceStore.gateways.find(g => 
    g.siteId === deviceStore.mqttConfig.siteId && 
    g.gatewayId === deviceStore.mqttConfig.gatewayId
  );
});

const filteredGateways = computed(() => {
  const filterSite = (deviceStore.mqttConfig.siteId || '').trim().toLowerCase();
  if (!filterSite) return deviceStore.gateways;
  return deviceStore.gateways.filter(g => 
    g.siteId.toLowerCase().includes(filterSite)
  );
});

const tcpEndpoint = computed({
  get: () => {
    const target = deviceStore.gatewayOptions.tcpTarget as any;
    if (!target.ip && !target.port) return '';
    return target.port ? `${target.ip}:${target.port}` : target.ip;
  },
  set: (value: string) => {
    const raw = value.trim();
    const current = deviceStore.gatewayOptions.tcpTarget as any;
    if (!raw) {
      deviceStore.updateGatewayOptions({
        tcpTarget: {
          ...current,
          ip: '',
          port: current.port
        }
      });
      return;
    }
    const [ipPart, portPart] = raw.split(':');
    const parsedPort = portPart ? Number(portPart) : current.port;
    deviceStore.updateGatewayOptions({
      tcpTarget: {
        ...current,
        ip: ipPart.trim(),
        port: Number.isFinite(parsedPort) ? parsedPort : current.port
      }
    });
  }
});

const gatewayTooltip = computed(() => {
  const gw = currentGateway.value;
  if (!gw?.online) return '未发现网关或离线';

  const parts: string[] = ['在线'];

  if (gw.config?.version) parts.push(`v${gw.config.version}`);
  if (deviceStore.gatewayOptions.protocol === 'tcp') {
    if (gw.config?.ethIp) parts.push(`ETH: ${gw.config.ethIp}`);
  } else {
    if (gw.config?.baud) {
      const p = gw.config.parity === 'even' ? 'E' : gw.config.parity === 'odd' ? 'O' : 'N';
      const s = gw.config.stopBits ?? 1;
      parts.push(`${gw.config.baud}-8${p}${s}`);
    }
  }
  if (gw.config?.wifiIp) parts.push(`WiFi: ${gw.config.wifiIp}`);

  return parts.join(' | ');
});

async function toggleConnection() {
  if (deviceStore.isModbusConnected) {
    if (state.connectionType.value === 'mqtt') {
      await deviceStore.disconnectGateway();
    } else {
      await deviceStore.disconnect();
    }
    return;
  }

  if (state.connectionType.value === 'mqtt') {
    const opts = deviceStore.mqttConfig;
    if (!opts.brokerUrl || !opts.topicPrefix || !opts.siteId || !opts.gatewayId) {
      actions.showToast('请填写完整的 MQTT 配置信息', 'error');
      return;
    }
    await deviceStore.connectMqtt();
    return;
  }

  await deviceStore.connect();
}

async function toggleBrokerConnection() {
   if (deviceStore.isMqttBrokerConnected) {
     await deviceStore.disconnectBroker();
   } else {
     await deviceStore.connectMqttBroker();
   }
}

function togglePing() {
    if (deviceStore.isPinging) {
        deviceStore.stopPing();
    } else {
        deviceStore.startPing();
    }
}

async function probeLocalTcp() {
    const target = deviceStore.gatewayOptions.tcpTarget;
    try {
        await deviceStore.probeBridge(target.ip, target.port);
    } catch (err: any) {
        actions.showToast(err.message, 'error');
    }
}
</script>

<template>
    <section class="panel-section header-section relative">
      <div class="header-row">
        <div class="header-left-col">
          <h2 class="section-title">
            <span class="icon">🔌</span>
            连接配置
          </h2>
          <!-- 状态摘要 -->
          <div v-if="state.connectionType.value === 'mqtt'" class="header-status-summary">
            <div class="status-row" :class="{ 'status-connected': deviceStore.isMqttBrokerConnected }">
              <span class="status-dot" :class="deviceStore.isMqttBrokerConnected ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">Broker</span>
              <span>: {{ deviceStore.isMqttBrokerConnected ? '已连接' : '未连接' }}</span>
            </div>
            <div class="status-row cursor-help" :class="{ 'status-connected': currentGateway?.online }" :title="currentGateway?.online ? gatewayTooltip : ''">
              <span class="status-dot" :class="currentGateway?.online ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">网关</span>
              <span>: {{ currentGateway?.online ? '在线' : '离线' }}</span>
            </div>
          </div>
          <div v-else class="header-status-summary">
            <div class="status-row" :class="{ 'status-connected': deviceStore.modbusMode === 'rtu' && deviceStore.isModbusConnected }">
              <span class="status-dot" :class="(deviceStore.modbusMode === 'rtu' && deviceStore.isModbusConnected) ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">RTU</span>
              <span>: {{ (deviceStore.modbusMode === 'rtu' && deviceStore.isModbusConnected) ? '已连接' : '未连接' }}</span>
            </div>
            <div class="status-row" :class="{ 'status-connected': deviceStore.modbusMode === 'tcp' && deviceStore.isModbusConnected }">
              <span class="status-dot" :class="(deviceStore.modbusMode === 'tcp' && deviceStore.isModbusConnected) ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">TCP</span>
              <span>: {{ (deviceStore.modbusMode === 'tcp' && deviceStore.isModbusConnected) ? '已连接' : '未连接' }}</span>
            </div>
          </div>
        </div>

        <div class="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
          <div class="inline-flex rounded-full bg-slate-100 p-1 shadow-inner items-center gap-1">
            <button
              class="mode-tab"
              :class="{ active: ['serial', 'bridge'].includes(state.connectionType.value) }"
              @click="state.connectionType.value = 'serial'"
            >
              本地直连
            </button>
            <button
              class="mode-tab"
              :class="{ active: state.connectionType.value === 'mqtt' }"
              @click="state.connectionType.value = 'mqtt'"
            >
              <span>远程MQTT</span>
              <span
                class="ml-1 cursor-pointer"
                @click.stop="
                  state.connectionType.value = 'mqtt';
                  state.showMqttDialog.value = true;
                "
              >
                ⚙
              </span>
            </button>
          </div>

          <div class="config-bar">
            <div
              class="config-group flex flex-wrap md:flex-nowrap items-center gap-1.5 flex-1"
              v-if="state.connectionType.value === 'mqtt'"
            >
              <!-- 网关下拉 + 管理按钮 -->
              <div class="gateway-select-wrap">
                <select
                  v-model="state.selectedGatewayId.value"
                  :disabled="deviceStore.isModbusConnected || deviceStore.gateways.length === 0"
                  class="gateway-select"
                >
                  <option value="" disabled v-if="deviceStore.gateways.length === 0">
                    未发现网关
                  </option>
                  <option value="" v-else>
                    手动指定网关
                  </option>
                  <option
                    v-for="g in filteredGateways"
                    :key="g.id"
                    :value="`${g.siteId}/${g.gatewayId}`"
                    :disabled="!g.online"
                  >
                    {{ g.online ? '●' : '○' }} {{ g.siteId }} / {{ g.gatewayId }}{{ g.online ? '' : ' (离线)' }}
                  </option>
                </select>

                <!-- 管理按钮：有网关时显示 -->
                <button
                  v-if="deviceStore.gateways.length > 0"
                  class="btn-manage-gateways"
                  title="管理网关列表"
                  @click="state.showGatewayManager.value = true"
                >
                  ⚙
                </button>
              </div>

              <!-- 网关在线状态指示器 + Site ID / Gateway ID 输入框 -->
              <div class="gateway-id-inputs">
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="deviceStore.isModbusConnected"
                  :value="deviceStore.mqttConfig.siteId"
                  placeholder="Site ID"
                  @input="(e) => {
                    deviceStore.saveMqttConfig({ siteId: (e.target as HTMLInputElement).value });
                    state.selectedGatewayId.value = '';
                  }"
                />
                <span class="gateway-id-sep">/</span>
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="deviceStore.isModbusConnected"
                  :value="deviceStore.mqttConfig.gatewayId"
                  placeholder="Gateway ID"
                  @input="(e) => {
                    deviceStore.saveMqttConfig({ gatewayId: (e.target as HTMLInputElement).value });
                    state.selectedGatewayId.value = '';
                  }"
                />
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div class="base-switch">
                  <button
                    :class="{ active: deviceStore.gatewayOptions.protocol === 'rtu' }"
                    :disabled="deviceStore.isModbusConnected"
                    @click="deviceStore.setModbusMode('rtu')"
                  >
                    RTU
                  </button>
                  <button
                    :class="{ active: deviceStore.gatewayOptions.protocol === 'tcp' }"
                    :disabled="deviceStore.isModbusConnected"
                    @click="deviceStore.setModbusMode('tcp')"
                  >
                    TCP
                  </button>
                </div>
              </div>

              <div class="flex items-center gap-2 flex-1 min-w-[220px]">
                <template v-if="deviceStore.gatewayOptions.protocol === 'tcp'">
                  <input
                    type="text"
                    v-model="tcpEndpoint"
                    :disabled="deviceStore.isModbusConnected"
                    placeholder="IP:Port"
                    class="flex-1"
                  />
                </template>

                <template v-else>
                  <select
                    v-model.number="deviceStore.gatewayOptions.rtuTarget.baudRate"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-28"
                  >
                    <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                      {{ rate }} bps
                    </option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.dataBits"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-20"
                  >
                    <option :value="7">7 数据位</option>
                    <option :value="8">8 数据位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.stopBits"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-24"
                  >
                    <option :value="1">1 停止位</option>
                    <option :value="2">2 停止位</option>
                  </select>

                  <select
                    v-model="deviceStore.gatewayOptions.rtuTarget.parity"
                    :disabled="deviceStore.isModbusConnected"
                    class="w-24"
                  >
                    <option value="none">无校验</option>
                    <option value="even">偶校验</option>
                    <option value="odd">奇校验</option>
                  </select>
                </template>
              </div>
            </div>

            <div class="config-group" v-else>
              <!-- 本地直连：增加模式切换 -->
              <div class="base-switch">
                <button
                  :class="{ active: deviceStore.modbusMode === 'rtu' }"
                  :disabled="deviceStore.isModbusConnected"
                  @click="deviceStore.setModbusMode('rtu')"
                >
                  RTU
                </button>
                <button
                  :class="{ active: deviceStore.modbusMode === 'tcp' }"
                  :disabled="deviceStore.isModbusConnected"
                  @click="deviceStore.setModbusMode('tcp')"
                >
                  TCP
                </button>
              </div>

              <!-- 本地 RTU 模式：显示串口参数 -->
              <template v-if="deviceStore.modbusMode === 'rtu'">
                <select v-model="deviceStore.serialConfig.baudRate" :disabled="deviceStore.isModbusConnected">
                  <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                    {{ rate }} bps
                  </option>
                </select>

                <select v-model="deviceStore.serialConfig.dataBits" :disabled="deviceStore.isModbusConnected">
                  <option :value="7">7 数据位</option>
                  <option :value="8">8 数据位</option>
                </select>

                <select v-model="deviceStore.serialConfig.stopBits" :disabled="deviceStore.isModbusConnected">
                  <option :value="1">1 停止位</option>
                  <option :value="2">2 停止位</option>
                </select>

                <select v-model="deviceStore.serialConfig.parity" :disabled="deviceStore.isModbusConnected">
                  <option value="none">无校验</option>
                  <option value="even">偶校验</option>
                  <option value="odd">奇校验</option>
                </select>
              </template>

              <!-- 本地 TCP 模式：显示桥接端点 -->
              <template v-else>
                <div class="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <input
                    type="text"
                    v-model="tcpEndpoint"
                    :disabled="deviceStore.isModbusConnected"
                    placeholder="127.0.0.1:502 (TCP 桥接)"
                    class="flex-1"
                  />
                </div>
              </template>
            </div>

            <!-- MQTT 模式：Broker 连接状态条 -->
            <div v-if="state.connectionType.value === 'mqtt'" class="broker-status-bar">
              <button
                class="btn-broker"
                :class="{ connected: deviceStore.isMqttBrokerConnected }"
                :disabled="deviceStore.isMqttBrokerConnecting || deviceStore.isModbusConnected"
                @click="toggleBrokerConnection"
              >
                {{ deviceStore.isMqttBrokerConnected ? '断开 Broker' : '连接 Broker' }}
              </button>
            </div>

            <button 
              :class="[
                'btn-connect',
                { 'min-w-[96px] md:min-w-[110px]': state.connectionType.value === 'mqtt' },
                { connected: deviceStore.isModbusConnected, connecting: deviceStore.isModbusConnecting }
              ]"
              style="height: 32px; padding: 0 12px; margin-left: 0; flex-shrink: 0; display: flex; align-items: center; gap: 4px;"
              :disabled="deviceStore.isModbusConnecting || (!deviceStore.isSupported && state.connectionType.value === 'serial') || (state.connectionType.value === 'mqtt' && !deviceStore.isMqttBrokerConnected && !deviceStore.isModbusConnected)"
              @click="toggleConnection"
            >
              <span v-if="deviceStore.isModbusConnecting" class="spinner" style="width: 12px; height: 12px; border-width: 2px;"></span>
              {{ deviceStore.isModbusConnected ? '断开网关' : '连接网关' }}
            </button>

            <!-- 本地模式探测 (回归正常位次和样式) -->
            <button
              v-if="state.connectionType.value !== 'mqtt' && deviceStore.modbusMode === 'tcp' && deviceStore.isModbusConnected"
              class="btn-ping"
              style="margin-left: 8px; height: 32px;"
              @click="probeLocalTcp"
            >
              📡 Ping
            </button>

            <button
              v-if="deviceStore.isModbusConnected && state.connectionType.value === 'mqtt' && deviceStore.gatewayOptions.protocol === 'tcp'"
              class="btn-ping"
              :class="{ pinging: deviceStore.isPinging }"
              @click="togglePing"
            >
              {{ deviceStore.isPinging ? '🔴 Stop' : '📡 Ping' }}
            </button>

            <!-- 本地 TCP 提示：放在连接按钮后 -->
            <div 
              v-if="state.connectionType.value !== 'mqtt' && deviceStore.modbusMode === 'tcp'"
              class="help-icon ml-1.5 flex items-center self-center"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;" class="info-svg text-gray-400 hover:text-indigo-500 cursor-help transition-colors">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <div class="tooltip" style="background-color: #fff9c4 !important; color: #333333 !important; white-space: nowrap !important; bottom: 125% !important; padding: 10px !important; border: 1px solid #ddd !important; border-radius: 4px !important; box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important;">
                本地 TCP 调试依赖于 <code>anyport-bridge</code> 桥接程序。请确保本地服务（默认 8081）已就绪。
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="state.connectionType.value === 'serial' && !isSecure" class="error-banner">
        ❌ 检测到非安全上下文。Web Serial API 需要 <strong>HTTPS</strong> 或 <strong>localhost</strong>。不允许使用 IP 地址访问。
      </div>
      <div v-else-if="state.connectionType.value === 'serial' && !deviceStore.isSupported" class="warning-banner">
        ⚠️ 当前浏览器不支持 Web Serial API。
      </div>
    </section>
</template>
