<script setup lang="ts">
import { ref, computed } from 'vue';
import Sidebar from '@/components/Sidebar.vue';
import ModbusPanel from '@/components/ModbusPanel.vue';
import BacnetPanel from '@/components/BacnetPanel.vue';
import ProfileLibraryView from '@/views/ProfileLibraryView.vue';

const currentView = ref('modbus');

function handleTabChange(id: string) {
  currentView.value = id;
}

const pageTitle = computed(() => {
  switch (currentView.value) {
    case 'modbus': return 'Modbus 调试';
    case 'bacnet': return 'BACnet 调试';
    case 'profiles': return '点表库管理';
    default: return '控制台';
  }
});
</script>

<template>
  <div class="desktop-layout">
    <Sidebar @change="handleTabChange" />
    
    <main class="main-content">
      <header class="content-header">
        <h2 class="view-title">
          {{ pageTitle }}
        </h2>
        <div class="header-actions">
          <!-- 预留顶部操作区 -->
        </div>
      </header>

      <div class="content-body">
        <Transition name="fade" mode="out-in">
          <keep-alive>
            <ModbusPanel v-if="currentView === 'modbus'" />
            <BacnetPanel v-else-if="currentView === 'bacnet'" />
            <ProfileLibraryView v-else-if="currentView === 'profiles'" />
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
}

.view-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
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
