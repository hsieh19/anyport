<script setup lang="ts">
import { ref } from 'vue';
import MobileModbusView from '@/views/mobile/MobileModbusView.vue';

const currentTab = ref('modbus');
</script>

<template>
  <div class="mobile-layout">
    <header class="mobile-header">
      <div class="logo">🔌 Anyport</div>
      <div class="status-indicator"></div>
    </header>

    <main class="mobile-content">
      <keep-alive>
        <MobileModbusView v-if="currentTab === 'modbus'" />
        <div v-else class="placeholder">
          <p>功能开发中</p>
        </div>
      </keep-alive>
    </main>

    <nav class="bottom-tab-bar">
      <div 
        class="tab-item" 
        :class="{ active: currentTab === 'modbus' }"
        @click="currentTab = 'modbus'"
      >
        <span class="icon">📡</span>
        <span class="label">Modbus</span>
      </div>
      
      <div 
        class="tab-item disabled" 
      >
        <span class="icon">⚡</span>
        <span class="label">DL/T645</span>
      </div>
      
      <div 
        class="tab-item disabled" 
      >
        <span class="icon">⚙️</span>
        <span class="label">设置</span>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.mobile-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  overflow: hidden;
}

.mobile-header {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.logo {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--color-text);
}

.mobile-content {
  flex: 1;
  overflow: hidden; /* View controls its own scrolling */
  position: relative;
}

.bottom-tab-bar {
  height: 60px;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  display: flex;
  padding-bottom: env(safe-area-inset-bottom);
  flex-shrink: 0;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-item.active {
  color: var(--color-primary);
}

.tab-item.disabled {
  opacity: 0.4;
}

.tab-item .icon {
  font-size: 1.4rem;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
}
</style>
