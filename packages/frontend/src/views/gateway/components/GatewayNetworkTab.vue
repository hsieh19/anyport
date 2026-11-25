<script setup lang="ts">
import { BAUD_RATES } from '../types';
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div v-show="ctx.mainTab.value === 'network'">
    <div class="sub-nav-row">
      <div class="sub-nav">
        <button
          class="sub-tab-btn"
          :class="{ active: ctx.netTab.value === 'wifi' }"
          @click="ctx.netTab.value = 'wifi'"
        >
          📶 WiFi 无线网络
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: ctx.netTab.value === 'w5500' }"
          @click="ctx.netTab.value = 'w5500'"
        >
          🔌 W5500 硬以太网
        </button>
        <button
          class="sub-tab-btn"
          :class="{ active: ctx.netTab.value === 'rs485' }"
          @click="ctx.netTab.value = 'rs485'"
        >
          🎛️ RS485 端口参数
        </button>
      </div>

      <div class="gw-name-box">
        <label>🏷️ 网关设备名称:</label>
        <input v-model="ctx.form.gatewayName" placeholder="AnyPort 网关" />
      </div>
    </div>

    <!-- WiFi 设置 -->
    <div v-show="ctx.netTab.value === 'wifi'" class="gw-card">
      <div class="gw-card-title">
        <span>WiFi 设置</span>
        <span class="title-hint">局域网 STA / AP 配网</span>
      </div>
      <div
        v-if="
          ctx.isOnline.value &&
          ctx.sysStatus.wifiConnected &&
          ctx.sysStatus.wifiIp &&
          ctx.sysStatus.wifiIp !== '0.0.0.0' &&
          ctx.sysStatus.wifiIp !== '192.168.4.1'
        "
        class="notice-box"
        style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px"
      >
        <div>
          🎉 <b>网关已成功接入 WiFi 局域网！</b>当前分配到的 IP 地址为：
          <b style="color: #10b981; font-size: 15px; font-family: Consolas, monospace">
            {{ ctx.sysStatus.wifiIp }}
          </b>
          <span style="color: var(--color-text-secondary); margin-left: 8px">
            (掩码: {{ ctx.sysStatus.wifiMask || '255.255.255.0' }} · 网关: {{ ctx.sysStatus.wifiGw || '--' }})
          </span>
        </div>
        <button
          v-if="ctx.gwHost.value.trim() !== ctx.sysStatus.wifiIp"
          class="btn-sm btn-success"
          @click="
            ctx.dhcpReportModal.wifiIp = ctx.sysStatus.wifiIp;
            ctx.applyReportedWifiIp(false);
          "
        >
          📋 复制并填入顶部网关地址 ({{ ctx.sysStatus.wifiIp }})
        </button>
      </div>
      <div class="grid-4" style="margin-bottom: 12px">
        <div class="form-item">
          <label>SSID 名称</label>
          <input v-model="ctx.form.wifi.ssid" placeholder="路由器无线网络名称" />
        </div>
        <div class="form-item">
          <label>WiFi 密码</label>
          <input v-model="ctx.form.wifi.password" type="password" placeholder="********" />
        </div>
        <div class="form-item">
          <label>IP 分配方式</label>
          <select v-model="ctx.form.wifiIpMode">
            <option value="dhcp">DHCP (自动获取)</option>
            <option value="static">静态 IP (手动指定)</option>
          </select>
        </div>
      </div>
      <div class="gw-card-subtitle">
        <span>IP 地址与网络参数</span>
        <span :style="{ color: ctx.form.wifiIpMode === 'dhcp' ? '#0ea5e9' : '#10b981' }">
          {{ ctx.form.wifiIpMode === 'dhcp' ? '实时读取自硬件当前网络 (只读)' : '已启用静态 IP 手动配置' }}
        </span>
      </div>
      <div class="grid-4">
        <div class="form-item">
          <label>IP 地址</label>
          <input v-model="ctx.form.wifi.ip" :readonly="ctx.form.wifiIpMode === 'dhcp'" placeholder="例如 192.168.1.150" />
        </div>
        <div class="form-item">
          <label>子网掩码</label>
          <input v-model="ctx.form.wifi.mask" :readonly="ctx.form.wifiIpMode === 'dhcp'" placeholder="255.255.255.0" />
        </div>
        <div class="form-item">
          <label>默认网关</label>
          <input v-model="ctx.form.wifi.gateway" :readonly="ctx.form.wifiIpMode === 'dhcp'" placeholder="192.168.1.1" />
        </div>
        <div class="form-item">
          <label>DNS 服务器</label>
          <input v-model="ctx.form.wifi.dns" :readonly="ctx.form.wifiIpMode === 'dhcp'" placeholder="8.8.8.8" />
        </div>
      </div>
    </div>

    <!-- W5500 以太网 -->
    <div v-show="ctx.netTab.value === 'w5500'" class="gw-card">
      <div class="gw-card-title">
        <span>W5500 硬以太网配置</span>
        <span class="title-hint">SPI 高速工业以太网 (全留空则不启用静态 IP)</span>
      </div>
      <div class="grid-4">
        <div class="form-item"><label>IP 地址</label><input v-model="ctx.form.eth.ip" placeholder="192.168.1.200" /></div>
        <div class="form-item"><label>子网掩码</label><input v-model="ctx.form.eth.mask" placeholder="255.255.255.0" /></div>
        <div class="form-item"><label>默认网关</label><input v-model="ctx.form.eth.gateway" placeholder="192.168.1.1" /></div>
        <div class="form-item"><label>DNS 服务器</label><input v-model="ctx.form.eth.dns" placeholder="8.8.8.8" /></div>
      </div>
    </div>

    <!-- RS485 全局端口配置 -->
    <div v-show="ctx.netTab.value === 'rs485'">
      <div class="notice-box notice-info">
        💡 <b>全局端口参数说明：</b>485-1 与 485-2 的物理通信参数在此全局定义。业务工作模式将直接复用此处设定的波特率与校验位，无需在各模式中重复配置。
      </div>

      <div class="gw-card">
        <div class="gw-card-title">
          <span>485-1 物理端口参数 (主站侧端子 · GPIO 2/3)</span>
          <span class="title-hint">J1 接口 · 硬件 UART1/UART0 复用</span>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>波特率 (Baud Rate)</label>
            <select v-model.number="ctx.form.rs485_1.baud">
              <option v-for="b in BAUD_RATES" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-item">
            <label>数据位 (Data Bits)</label>
            <select v-model.number="ctx.form.rs485_1.dataBits">
              <option :value="8">8</option>
              <option :value="7">7</option>
            </select>
          </div>
          <div class="form-item">
            <label>校验位 (Parity)</label>
            <select v-model.number="ctx.form.rs485_1.parity">
              <option :value="0">无 (None)</option>
              <option :value="1">偶校验 (Even)</option>
              <option :value="2">奇校验 (Odd)</option>
            </select>
          </div>
          <div class="form-item">
            <label>停止位 (Stop Bits)</label>
            <select v-model.number="ctx.form.rs485_1.stopBits">
              <option :value="1">1</option>
              <option :value="2">2</option>
            </select>
          </div>
        </div>
      </div>

      <div class="gw-card">
        <div class="gw-card-title">
          <span>485-2 物理端口参数 (从站侧端子 · GPIO 5/4)</span>
          <span class="title-hint">J3 接口 · 硬件 UART1 复用</span>
        </div>
        <div class="grid-4">
          <div class="form-item">
            <label>波特率 (Baud Rate)</label>
            <select v-model.number="ctx.form.rs485_2.baud">
              <option v-for="b in BAUD_RATES" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-item">
            <label>数据位 (Data Bits)</label>
            <select v-model.number="ctx.form.rs485_2.dataBits">
              <option :value="8">8</option>
              <option :value="7">7</option>
            </select>
          </div>
          <div class="form-item">
            <label>校验位 (Parity)</label>
            <select v-model.number="ctx.form.rs485_2.parity">
              <option :value="0">无 (None)</option>
              <option :value="1">偶校验 (Even)</option>
              <option :value="2">奇校验 (Odd)</option>
            </select>
          </div>
          <div class="form-item">
            <label>停止位 (Stop Bits)</label>
            <select v-model.number="ctx.form.rs485_2.stopBits">
              <option :value="1">1</option>
              <option :value="2">2</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
