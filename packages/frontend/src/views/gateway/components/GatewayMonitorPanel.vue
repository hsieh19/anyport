<script setup lang="ts">
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div v-show="ctx.form.workMode === 4" class="gw-card">
    <div class="gw-card-title">
      <span>📡 RS485 总线监听与通讯质量诊断</span>
      <span style="font-size: 12px; font-weight: normal; color: #10b981">
        🛡️ 纯被动高阻态只听不发 · 零总线冲突风险
      </span>
    </div>

    <!-- 顶部：过滤与操作控制栏 -->
    <div class="grid-4 monitor-toolbar">
      <div class="form-item">
        <label>过滤从站 ID (0 = 全部从站)</label>
        <input
          v-model.number="ctx.monitorFilter.filterSlaveId"
          type="number"
          min="0"
          max="247"
          @change="ctx.applyMonitorFilter"
        />
      </div>
      <div class="form-item">
        <label>过滤功能码</label>
        <select v-model.number="ctx.monitorFilter.filterFuncCode" @change="ctx.applyMonitorFilter">
          <option :value="0">0 - 全部功能码</option>
          <option :value="1">01 - 读线圈 (0x01)</option>
          <option :value="2">02 - 读离散输入 (0x02)</option>
          <option :value="3">03 - 读保持寄存器 (0x03)</option>
          <option :value="4">04 - 读输入寄存器 (0x04)</option>
          <option :value="5">05 - 写单个线圈 (0x05)</option>
          <option :value="6">06 - 写单个寄存器 (0x06)</option>
          <option :value="15">15 - 写多个线圈 (0x0F)</option>
          <option :value="16">16 - 写多个寄存器 (0x10)</option>
        </select>
      </div>
      <div class="form-item">
        <label>超时判定阈值 (ms, 100~5000)</label>
        <input
          v-model.number="ctx.monitorFilter.timeoutMs"
          type="number"
          min="100"
          max="5000"
          @change="ctx.applyMonitorFilter"
        />
      </div>
      <div class="form-item" style="display: flex; gap: 6px; align-items: center">
        <button
          class="btn-sm"
          :style="{ background: ctx.monitorAutoRefresh.value ? '#0284c7' : '#10b981' }"
          @click="ctx.monitorAutoRefresh.value = !ctx.monitorAutoRefresh.value"
        >
          {{ ctx.monitorAutoRefresh.value ? '⏸ 暂停实时刷新' : '▶ 恢复实时刷新' }}
        </button>
        <button class="btn-sm btn-secondary" @click="ctx.fetchMonitor(false)">刷新</button>
        <button class="btn-sm btn-danger" @click="ctx.clearMonitor">清空重置</button>
      </div>
    </div>

    <!-- 下方分栏：左下质量诊断指标 + 右下实时报文嗅探流 -->
    <div class="monitor-split">
      <div class="q-grid">
        <div class="q-card">
          <div class="q-head">
            <span class="q-label">🎯 主从应答成功率</span>
            <span class="q-sub">
              应答: {{ ctx.monitorStats.respCount }} / 请求: {{ ctx.monitorStats.reqCount }}
            </span>
          </div>
          <div class="q-val" :style="{ color: ctx.qualitySuccessRate.value.color }">
            {{ ctx.qualitySuccessRate.value.text }}
          </div>
        </div>
        <div class="q-card">
          <div class="q-head">
            <span class="q-label">⏱️ 从站响应耗时 (RTT)</span>
            <span class="q-sub">
              {{
                ctx.monitorStats.respCount > 0
                  ? `均值: ${ctx.monitorStats.avgRttMs} ms | 峰值: ${ctx.monitorStats.maxRttMs} ms`
                  : '均值: -- ms | 峰值: -- ms'
              }}
            </span>
          </div>
          <div class="q-val" style="color: #0284c7">
            {{ ctx.monitorStats.respCount > 0 ? `${ctx.monitorStats.lastRttMs} ms` : '-- ms' }}
          </div>
        </div>
        <div class="q-card">
          <div class="q-head">
            <span class="q-label">⚠️ 超时无应答 / 异常码</span>
            <span class="q-sub">Modbus 异常响应: {{ ctx.monitorStats.exceptionCount }}</span>
          </div>
          <div
            class="q-val"
            :style="{ color: ctx.monitorStats.timeoutCount > 0 ? '#f59e0b' : '#10b981' }"
          >
            {{ ctx.monitorStats.timeoutCount }}
          </div>
        </div>
        <div class="q-card">
          <div class="q-head">
            <span class="q-label">⚡ CRC 错帧 / 总捕获帧</span>
            <span class="q-sub">总线总物理帧: {{ ctx.monitorStats.totalFrames }}</span>
          </div>
          <div
            class="q-val"
            :style="{ color: ctx.monitorStats.crcErrorCount > 0 ? '#ef4444' : '#10b981' }"
          >
            {{ ctx.monitorStats.crcErrorCount }}
          </div>
        </div>
      </div>

      <div class="monitor-stream">
        <div :ref="(el) => (ctx.monitorBoxRef.value = el as HTMLDivElement | null)" class="monitor-box">
          <div v-if="ctx.monitorLogs.value.length === 0">暂无报文，等待总线数据...</div>
          <div v-for="(l, idx) in ctx.monitorLogs.value" :key="idx" class="log-row">
            <span class="log-ts">[{{ l.t }}ms]</span>
            <span v-if="l.meta === 2" class="tag-resp">
              RESP 从站应答{{ l.rtt ? ` · ${l.rtt}ms` : '' }}
            </span>
            <span v-else-if="l.meta === 3" class="tag-exc">
              EXC 异常应答{{ l.rtt ? ` · ${l.rtt}ms` : '' }}
            </span>
            <span v-else-if="l.meta === 4" class="tag-crc">CRC 校验错帧</span>
            <span v-else class="tag-req">REQ 主站请求</span>
            <span class="log-meta">
              [ID:{{ l.uid ?? 0 }} FC:0x{{ (l.fc ?? 0).toString(16).toUpperCase().padStart(2, '0') }}]
            </span>
            <span class="log-hex">{{ l.hex }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
