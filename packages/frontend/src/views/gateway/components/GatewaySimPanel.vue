<script setup lang="ts">
import type { GatewayConsoleContext } from '../composables/useGatewayConsole';

defineProps<{
  ctx: GatewayConsoleContext;
}>();
</script>

<template>
  <div v-show="ctx.form.workMode === 1" class="gw-card">
    <div class="gw-card-title">
      <span>🧪 Modbus 从站模拟器</span>
      <span class="title-hint">串口参数已套用选定 485 通道的全局配置</span>
    </div>
    <div class="grid-4" style="margin-bottom: 10px">
      <div class="form-item">
        <label>RTU 从站使能</label>
        <select v-model="ctx.simConfig.rtuEnabled">
          <option :value="true">启用</option>
          <option :value="false">禁用</option>
        </select>
      </div>
      <div class="form-item">
        <label>RTU 从站 ID</label>
        <input v-model.number="ctx.simConfig.unitId" type="number" min="1" max="247" />
      </div>
    </div>
    <div class="grid-4">
      <div class="form-item">
        <label>TCP 从站使能</label>
        <select v-model="ctx.simConfig.tcpEnabled">
          <option :value="true">启用</option>
          <option :value="false">禁用</option>
        </select>
      </div>
      <div class="form-item">
        <label>TCP 从站 ID</label>
        <input v-model.number="ctx.simConfig.tcpUnitId" type="number" min="1" max="247" />
      </div>
      <div class="form-item">
        <label>TCP 监听端口</label>
        <input v-model.number="ctx.simConfig.tcpPort" type="number" min="1" max="65535" />
      </div>
      <div class="form-item">
        <label>网络链路</label>
        <select v-model.number="ctx.simConfig.netInterface">
          <option :value="0">自动 (WiFi + W5500)</option>
          <option :value="1">仅以太网 (W5500)</option>
          <option :value="2">仅 WiFi</option>
        </select>
      </div>
    </div>

    <div style="margin-top: 14px; display: flex; gap: 8px">
      <button class="btn-sm" @click="ctx.addRegRow">+ 新增寄存器</button>
      <button class="btn-sm btn-success" @click="ctx.saveSimAll">仅保存模拟器数据</button>
    </div>

    <div class="table-wrap">
      <table class="sim-table">
        <colgroup>
          <col style="width: 9%" />
          <col style="width: 13%" />
          <col style="width: 10.5%" />
          <col style="width: 8.5%" />
          <col style="width: 9.5%" />
          <col style="width: 9.5%" />
          <col style="width: 5%" />
          <col style="width: 12%" />
          <col style="width: 7.5%" />
          <col style="width: 8.5%" />
          <col style="width: 7%" />
        </colgroup>
        <thead>
          <tr>
            <th>地址</th>
            <th>名称</th>
            <th>类型</th>
            <th>字节序</th>
            <th>设定值</th>
            <th>当前值</th>
            <th>动态</th>
            <th>范围(min~max)</th>
            <th>周期(s)</th>
            <th>模式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(reg, idx) in ctx.simRegisters.value" :key="idx">
            <td><input v-model.number="reg.addr" type="number" /></td>
            <td><input v-model="reg.name" /></td>
            <td>
              <select v-model.number="reg.type" @change="ctx.onRegTypeChange(reg)">
                <option :value="0">INT16</option>
                <option :value="1">UINT16</option>
                <option :value="2">INT32</option>
                <option :value="3">UINT32</option>
                <option :value="4">FLOAT32</option>
                <option :value="6">BIT</option>
              </select>
            </td>
            <td>
              <select v-model.number="reg.endian" :disabled="!ctx.is32BitType(reg.type)">
                <option :value="0">ABCD</option>
                <option :value="1">DCBA</option>
                <option :value="2">BADC</option>
                <option :value="3">CDAB</option>
              </select>
            </td>
            <td><input v-model.number="reg.targetVal" type="number" step="any" /></td>
            <td><input :value="reg.val" type="number" step="any" readonly /></td>
            <td><input v-model="reg.isDyn" type="checkbox" /></td>
            <td><input v-model="reg.range" :disabled="!reg.isDyn" /></td>
            <td><input v-model.number="reg.dynInterval" type="number" :disabled="!reg.isDyn" /></td>
            <td>
              <select v-model.number="reg.dynMode" :disabled="!reg.isDyn">
                <option :value="0">随机</option>
                <option :value="1">递增</option>
                <option :value="2">递减</option>
              </select>
            </td>
            <td>
              <button class="btn-sm btn-danger" @click="ctx.removeRegRow(idx)">删</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
