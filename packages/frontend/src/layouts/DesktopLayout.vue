<script setup lang="ts">
import { ref, computed } from "vue";
import { useDeviceStore } from "@/stores/deviceStore";
import Sidebar from "@/components/Sidebar.vue";
import ModbusPanel from "@/components/modbus/index.vue";
import BacnetPanel from "@/components/bacnet/index.vue";
import RawSerialPanel from "@/components/raw/index.vue";
import ProfileLibraryView from "@/views/ProfileLibraryView.vue";
import FirmwareFlasherView from "@/views/FirmwareFlasherView.vue";

const currentView = ref(new URLSearchParams(window.location.search).get("view") || "modbus");

function handleTabChange(id: string) {
  currentView.value = id;
  // 若非通过弹窗新页面打开，可同步更新 URL 状态（可选，不强制刷新页面）
  window.history.replaceState({}, "", `?view=${id}`);
}

const deviceStore = useDeviceStore();

const pageTitle = computed(() => {
  switch (currentView.value) {
    case "modbus":
      return "Modbus 调试";
    case "raw232":
      return "串口调试";
    case "bacnet":
      return "BACnet 调试";
    case "profiles":
      return "点表库管理";
    case "flasher":
      return "固件烧录工具";
    default:
      return "控制台";
  }
});
</script>

<template>
  <div class="desktop-layout">
    <Sidebar @change="handleTabChange" />

    <main class="main-content">
      <header class="content-header">
        <div class="header-left-col">
          <h2 class="view-title">
            {{ pageTitle }}
          </h2>
        </div>

        <!-- 报错徽章：在标题行（Header）正中央显示 -->
        <div
          v-if="currentView === 'modbus' && deviceStore.modbusError"
          class="error-badge centered-header-badge"
          @click="deviceStore.clearModbusError()"
        >
          <span class="icon">❌</span>
          {{ deviceStore.modbusError }}
          <span class="close-btn">×</span>
        </div>
        <div class="header-actions">
          <!-- 预留顶部操作区 -->
        </div>
      </header>

      <div class="content-body">
        <Transition name="fade" mode="out-in">
          <keep-alive>
            <ModbusPanel v-if="currentView === 'modbus'" />
            <RawSerialPanel v-else-if="currentView === 'raw232'" />
            <BacnetPanel v-else-if="currentView === 'bacnet'" />
            <ProfileLibraryView v-else-if="currentView === 'profiles'" />
            <FirmwareFlasherView v-else-if="currentView === 'flasher'" />
            <div v-else class="placeholder-view">
              <h3>功能开发中...</h3>
            </div>
          </keep-alive>
        </Transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
.desktop-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: var(--color-bg);
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content-header {
  height: 64px;
  padding: 0 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  position: relative; /* 核心：报警条相对于 Head 居中 */
}

.view-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.error-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff5f5;
  border: 1px solid #feb2b2;
  color: #c53030;
  padding: 4px 16px;
  border-radius: 9999px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
  animation: fadeInDown 0.3s ease-out;
  box-shadow: 0 2px 10px rgba(197, 48, 48, 0.1);
  white-space: nowrap;
  z-index: 100;
}

.centered-header-badge {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.error-badge:hover {
  background: #fed7d7;
  transform: translate(-50%, -52%);
}

.error-badge .close-btn {
  font-size: 1.2rem;
  line-height: 1;
  opacity: 0.6;
  margin-left: 4px;
}

@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translate(-50%, -100%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

.content-body {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.placeholder-view {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: var(--color-text-secondary);
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
