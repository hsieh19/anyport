<script setup lang="ts">
import { MODE_DESCS } from '../types';
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';
import GatewaySimPanel from './GatewaySimPanel.vue';
import GatewayMonitorPanel from './GatewayMonitorPanel.vue';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div v-show="ctx.mainTab.value === 'mode'">
    <div class="mode-header-card">
      <div class="header-grid">
        <div class="form-item">
          <label class="mode-top-label">当前工作模式:</label>
          <select v-model.number="ctx.form.workMode">
            <option :value="0">0 - MQTT 网关模式 (工业总线上云)</option>
            <option :value="1">1 - 从站模拟器模式 (现场联调)</option>
            <option :value="2">2 - USB 转 RS485 透传模式 (串口调试)</option>
            <option :value="3">3 - Modbus 协议互转模式 (TCP ↔ RTU)</option>
            <option :value="4">4 - 总线监听与质量诊断 (被动嗅探)</option>
            <option :value="5">5 - 以太网-WiFi 桥接模式 (网段中转)</option>
            <option :value="6">6 - 双主站中继网关模式 (硬件防碰撞)</option>
          </select>
        </div>
        <div class="form-item">
          <label class="mode-top-label">生效 RS485 物理通道:</label>
          <select
            v-model.number="ctx.form.rs485Channel"
            :disabled="ctx.form.workMode === 5 || ctx.form.workMode === 6"
          >
            <option :value="0">485-1 (主站侧端子 GPIO 2/3)</option>
            <option :value="1">485-2 (从站侧端子 GPIO 5/4)</option>
          </select>
        </div>
      </div>
      <div class="mode-desc-text">
        <template v-if="ctx.form.workMode === 6">
          <b>双主站模式：</b>两路 485 全部启用 (485-1 接主站，485-2 接从站)，无需选择单通道。
        </template>
        <template v-else-if="ctx.form.workMode === 5">
          <b>跨网段桥接模式：</b>纯网络介质（WiFi ↔ W5500 硬以太网）数据中转，不占用 RS485 串口通道。
        </template>
        <template v-else>
          {{ MODE_DESCS[ctx.form.workMode] }}
        </template>
      </div>
    </div>

    <!-- 模式 0: MQTT 网关 -->
    <div v-show="ctx.form.workMode === 0" class="gw-card">
      <div class="gw-card-title">
        <span>☁️ MQTT 平台接入参数</span>
        <span
          class="mqtt-status-badge"
          :class="`is-${ctx.mqttBrokerStatus.value.state}`"
          :title="ctx.mqttBrokerStatus.value.detail"
        >
          <span class="mqtt-status-dot"></span>
          <span>{{ ctx.mqttBrokerStatus.value.text }}</span>
        </span>
      </div>
      <div class="sync-bar">
        <span style="font-weight: 600">⚡ 远端提取:</span>
        <input
          v-model="ctx.syncCode.value"
          placeholder="输入 6 位提取码"
          @keydown.enter="ctx.doCloudSync"
        />
        <button :disabled="ctx.syncLoading.value" @click="ctx.doCloudSync">一键拉取并填入</button>
        <span v-if="ctx.syncMsg.value" :style="{ color: ctx.syncOk.value ? '#10b981' : '#ef4444', fontSize: '12px' }">
          {{ ctx.syncMsg.value }}
        </span>
      </div>
      <div class="grid-4" style="margin-bottom: 8px">
        <div class="form-item"><label>Broker 主机</label><input v-model="ctx.form.mqtt.host" /></div>
        <div class="form-item"><label>端口</label><input v-model.number="ctx.form.mqtt.port" type="number" /></div>
        <div class="form-item"><label>WebSocket 路径</label><input v-model="ctx.form.mqtt.path" /></div>
        <div class="form-item"><label>Topic 前缀</label><input v-model="ctx.form.mqtt.topicPrefix" /></div>
      </div>
      <div class="grid-4">
        <div class="form-item"><label>用户名</label><input v-model="ctx.form.mqtt.username" /></div>
        <div class="form-item"><label>密码</label><input v-model="ctx.form.mqtt.password" type="password" placeholder="********" /></div>
        <div class="form-item"><label>Site ID</label><input v-model="ctx.form.mqtt.siteId" /></div>
        <div class="form-item"><label>Gateway ID</label><input v-model="ctx.form.mqtt.gatewayId" /></div>
      </div>
    </div>

    <!-- 模式 1: 从站模拟器 -->
    <GatewaySimPanel :ctx="ctx" />

    <!-- 模式 2: USB 透传 -->
    <div v-show="ctx.form.workMode === 2" class="gw-card">
      <div class="gw-card-title"><span>🔌 USB 转 RS485 高速透传</span></div>
      <div class="notice-box notice-info">
        ⚡ <b>全速硬件透传已就绪：</b>网关将把 USB 虚拟串口的数据透明转发至所选的 RS485 通道。串口通信波特率、数据位、校验位与停止位均由基础设置中选定通道的参数统一控制。
      </div>
    </div>

    <!-- 模式 3: 协议互转 -->
    <div v-show="ctx.form.workMode === 3" class="gw-card">
      <div class="gw-card-title">
        <span>🔄 Modbus TCP / RTU 协议互转</span>
        <span class="title-hint">RTU 串口参数由全局 485 统一提供</span>
      </div>
      <div class="notice-box notice-info font-mono" style="margin-bottom: 12px">
        <template v-if="ctx.form.bridge.direction === 0">
          <b>当前流向 (TCP → RTU · 网关作为 TCP Server)：</b><br />
          💻 上位机 / 网络 TCP 主站 ──(Modbus TCP)──▶ <b>[ 🌐 网关本地监听端口 ]</b> ──(Modbus RTU)──▶ 🔌 RS485 串口从站
        </template>
        <template v-else>
          <b>当前流向 (RTU → TCP · 网关作为 TCP Client)：</b><br />
          🎛️ PLC / RS485 串口主站 ──(Modbus RTU)──▶ <b>[ 🔌 网关 RS485 端口 ]</b> ──(Modbus TCP)──▶ <b>[ 🌐 远端目标从站 IP : 端口 ]</b>
        </template>
      </div>
      <div class="grid-4" style="margin-bottom: 10px">
        <div class="form-item">
          <label>转换方向 (数据流向)</label>
          <select v-model.number="ctx.form.bridge.direction">
            <option :value="0">TCP → RTU (网络主站访串口从站)</option>
            <option :value="1">RTU → TCP (串口主站访网络从站)</option>
          </select>
        </div>
        <div class="form-item">
          <label>寻址模式</label>
          <select v-model.number="ctx.form.bridge.mode">
            <option :value="0">总线级 (按报头 ID 透传)</option>
            <option :value="1">单设备固定从站 ID</option>
          </select>
        </div>
        <div class="form-item">
          <label>固定从站 ID (单设备模式)</label>
          <input
            v-model.number="ctx.form.bridge.slaveId"
            type="number"
            min="1"
            max="247"
            :disabled="ctx.form.bridge.mode !== 1"
          />
        </div>
      </div>
      <div class="grid-4">
        <div class="form-item">
          <label>网络链路</label>
          <select v-model.number="ctx.form.bridge.netInterface">
            <option :value="0">自动 (WiFi + W5500)</option>
            <option :value="1">仅以太网 (W5500)</option>
            <option :value="2">仅 WiFi</option>
          </select>
        </div>
        <div class="form-item">
          <label :class="{ 'muted-label': ctx.form.bridge.direction === 1 }">
            网关本地监听端口 (TCP→RTU 生效)
          </label>
          <input
            v-model.number="ctx.form.bridge.tcpPort"
            type="number"
            min="1"
            max="65535"
            :disabled="ctx.form.bridge.direction === 1"
          />
        </div>
        <div class="form-item">
          <label :class="{ 'muted-label': ctx.form.bridge.direction === 0 }">
            远端目标从站 IP (RTU→TCP 生效)
          </label>
          <input
            v-model="ctx.form.bridge.targetIp"
            placeholder="例如 192.168.1.100"
            :disabled="ctx.form.bridge.direction === 0"
          />
        </div>
        <div class="form-item">
          <label :class="{ 'muted-label': ctx.form.bridge.direction === 0 }">
            远端目标从站端口 (RTU→TCP 生效)
          </label>
          <input
            v-model.number="ctx.form.bridge.targetPort"
            type="number"
            min="1"
            max="65535"
            :disabled="ctx.form.bridge.direction === 0"
          />
        </div>
      </div>
    </div>

    <!-- 模式 4: 总线监听与质量诊断 -->
    <GatewayMonitorPanel :ctx="ctx" />

    <!-- 模式 5: 以太网-WiFi 桥接 -->
    <div v-show="ctx.form.workMode === 5" class="gw-card">
      <div class="gw-card-title">
        <span>🌉 以太网 ↔ WiFi 跨网段数据桥接</span>
        <span class="title-hint">支持 TCP / UDP 跨物理网卡双向透明转发</span>
      </div>
      <div class="notice-box notice-info font-mono" style="margin-bottom: 12px">
        <template v-if="ctx.form.ethWifi.direction === 0">
          <b>当前流向 (WiFi → W5500 以太网 · {{ ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }} 无线访问有线内网)：</b><br />
          💻 WiFi 上位机 / 客户端 ──({{ ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }})──▶ <b>[ 📶 网关 WiFi 监听端口 ]</b> ──(跨网段双向转发)──▶ <b>[ 🔌 W5500 有线网段目标 IP : 端口 ]</b>
        </template>
        <template v-else>
          <b>当前流向 (W5500 以太网 → WiFi · {{ ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }} 有线访问无线网段)：</b><br />
          🔌 有线网段主站 / 客户端 ──({{ ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP' }})──▶ <b>[ 🌐 网关 W5500 监听端口 ]</b> ──(跨网段双向转发)──▶ <b>[ 📶 WiFi 无线网段目标 IP : 端口 ]</b>
        </template>
      </div>
      <div class="grid-4" style="margin-bottom: 10px">
        <div class="form-item">
          <label>桥接方向 (数据流向)</label>
          <select v-model.number="ctx.form.ethWifi.direction">
            <option :value="0">WiFi → W5500 (无线访有线设备)</option>
            <option :value="1">W5500 → WiFi (有线访无线设备)</option>
          </select>
        </div>
        <div class="form-item">
          <label>传输层协议</label>
          <select v-model.number="ctx.form.ethWifi.protocol">
            <option :value="0">TCP 协议 (面向连接可靠流)</option>
            <option :value="1">UDP 协议 (无连接高速报文)</option>
          </select>
        </div>
      </div>
      <div class="grid-4">
        <div class="form-item">
          <label>
            {{
              ctx.form.ethWifi.direction === 1
                ? `网关 W5500 监听 ${ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (有线入口)`
                : `网关 WiFi 监听 ${ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (无线入口)`
            }}
          </label>
          <input v-model.number="ctx.form.ethWifi.listenPort" type="number" min="1" max="65535" />
        </div>
        <div class="form-item">
          <label>
            {{
              ctx.form.ethWifi.direction === 1
                ? '无线网段目标 IP (WiFi 侧出口)'
                : '有线网段目标 IP (W5500 侧出口)'
            }}
          </label>
          <input v-model="ctx.form.ethWifi.targetIp" placeholder="例如 192.168.1.100" />
        </div>
        <div class="form-item">
          <label>
            {{
              ctx.form.ethWifi.direction === 1
                ? `无线网段目标 ${ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (WiFi 侧)`
                : `有线网段目标 ${ctx.form.ethWifi.protocol === 1 ? 'UDP' : 'TCP'} 端口 (W5500 侧)`
            }}
          </label>
          <input v-model.number="ctx.form.ethWifi.targetPort" type="number" min="1" max="65535" />
        </div>
      </div>
    </div>

    <!-- 模式 6: 双主站中继 -->
    <div v-show="ctx.form.workMode === 6" class="gw-card">
      <div class="gw-card-title">
        <span>⚡ 双主站防碰撞中继 (AnyControl 硬件复用模式)</span>
      </div>
      <div class="notice-box notice-info font-mono" style="margin-bottom: 12px">
        <template v-if="ctx.form.dualMaster.proxyMode === 0">
          <b>当前拓扑 (双主站总线代理 · 485-1 接原主站出口，485-2 接从站总线)：</b><br />
          🎛️ 原物理主站 + 💻 WiFi 主站 (:{{ ctx.form.dualMaster.wifiPort }}) ──(防碰撞仲裁)──▶ <b>[ 网关 485-2 ]</b> ──▶ 🔌 现场全部从站总线 (ID 1~247)
        </template>
        <template v-else>
          <b>当前拓扑 (双主站设备代理 · 485-1 并联挂公共总线，485-2 单接目标设备)：</b><br />
          🎛️ 原公共总线 (主站+其它从站) ──▶ <b>[ 网关 485-1 仅拦截 ID={{ ctx.form.dualMaster.slaveId }} ]</b> + 💻 WiFi 主站 ──▶ <b>[ 网关 485-2 ]</b> ──▶ 🎯 目标从站 (ID={{ ctx.form.dualMaster.slaveId }})
        </template>
      </div>
      <div class="grid-4" style="margin-bottom: 10px">
        <div class="form-item">
          <label>代理拓扑模式</label>
          <select v-model.number="ctx.form.dualMaster.proxyMode">
            <option :value="0">双主站总线代理 (代理整条从站总线)</option>
            <option :value="1">双主站设备代理 (仅代理指定从站 ID)</option>
          </select>
        </div>
        <div class="form-item">
          <label :class="{ 'muted-label': ctx.form.dualMaster.proxyMode !== 1 }">
            被代理从站 ID (设备代理生效)
          </label>
          <input
            v-model.number="ctx.form.dualMaster.slaveId"
            type="number"
            min="1"
            max="247"
            :disabled="ctx.form.dualMaster.proxyMode !== 1"
          />
        </div>
      </div>
      <div class="grid-4">
        <div class="form-item">
          <label>WiFi Modbus TCP 监听端口 (第 2 主站)</label>
          <input v-model.number="ctx.form.dualMaster.wifiPort" type="number" placeholder="默认 9502" />
        </div>
        <div class="form-item">
          <label>从站响应超时 (ms, 100~3000)</label>
          <input v-model.number="ctx.form.dualMaster.masterTimeout" type="number" min="100" max="3000" />
        </div>
        <div class="form-item">
          <label>心跳保活周期 (秒)</label>
          <input v-model.number="ctx.form.dualMaster.heartbeatInterval" type="number" min="5" max="86400" />
        </div>
      </div>
    </div>
  </div>
</template>
