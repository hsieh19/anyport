<script setup lang="ts">
import './styles/modbus-ui.css';
import { useModbusState } from './composables/useModbusState';
import { useModbusActions } from './composables/useModbusActions';

// 子组件
import ModbusHeader from './ModbusHeader.vue';
import ModbusControl from './ModbusControl.vue';
import ModbusMonitor from './ModbusMonitor.vue';

// 弹窗组件
import ModbusProfilePicker from '../ModbusProfilePicker.vue';
import MqttConfigDialog from '../MqttConfigDialog.vue';
import GatewayManagerDialog from '../GatewayManagerDialog.vue';

import { useModbusLogs } from './composables/useModbusLogs';

const state = useModbusState();
const { latestReadResults } = useModbusLogs(state);
const actions = useModbusActions(state, latestReadResults);
</script>

<template>
  <div class="modbus-panel">
    <!-- 弹窗 -->
    <MqttConfigDialog v-model:show="state.showMqttDialog.value" />
    <GatewayManagerDialog v-model:show="state.showGatewayManager.value" />
    <ModbusProfilePicker
      :show="state.isProfilePickerShow.value"
      @update:show="val => (state.isProfilePickerShow.value = val)"
      @select="id => (state.selectedProfileId.value = id)"
    />

    <!-- 顶部连接配置 -->
    <ModbusHeader :state="state" :actions="actions" />

    <!-- 主体 -->
    <div class="panel-body">
      <!-- 命令控制区域 -->
      <ModbusControl :state="state" :actions="actions" />
      
      <!-- 监控网格 (日志 & 结果) -->
      <ModbusMonitor :state="state" :actions="actions" />
    </div>

    <!-- ✅ 写入二次确认弹窗 -->
    <div v-if="state.isWriteConfirmShow.value" class="modal-overlay" @click.self="state.isWriteConfirmShow.value = false">
      <div class="modal-content confirm-modal">
        <div class="modal-header warning">
          <h3>⚠️ 操作安全确认 (Write Confirm)</h3>
          <button class="btn-close" @click="state.isWriteConfirmShow.value = false">×</button>
        </div>
        <div class="modal-body write-preview-body">
          <div class="confirm-message">
            您正在对设备从站 <strong>{{ state.slaveAddress.value }}</strong> 执行写入操作。请仔细核对以下参数：
          </div>
          
          <div class="write-info-grid">
            <div class="info-item">
              <label>目标寄存器</label>
              <div class="v">{{ state.pendingWriteInfo.value.regName }}</div>
            </div>
            <div class="info-item">
              <label>物理地址</label>
              <div class="v">{{ state.pendingWriteInfo.value.address }} (Dec)</div>
            </div>
          </div>

          <div class="value-comparison">
            <div class="val-box old">
              <div class="box-label">当前设备值 (Read)</div>
              <div class="box-val">{{ state.pendingWriteInfo.value.oldValue }}</div>
            </div>
            <div class="arrow">➡️</div>
            <div class="val-box new">
              <div class="box-label">计划写入值 (New)</div>
              <div class="box-val highlight">{{ state.pendingWriteInfo.value.newValue }}</div>
            </div>
          </div>

          <div class="confirm-warning">
            ⚠️ 警告：写入错误参数可能导致设备运行异常或硬件损坏。
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="state.isWriteConfirmShow.value = false">取消操作</button>
          <button class="btn-execute" @click="actions.executeActualWrite">确认下发指令</button>
        </div>
      </div>
    </div>

    <!-- ✅ 区块参数一键写入弹窗 -->
    <div v-if="state.isBlockWriteShow.value" class="modal-overlay" @click.self="state.isBlockWriteShow.value = false">
      <div class="modal-content block-write-modal">
        <div class="modal-header primary">
          <div class="header-main">
            <h3>⚙️ 区块参数一键写入</h3>
            <span class="header-subtitle">{{ state.currentBlockReg.value?.name }} (Addr: {{ state.startAddress.value }})</span>
          </div>
          <button class="btn-close" @click="state.isBlockWriteShow.value = false">×</button>
        </div>
        
        <div class="modal-body block-form-body">
          <div v-if="state.isBlockLoading.value" class="block-loading-overlay">
            <div class="spinner"></div>
            <span>正在预读设备当前值...</span>
          </div>

          <div class="block-fields-grid">
            <div v-for="field in state.currentBlockReg.value?.block_fields" :key="field.name" class="block-field-item">
              <label>
                {{ field.name }}
                <span v-if="field.unit" class="field-unit">({{ field.unit }})</span>
              </label>
              
              <div class="field-input-wrapper">
                <select v-if="field.mapping" v-model="state.blockFieldValues.value[field.name]">
                  <option v-for="(label, val) in field.mapping" :key="val" :value="val">
                    {{ label }}
                  </option>
                </select>
                <input v-else type="number" v-model="state.blockFieldValues.value[field.name]" />
                <div class="field-meta">
                  <span>Offset: +{{ field.offset }}</span>
                  <span>DataType: {{ field.data_type }}</span>
                  <span v-if="field.scale" class="meta-scale">Scale: {{ field.scale }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="block-write-hint">
            💡 提示：系统已为您自动填入读取到的初始值。点击"保存并下发"后，系统将使用 0x10 功能码一次性更新整个区块（共 {{ state.currentBlockReg.value?.count }} 个寄存器）。
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-cancel" @click="state.isBlockWriteShow.value = false">取消</button>
          <button class="btn-execute-block" @click="actions.executeBlockWrite">保存并整体下发</button>
        </div>
      </div>
    </div>

    <!-- 全局 Toast -->
    <Transition name="toast">
      <div v-if="state.toast.value.show" class="toast-notification" :class="state.toast.value.type">
        <span class="toast-icon">
          {{ state.toast.value.type === 'success' ? '✅' : state.toast.value.type === 'error' ? '❌' : 'ℹ️' }}
        </span>
        <span class="toast-msg">{{ state.toast.value.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<style>
/* 可以在这里添加一些 index 特定的全局覆盖 */
.toast-enter-active, .toast-leave-active { transition: all 0.4s; }
.toast-enter-from { opacity: 0; transform: translateX(50px); }
.toast-leave-to { opacity: 0; transform: translateY(-20px); }
</style>
