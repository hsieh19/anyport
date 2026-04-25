<script setup lang="ts">
import { computed } from 'vue';

type ConnectionType = 'serial' | 'mqtt' | 'bridge';

interface WebSerialConfig {
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string | 'none' | 'even' | 'odd';
}

interface MqttConfig {
  brokerUrl: string;
  topicPrefix: string;
  siteId: string;
  gatewayId: string;
  username?: string;
  password?: string;
}

interface GatewayConfig {
  protocol: 'rtu' | 'tcp';
  tcpTarget: {
    ip: string;
    port: number;
  };
  rtuTarget: {
    baudRate: number;
    dataBits: number;
    stopBits: number;
    parity: string | 'none' | 'even' | 'odd';
  };
}

const props = defineProps<{
  // --- 连接状态 ---
  isConnected: boolean;
  isConnecting: boolean;
  connectionType: ConnectionType;

  // --- 功能开关（Feature Flags）---
  hideProtocolSwitch?: boolean;
  showBrokerControl?: boolean;
  connectBtnLabel?: string;

  // --- 透传数据 ---
  serialConfig: WebSerialConfig;
  mqttConfig: MqttConfig;
  gatewayOptions: GatewayConfig;
  gateways: any[];
  modbusMode: 'rtu' | 'tcp';
  isMqttBrokerConnected: boolean;
  isMqttBrokerConnecting: boolean;
  isSupported: boolean;
}>();

const emit = defineEmits<{
  'update:connectionType': [value: ConnectionType];
  'update:serialConfig': [config: Partial<WebSerialConfig>];
  'update:gatewayOptions': [opts: Partial<GatewayConfig>];
  'connect': [];
  'disconnect': [];
  'connect-broker': [];
  'disconnect-broker': [];
  'open-mqtt-config': [];
  'open-gateway-manager': [];
  'change-modbus-mode': [mode: 'rtu' | 'tcp'];
  'select-gateway': [id: string];
}>();

const baudRateOptions = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const isSecure = computed(() => typeof window !== 'undefined' && window.isSecureContext);

const currentGateway = computed(() => {
  return props.gateways.find(g => 
    g.siteId === props.mqttConfig.siteId && 
    g.gatewayId === props.mqttConfig.gatewayId
  );
});

const filteredGateways = computed(() => {
  const filterSite = (props.mqttConfig.siteId || '').trim().toLowerCase();
  if (!filterSite) return props.gateways;
  return props.gateways.filter(g => 
    g.siteId.toLowerCase().includes(filterSite)
  );
});

