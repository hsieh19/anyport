<script setup lang="ts">
import { MODE_NAMES } from '../types';
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <!-- DHCP 配网成功新 IP 上报弹窗 -->
  <Teleport to="body">
    <div
      v-if="ctx.dhcpReportModal.show"
      class="tel-overlay"
      @click.self="ctx.dhcpReportModal.show = false"
    >
      <div class="tel-modal" style="max-width: 520px">
        <div class="tel-modal-head">
          <span>🎉 网关已连入 WiFi · 新分配 IP 地址上报</span>
          <button class="tel-close" @click="ctx.dhcpReportModal.show = false">✕</button>
        </div>
        <div class="tel-body">
          <div class="tel-header-card" style="text-align: center; padding: 18px 16px">
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 6px">
              已接入无线网络 <b>{{ ctx.dhcpReportModal.ssid }}</b> · 路由器分配的局域网 IP：
            </div>
            <div
              style="
                font-size: 28px;
                font-weight: 800;
                color: #10b981;
                font-family: Consolas, Monaco, monospace;
                letter-spacing: 0.5px;
              "
            >
              {{ ctx.dhcpReportModal.wifiIp }}
            </div>
          </div>

          <div class="tel-dual-row" style="margin-top: 12px">
            <span>子网掩码: <b class="tel-cyan">{{ ctx.dhcpReportModal.wifiMask }}</b></span>
            <span>默认网关: <b class="tel-cyan">{{ ctx.dhcpReportModal.wifiGw }}</b></span>
            <span>DNS: <b class="tel-cyan">{{ ctx.dhcpReportModal.wifiDns }}</b></span>
          </div>

          <div style="margin-top: 14px; font-size: 12px; color: #94a3b8; line-height: 1.6">
            💡 <b>后续操作提示：</b>网关将在无客户端连接热点 3 分钟后自动关闭
            <code>anyport</code> 临时热点。您可以点击下方按钮将新 IP 填入顶部网关地址栏，然后将电脑切换回路由器局域网直接访问该 IP。
          </div>
        </div>
        <div class="tel-footer">
          <button class="btn-sm btn-secondary" @click="ctx.dhcpReportModal.show = false">
            保持当前连接
          </button>
          <button class="btn-sm btn-success" @click="ctx.applyReportedWifiIp(false)">
            📋 复制新 IP 并填入网关地址
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 全局状态诊断弹窗 -->
  <Teleport to="body">
    <div v-if="ctx.showTelemetryModal.value" class="tel-overlay" @click.self="ctx.showTelemetryModal.value = false">
      <div class="tel-modal">
        <div class="tel-modal-head">
          <span>📊 网关硬件状态与通讯延迟诊断</span>
          <button class="tel-close" @click="ctx.showTelemetryModal.value = false">✕</button>
        </div>
        <div class="tel-body">
          <div class="tel-header-card">
            <div class="tel-gw-row">
              <span class="tel-gw-name">
                {{ ctx.sysStatus.gatewayName }} ({{ MODE_NAMES[ctx.sysStatus.mode] || ctx.sysStatus.mode }})
              </span>
              <span class="tel-fw-badge">固件 {{ ctx.sysStatus.version }}</span>
            </div>
            <div class="tel-ip-row">
              WiFi IP: {{ ctx.sysStatus.wifiIp }} | ETH IP: {{ ctx.sysStatus.ethIp }} | 最新同步: {{ ctx.lastSyncTime.value }}
            </div>
          </div>

          <div class="tel-grid">
            <div class="tel-card">
              <div class="tel-label">📶 网络往返延迟</div>
              <div class="tel-val tel-emerald">
                <span>{{ ctx.netLatencyMs.value }}</span><span class="tel-unit">ms</span>
              </div>
              <div class="tel-tip">上位机至网关 HTTP 通信耗时</div>
            </div>
            <div class="tel-card">
              <div class="tel-label">⚡ RS485 总线应答延迟</div>
              <div class="tel-val tel-cyan">
                <span>{{ ctx.sysStatus.busLatencyMs }}</span><span class="tel-unit">ms</span>
              </div>
              <div class="tel-tip">网关与物理从站通信耗时</div>
            </div>

            <div class="tel-card tel-card-full">
              <div class="tel-label">
                🔄 {{ ctx.sysStatus.mode === 6 ? '双主站中继调度与错误统计' : `${MODE_NAMES[ctx.sysStatus.mode] || '总线'}通信吞吐与错误统计` }}
              </div>
              <div class="tel-dual-row">
                <span>
                  {{ ctx.sysStatus.mode === 6 ? '物理主站 (485-1)' : 'RS485 串口通道' }}:
                  <b class="tel-cyan">{{ ctx.sysStatus.master1Frames }}</b> 帧
                </span>
                <span>
                  {{ ctx.sysStatus.mode === 6 ? 'WiFi 主站 (Master 2)' : '网络通道 (TCP/MQTT)' }}:
                  <b class="tel-emerald">{{ ctx.sysStatus.master2Frames }}</b> 帧
                </span>
                <span>
                  CRC 错误:
                  <b :class="ctx.sysStatus.busCrcErrors > 0 ? 'tel-rose' : 'tel-emerald'">
                    {{ ctx.sysStatus.busCrcErrors }}
                  </b>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="tel-footer">
          <button class="btn-tel-retest" :disabled="ctx.isRetestingTel.value" @click="ctx.retestTelemetry">
            {{ ctx.isRetestingTel.value ? '⏳ 正在检测...' : '🔄 重新检测网关' }}
          </button>
          <button class="btn-sm" @click="ctx.showTelemetryModal.value = false">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
