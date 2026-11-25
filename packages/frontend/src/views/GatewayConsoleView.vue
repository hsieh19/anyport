<script setup lang="ts">
import './gateway/styles/gateway-console.css';
import { useGatewayConsole } from './gateway/composables/useGatewayConsole';
import GatewayTopbar from './gateway/components/GatewayTopbar.vue';
import GatewayNetworkTab from './gateway/components/GatewayNetworkTab.vue';
import GatewayModeTab from './gateway/components/GatewayModeTab.vue';
import GatewayOtaTab from './gateway/components/GatewayOtaTab.vue';
import GatewayDialogs from './gateway/components/GatewayDialogs.vue';

const ctx = useGatewayConsole();
</script>

<template>
  <div class="gw-console">
    <!-- 1. 顶部全局硬件与连接遥测栏 -->
    <GatewayTopbar :ctx="ctx" />

    <!-- 2. 一级导航栏 -->
    <div class="main-nav">
      <button
        class="main-tab-btn"
        :class="{ active: ctx.mainTab.value === 'network' }"
        @click="ctx.mainTab.value = 'network'"
      >
        🌐 基础与端口配置
      </button>
      <button
        class="main-tab-btn"
        :class="{ active: ctx.mainTab.value === 'mode' }"
        @click="ctx.mainTab.value = 'mode'"
      >
        ⚡ 业务工作模式
      </button>
      <button
        class="main-tab-btn"
        :class="{ active: ctx.mainTab.value === 'ota' }"
        @click="ctx.mainTab.value = 'ota'"
      >
        🚀 固件维护与 OTA
      </button>
    </div>

    <!-- 主面板 1: 基础与端口配置 -->
    <GatewayNetworkTab :ctx="ctx" />

    <!-- 主面板 2: 业务工作模式配置 -->
    <GatewayModeTab :ctx="ctx" />

    <!-- 主面板 3: 固件维护与 OTA -->
    <GatewayOtaTab :ctx="ctx" />

    <!-- 3. 底部全量保存按钮 -->
    <button class="btn-save-main" :disabled="ctx.isRebooting.value" @click="ctx.saveConfig">
      {{ ctx.isRebooting.value ? '⏳ 网关正在重启并获取网络 IP，请稍候...' : '保存全量配置并重启网关' }}
    </button>

    <!-- 4. DHCP 新 IP 上报弹窗 & 全局状态诊断弹窗 -->
    <GatewayDialogs :ctx="ctx" />

    <!-- Toast -->
    <div
      v-if="ctx.toastState.show"
      class="gw-toast"
      :style="{ background: ctx.toastState.ok ? '#10b981' : '#ef4444' }"
    >
      {{ ctx.toastState.msg }}
    </div>
  </div>
</template>
