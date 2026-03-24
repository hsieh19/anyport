<script setup lang="ts">
import { useModbusLogs } from './composables/useModbusLogs';
import { interpretFrame } from './utils/parser';
import { useDeviceStore } from '@/stores/deviceStore';
import type { useModbusState } from './composables/useModbusState';
import type { useModbusActions } from './composables/useModbusActions';

const props = defineProps<{
  state: ReturnType<typeof useModbusState>;
  actions: ReturnType<typeof useModbusActions>;
}>();

const deviceStore = useDeviceStore();

const {
  logs,
  clearLogs,
  displayFormat,
  latestReadResults,
  formatTime
} = useModbusLogs(props.state);

</script>

<template>
  <div class="monitor-grid">
    <!-- 左侧：通信日志 -->
    <section class="panel-section log-section">
      <div class="section-header flex justify-between items-center mb-2">
        <h2 class="section-title">
          <span class="icon">📋</span>
          通信日志
        </h2>
        <button class="btn-clear text-xs text-gray-400 hover:text-red-400" @click="clearLogs">清空</button>
      </div>
      
      <div class="log-container">
        <div 
          v-for="log in logs" 
          :key="log.id" 
          class="log-entry"
          :class="[log.direction]"
        >
          <!-- ✅ Ping 结果日志 -->
          <template v-if="log.pingResult">
            <div class="log-meta">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <div class="log-tag-group">
                <span class="log-tag ping-tag" :class="log.pingResult.success ? 'ping-ok' : 'ping-fail'">PING</span>
              </div>
            </div>
            <div class="log-content">
              <div class="log-hex ping-result-text">
                <span class="ping-target">{{ log.pingResult.ip }}:{{ log.pingResult.port }}</span>
                <span v-if="log.pingResult.success" class="ping-success">
                  — 连接成功, 延迟 {{ log.pingResult.latency }}ms
                </span>
                <span v-else class="ping-failure">
                  — {{ 
                    log.pingResult.error === 'host_unreachable' ? '主机不可达' : 
                    log.pingResult.error === 'port_refused' ? '端口被拒绝' : 
                    log.pingResult.error === 'socket_error' ? 'W5500 Socket 异常' :
                    log.pingResult.error === 'eth_link_down' ? '以太网链路断开' :
                    log.pingResult.error || '连接失败' 
                  }}
                  <template v-if="log.pingResult.latency">({{ log.pingResult.latency }}ms)</template>
                </span>
                <span class="ping-seq">(seq={{ log.pingResult.seq }})</span>
                <span v-if="log.pingResult.localIp" class="ping-diag">[W5500: {{ log.pingResult.localIp }}, Link: {{ log.pingResult.link }}]</span>
              </div>
            </div>
          </template>
          <!-- ✅ Modbus 常规日志 -->
          <template v-else>
            <div class="log-meta">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <div class="log-tag-group">
                <span class="log-tag">{{ log.direction === 'tx' ? 'TX' : 'RX' }}</span>
                <div class="help-icon log-help">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="info-svg">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div class="tooltip rx-log-tooltip">
                    <div class="tooltip-title">报文结构解析</div>
                    <div class="tooltip-content">
                      <div v-for="part in interpretFrame(log.hex.split(' '), log.direction === 'rx', deviceStore.modbusMode as 'rtu' | 'tcp')" :key="part.name" class="tooltip-item">
                        <span class="p-name">{{ part.name }}:</span>
                        <span class="p-value">{{ part.value }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          <div class="log-content">
            <div class="log-hex">{{ log.hex }}</div>
            <div v-if="log.parsed?.registers" class="log-parsed">
              Reg: [{{ log.parsed.registers.join(', ') }}]
            </div>
            <div v-if="log.parsed?.coils" class="log-parsed">
              Coil: [{{ log.parsed.coils.map((c: boolean) => c ? '1' : '0').join('') }}]
            </div>
            <div v-if="log.parsed?.error" class="log-error">
              Err: {{ log.parsed.error }}
            </div>
          </div>
          </template>
        </div>
        
        <div v-if="logs.length === 0" class="log-empty text-center text-gray-500 py-4 opacity-50">
          暂无通信记录
        </div>
      </div>
    </section>

    <!-- 右侧：寄存器结果表格 -->
    <section class="panel-section results-section">
      <div class="section-header flex justify-between items-center mb-2">
        <h2 class="section-title">
          <span class="icon">📊</span>
          数据读取结果
          <div class="result-hint text-xs font-normal text-gray-400 ml-2" v-if="latestReadResults.length">
            ({{ latestReadResults.length }} 个点)
          </div>
        </h2>
        
        <div class="header-controls">
          <div class="format-switch flex gap-1 bg-slate-100/50 p-1 rounded-md">
            <button 
              class="px-2 py-1 text-xs rounded transition-colors"
              :class="{ 'bg-blue-500 text-white shadow': displayFormat === 'hex', 'text-gray-500 hover:text-gray-800 hover:bg-slate-200': displayFormat !== 'hex' }" 
              @click="displayFormat = 'hex'"
              title="十六进制"
            >HEX</button>
            <button 
              class="px-2 py-1 text-xs rounded transition-colors"
              :class="{ 'bg-blue-500 text-white shadow': displayFormat === 'dec', 'text-gray-500 hover:text-gray-800 hover:bg-slate-200': displayFormat !== 'dec' }" 
              @click="displayFormat = 'dec'"
              title="十进制"
            >DEC</button>
            <button 
              class="px-2 py-1 text-xs rounded transition-colors"
              :class="{ 'bg-blue-500 text-white shadow': displayFormat === 'bin', 'text-gray-500 hover:text-gray-800 hover:bg-slate-200': displayFormat !== 'bin' }" 
              @click="displayFormat = 'bin'"
              title="二进制"
            >BIN</button>
          </div>
        </div>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead class="bg-slate-50">
            <tr>
              <th width="60" class="py-2 text-xs text-gray-500">序号</th>
              <th width="100" class="py-2 text-xs text-gray-500 border-l border-r border-slate-200">寄存器地址</th>
              <th class="col-value-header py-2 text-xs text-gray-500">
                数值 
                <span class="format-indicator opacity-60">
                  ({{ displayFormat.toUpperCase() }})
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(item, idx) in latestReadResults" :key="idx">
              <!-- 正常数据行 -->
              <tr v-if="item.type === 'data' || !item.type" class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td class="col-index text-center py-2 text-gray-400">{{ item.index }}</td>
                <td class="col-addr text-center py-2 border-l border-r border-slate-100">{{ item.address }}</td>
                <td class="col-value centered text-center py-2 font-mono">
                  <div class="value-container flex items-center justify-center">
                    <div class="raw-value text-blue-500 font-bold">
                      <span v-if="displayFormat === 'dec'" class="val-dec">{{ item.decStr }}</span>
                      <span v-else-if="displayFormat === 'hex'" class="val-hex">{{ item.hexStr }}</span>
                      <span v-else-if="displayFormat === 'bin'" class="val-bin">{{ item.binStr }}</span>
                    </div>
                  </div>
                </td>
              </tr>
              
              <!-- 解析结果总结行 -->
              <tr v-else-if="item.type === 'summary'" class="summary-row bg-blue-50/50">
                <td colspan="3" class="py-2 border-b border-blue-100">
                  <div class="summary-content flex items-center justify-center gap-2 text-blue-600/80 text-sm font-medium">
                    <span class="summary-icon">💡</span>
                    <span class="summary-text">{{ item.text }}</span>
                  </div>
                </td>
              </tr>
            </template>

            <tr v-if="latestReadResults.length === 0">
              <td colspan="3" class="table-empty text-center py-8 text-gray-400 opacity-60">
                等待读取数据...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 核心布局依然由 modbus-ui.css 控制，但使用 Tailwind 辅助对齐 */
</style>
