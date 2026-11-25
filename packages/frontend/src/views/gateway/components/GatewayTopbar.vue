<script setup lang="ts">
import { MODE_NAMES } from '../types';
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div class="topbar">
    <div class="topbar-header">
      <div class="brand-title">
        <span class="dot-status" :class="{ 'dot-online': ctx.isOnline.value }"></span>
        <span>{{ ctx.sysStatus.gatewayName }}</span>
        <span class="status-pill">
          {{ ctx.isOnline.value ? `v${ctx.sysStatus.version} · ${MODE_NAMES[ctx.sysStatus.mode] || ctx.sysStatus.mode}` : '未连接' }}
        </span>
        <span
          class="status-pill"
          :title="ctx.useBridgeProxy.value ? '通过本机 anyport-bridge (127.0.0.1:8081/proxy) 穿透访问局域网网关' : '浏览器直接访问局域网网关 HTTP API'"
        >
          {{ ctx.useBridgeProxy.value ? '🔗 Bridge代理' : '⚡ 局域网直连' }}
        </span>
      </div>

      <div class="topbar-conn">
        <select
          v-if="ctx.discoveredGatewayIps.value.length > 0"
          class="quick-ip-select"
          @change="ctx.onSelectDiscoveredGateway"
        >
          <option value="">⚡ 已发现网关快捷选择...</option>
          <option v-for="item in ctx.discoveredGatewayIps.value" :key="item.url" :value="item.url">
            {{ item.label }}
          </option>
        </select>

        <span class="conn-label">网关地址:</span>
        <div class="gw-addr-composite">
          <select v-model="ctx.gwProtocol.value" class="gw-proto-select">
            <option value="http://">http://</option>
            <option value="https://">https://</option>
          </select>
          <input
            v-model="ctx.gwHost.value"
            class="gw-host-input"
            placeholder="192.168.4.1 或 域名:端口"
            @keydown.enter="ctx.connectDevice"
          />
        </div>
        <button class="btn-primary" :disabled="ctx.isConnecting.value" @click="ctx.connectDevice">
          {{ ctx.isConnecting.value ? '连接中...' : '连接 / 刷新' }}
        </button>
        <button class="btn-diag" @click="ctx.openTelemetry">📊 状态诊断</button>
      </div>
    </div>

    <div class="topbar-stats">
      <template v-if="ctx.isOnline.value">
        <span>模式: <b>{{ MODE_NAMES[ctx.sysStatus.mode] || ctx.sysStatus.mode }}</b></span>
        <span>485通道: <b>{{ ctx.activeChannelLabel.value }}</b></span>
        <span>
          WiFi: <b>{{ ctx.sysStatus.wifiIp }}</b>
          ({{ ctx.sysStatus.wifiConnected ? 'STA' : 'AP' }}{{ ctx.sysStatus.rssi ? ` · ${ctx.sysStatus.rssi}dBm` : '' }})
        </span>
        <span>
          以太网: <b>{{ ctx.sysStatus.ethIp }}</b>
          ({{ ctx.sysStatus.ethLink ? 'LinkUP' : 'NoLink' }})
        </span>
        <span>结温: <b>{{ ctx.sysStatus.chipTemp !== null ? `${ctx.sysStatus.chipTemp}℃` : '--' }}</b></span>
        <span>RAM/Flash: <b>{{ ctx.sysStatus.ram }}% / {{ ctx.sysStatus.flash }}%</b></span>
        <span>运行: <b>{{ ctx.formatUptime(ctx.sysStatus.uptime) }}</b></span>
      </template>
      <span v-else>正在等待连接网关设备 ({{ ctx.isHttpsPage ? 'HTTPS 模式已自动启用本地 Bridge 代理穿透' : '支持局域网直连或本地 Bridge 代理' }})...</span>
    </div>
  </div>
</template>