const gatewayTooltip = computed(() => {
  const gw = currentGateway.value;
  if (!gw?.online) return '未发现网关或离线';

  const parts: string[] = ['在线'];

  if (gw.config?.version) parts.push(`v${gw.config.version}`);
  if (props.gatewayOptions.protocol === 'tcp') {
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

const tcpEndpoint = computed({
  get: () => {
    const target = props.gatewayOptions.tcpTarget as any;
    if (!target.ip && !target.port) return '';
    return target.port ? `${target.ip}:${target.port}` : target.ip;
  },
  set: (value: string) => {
    const raw = value.trim();
    const current = props.gatewayOptions.tcpTarget as any;
    if (!raw) {
      emit('update:gatewayOptions', {
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
    emit('update:gatewayOptions', {
      tcpTarget: {
        ...current,
        ip: ipPart.trim(),
        port: Number.isFinite(parsedPort) ? parsedPort : current.port
      }
    });
  }
});
</script>

<template>
    <section class="panel-section header-section relative ch-root">
      <div class="header-row">
        <div class="header-left-col">
          <h2 class="section-title">
            <span class="icon">⚙️</span>
            连接配置
          </h2>
          <!-- 状态摘要 -->
          <div v-if="connectionType === 'mqtt'" class="header-status-summary">
            <div class="status-row" :class="{ 'status-connected': isMqttBrokerConnected }">
              <span class="status-dot" :class="isMqttBrokerConnected ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">Broker</span>
              <span>: {{ isMqttBrokerConnected ? '已连接' : '未连接' }}</span>
            </div>
            <div class="status-row cursor-help" :class="{ 'status-connected': currentGateway?.online }" :title="currentGateway?.online ? gatewayTooltip : ''">
              <span class="status-dot" :class="currentGateway?.online ? 'dot-on' : 'dot-off'"></span>
              <span class="status-label">网关</span>
              <span>: {{ currentGateway?.online ? '在线' : '离线' }}</span>
            </div>
          </div>
          <div v-else class="header-status-summary">
            <template v-if="!hideProtocolSwitch">
              <div class="status-row" :class="{ 'status-connected': modbusMode === 'rtu' && isConnected }">
                <span class="status-dot" :class="(modbusMode === 'rtu' && isConnected) ? 'dot-on' : 'dot-off'"></span>
                <span class="status-label">RTU</span>
                <span>: {{ (modbusMode === 'rtu' && isConnected) ? '已连接' : '未连接' }}</span>
              </div>
              <div class="status-row" :class="{ 'status-connected': modbusMode === 'tcp' && isConnected }">
                <span class="status-dot" :class="(modbusMode === 'tcp' && isConnected) ? 'dot-on' : 'dot-off'"></span>
                <span class="status-label">TCP</span>
                <span>: {{ (modbusMode === 'tcp' && isConnected) ? '已连接' : '未连接' }}</span>
              </div>
            </template>
            <template v-else>
              <div class="status-row" :class="{ 'status-connected': isConnected }">
                <span class="status-dot" :class="isConnected ? 'dot-on' : 'dot-off'"></span>
                <span class="status-label">串口状态</span>
                <span>: {{ isConnected ? '已连接' : '未连接' }}</span>
              </div>
            </template>
          </div>
          <slot name="status-extra" />
        </div>

        <div class="ch-header-controls">
          <div class="ch-mode-switch-wrap">
            <button
              class="mode-tab"
              :class="{ active: ['serial', 'bridge'].includes(connectionType) }"
              @click="emit('update:connectionType', 'serial')"
            >
              本地直连
            </button>
            <button
              class="mode-tab"
              :class="{ active: connectionType === 'mqtt' }"
              @click="emit('update:connectionType', 'mqtt')"
            >
              <span>远程MQTT</span>
              <span
                class="ml-1 cursor-pointer"
                @click.stop="
                  emit('update:connectionType', 'mqtt');
                  emit('open-mqtt-config');
                "
              >
                ⚙
              </span>
            </button>
          </div>

          <div class="config-bar">
            <div
              class="config-group ch-mqtt-config-group"
              v-if="connectionType === 'mqtt'"
            >
              <!-- 网关下拉 + 管理按钮 -->
              <div class="gateway-select-wrap">
                <select
                  :value="`${mqttConfig.siteId}/${mqttConfig.gatewayId}`"
                  @change="(e) => emit('select-gateway', (e.target as HTMLSelectElement).value)"
                  :disabled="isConnected || gateways.length === 0"
                  class="gateway-select"
                >
                  <option value="/" disabled v-if="gateways.length === 0">
                    未发现网关
                  </option>
                  <option value="/" v-else>
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
                  v-if="gateways.length > 0"
                  class="btn-manage-gateways"
                  title="管理网关列表"
                  @click="emit('open-gateway-manager')"
                >
                  ⚙
                </button>
              </div>

              <!-- 网关在线状态指示器 + Site ID / Gateway ID 输入框 -->
              <div class="gateway-id-inputs">
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="isConnected"
                  :value="mqttConfig.siteId"
                  placeholder="Site ID"
                  @input="(e) => emit('select-gateway', `${(e.target as HTMLInputElement).value}/${mqttConfig.gatewayId}`)"
                />
                <span class="gateway-id-sep">/</span>
                <input
                  type="text"
                  class="gateway-id-input"
                  :disabled="isConnected"
                  :value="mqttConfig.gatewayId"
                  placeholder="Gateway ID"
                  @input="(e) => emit('select-gateway', `${mqttConfig.siteId}/${(e.target as HTMLInputElement).value}`)"
                />
              </div>
              <div class="ch-inline-row" v-if="!hideProtocolSwitch">
                <div class="base-switch">
                  <button
                    :class="{ active: gatewayOptions.protocol === 'rtu' }"
                    :disabled="isConnected"
                    @click="emit('change-modbus-mode', 'rtu')"
                  >
                    RTU
                  </button>
                  <button
                    :class="{ active: gatewayOptions.protocol === 'tcp' }"
                    :disabled="isConnected"
                    @click="emit('change-modbus-mode', 'tcp')"
                  >
                    TCP
                  </button>
                </div>
              </div>

              <div class="ch-flex-group" v-if="!hideProtocolSwitch">
                <template v-if="gatewayOptions.protocol === 'tcp'">
                  <input
                    type="text"
                    v-model="tcpEndpoint"
                    :disabled="isConnected"
                    placeholder="IP:Port"
                    class="ch-input-flex"
                  />
                </template>

                <template v-else>
                  <select
                    :value="gatewayOptions.rtuTarget.baudRate"
                    @change="(e) => emit('update:gatewayOptions', { rtuTarget: { ...gatewayOptions.rtuTarget, baudRate: Number((e.target as HTMLSelectElement).value) } })"
                    :disabled="isConnected"
                    class="w-28"
                  >
                    <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                      {{ rate }} bps
                    </option>
                  </select>

                  <select
                    :value="gatewayOptions.rtuTarget.dataBits"
                    @change="(e) => emit('update:gatewayOptions', { rtuTarget: { ...gatewayOptions.rtuTarget, dataBits: Number((e.target as HTMLSelectElement).value) } })"
                    :disabled="isConnected"
                    class="w-20"
                  >
                    <option :value="7">7 数据位</option>
                    <option :value="8">8 数据位</option>
                  </select>

                  <select
                    :value="gatewayOptions.rtuTarget.stopBits"
                    @change="(e) => emit('update:gatewayOptions', { rtuTarget: { ...gatewayOptions.rtuTarget, stopBits: Number((e.target as HTMLSelectElement).value) } })"
                    :disabled="isConnected"
                    class="w-24"
                  >
                    <option :value="1">1 停止位</option>
                    <option :value="2">2 停止位</option>
                  </select>

                  <select
                    :value="gatewayOptions.rtuTarget.parity"
                    @change="(e) => emit('update:gatewayOptions', { rtuTarget: { ...gatewayOptions.rtuTarget, parity: (e.target as HTMLSelectElement).value as any } })"
                    :disabled="isConnected"
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
              <div class="base-switch" v-if="!hideProtocolSwitch">
                <button
                  :class="{ active: modbusMode === 'rtu' }"
                  :disabled="isConnected"
                  @click="emit('change-modbus-mode', 'rtu')"
                >
                  RTU
                </button>
                <button
                  :class="{ active: modbusMode === 'tcp' }"
                  :disabled="isConnected"
                  @click="emit('change-modbus-mode', 'tcp')"
                >
                  TCP
                </button>
              </div>

              <!-- 本地 RTU 模式：显示串口参数 -->
              <template v-if="modbusMode === 'rtu' || hideProtocolSwitch">
                <select 
                  :value="serialConfig.baudRate" 
                  @change="(e) => emit('update:serialConfig', { baudRate: Number((e.target as HTMLSelectElement).value) })" 
                  :disabled="isConnected"
                >
                  <option v-for="rate in baudRateOptions" :key="rate" :value="rate">
                    {{ rate }} bps
                  </option>
                </select>

                <select 
                  :value="serialConfig.dataBits" 
                  @change="(e) => emit('update:serialConfig', { dataBits: Number((e.target as HTMLSelectElement).value) })" 
                  :disabled="isConnected"
                >
                  <option :value="7">7 数据位</option>
                  <option :value="8">8 数据位</option>
                </select>

                <select 
                  :value="serialConfig.stopBits" 
                  @change="(e) => emit('update:serialConfig', { stopBits: Number((e.target as HTMLSelectElement).value) })" 
                  :disabled="isConnected"
                >
                  <option :value="1">1 停止位</option>
                  <option :value="2">2 停止位</option>
                </select>

                <select 
                  :value="serialConfig.parity" 
                  @change="(e) => emit('update:serialConfig', { parity: (e.target as HTMLSelectElement).value as any })" 
                  :disabled="isConnected"
                >
                  <option value="none">无校验</option>
                  <option value="even">偶校验</option>
                  <option value="odd">奇校验</option>
                </select>
              </template>

              <!-- 本地 TCP 模式：显示桥接端点 -->
              <template v-else>
                <div class="ch-flex-group-sm">
                  <input
                    type="text"
                    v-model="tcpEndpoint"
                    :disabled="isConnected"
                    placeholder="127.0.0.1:502 (TCP 桥接)"
                    class="ch-input-flex"
                  />
                </div>
              </template>
            </div>

            <!-- MQTT 模式：Broker 连接状态条 -->
            <div v-if="connectionType === 'mqtt' && showBrokerControl !== false" class="broker-status-bar">
              <button
                class="btn-broker"
                :class="{ connected: isMqttBrokerConnected }"
                :disabled="isMqttBrokerConnecting || isConnected"
                @click="isMqttBrokerConnected ? emit('disconnect-broker') : emit('connect-broker')"
              >
                {{ isMqttBrokerConnected ? '断开 Broker' : '连接 Broker' }}
              </button>
            </div>

            <button 
              :class="[
                'btn-connect',
                { 'ch-connect-btn-mqtt': connectionType === 'mqtt' },
                { connected: isConnected, connecting: isConnecting }
              ]"
              :disabled="isConnecting || (!isSupported && connectionType === 'serial') || (connectionType === 'mqtt' && !isMqttBrokerConnected && !isConnected)"
              @click="isConnected ? emit('disconnect') : emit('connect')"
            >
              <span v-if="isConnecting" class="spinner" style="width: 12px; height: 12px; border-width: 2px;"></span>
              {{ isConnected ? ('断开') : (connectBtnLabel || '连接网关') }}
            </button>

            <!-- 供额外按钮或提示的插槽 -->
            <slot name="extra-actions" />

            <!-- 本地 TCP 提示：放在连接按钮后 -->
            <div 
              v-if="connectionType !== 'mqtt' && modbusMode === 'tcp' && !hideProtocolSwitch"
              class="help-icon ch-help-icon-wrap"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;" class="info-svg text-gray-400 hover:text-indigo-500 cursor-help transition-colors">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <div class="tooltip" style="background-color: #fff9c4 !important; color: #333333 !important; white-space: nowrap !important; bottom: 125% !important; padding: 10px !important; border: 1px solid #ddd !important; border-radius: 4px !important; box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important;">
                提示：本地 TCP 模式需要运行桥接软件 (Local Bridge) 才能直接访问本地设备的 502 端口。
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="connectionType === 'serial' && !isSecure" class="error-banner">
        ❌ 检测到非安全上下文。Web Serial API 需要 <strong>HTTPS</strong> 或 <strong>localhost</strong>。不允许使用 IP 地址访问。
      </div>
      <div v-else-if="connectionType === 'serial' && !isSupported" class="warning-banner">
        ⚠️ 当前浏览器不支持 Web Serial API。
      </div>
    </section>
</template>

<style>
@import './connection-header.css';
</style>
