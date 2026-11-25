<script setup lang="ts">
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div v-show="ctx.mainTab.value === 'ota'">
    <div class="gw-card">
      <div class="gw-card-title">
        <span>🚀 远程固件更新 (OTA) 与分区容灾</span>
        <span class="title-hint">
          <template v-if="ctx.isOnline.value">
            当前运行: <b style="color: #10b981">v{{ ctx.sysStatus.version }}</b>
            · 备用分区:
            <b :style="{ color: ctx.otaCanRollback.value && ctx.otaBackupVersion.value ? '#38bdf8' : 'var(--color-text-secondary)' }">
              {{ ctx.otaCanRollback.value && ctx.otaBackupVersion.value ? `v${ctx.otaBackupVersion.value}` : '无可用备份' }}
            </b>
          </template>
          <template v-else>ESP32 双 OTA 分区安全升级</template>
        </span>
      </div>
      <div class="notice-box notice-info">
        🛡️ <b>双分区容灾机制：</b>网关内置 A/B 两个独立固件分区。OTA 升级将写入备用分区；若升级后出现异常，随时可点击一键回滚恢复到上一个稳定固件。
      </div>
      <div class="grid-2" style="margin-bottom: 12px">
        <div class="form-item">
          <label>OTA 更新服务地址 (Base URL)</label>
          <input v-model="ctx.form.otaApi" placeholder="https://your-firmware-worker.workers.dev" />
        </div>
        <div class="form-item" style="display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap">
          <button class="btn-sm" @click="ctx.checkOta">检查固件更新</button>
          <button v-if="ctx.otaFound.value" class="btn-sm btn-success" @click="ctx.doOta">
            立即升级固件{{ ctx.otaVersion.value ? ` (v${ctx.otaVersion.value})` : '' }}
          </button>
          <button
            class="btn-sm btn-danger"
            :disabled="!ctx.isOnline.value || !ctx.otaCanRollback.value"
            :title="
              !ctx.isOnline.value
                ? '请先连接网关'
                : ctx.otaCanRollback.value
                  ? `回滚至备用分区固件 v${ctx.otaBackupVersion.value}`
                  : '当前网关备用分区暂无有效固件可回滚'
            "
            @click="ctx.doRollback"
          >
            {{
              ctx.otaCanRollback.value && ctx.otaBackupVersion.value
                ? `一键回滚备用固件 (v${ctx.otaBackupVersion.value})`
                : ctx.isOnline.value
                  ? '一键回滚备用固件 (无备用分区)'
                  : '一键回滚备用固件'
            }}
          </button>
        </div>
      </div>
      <div class="ota-msg" v-html="ctx.otaStatusHtml.value"></div>
      <div
        v-if="ctx.otaFound.value && ctx.otaChangelog.value"
        class="ota-changelog markdown-body"
        v-html="ctx.renderedOtaChangelog.value"
      ></div>
    </div>
  </div>
</template>
