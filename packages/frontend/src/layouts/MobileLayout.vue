<script setup lang="ts">
import { ref, computed } from 'vue';
import MobileModbusView from '@/views/mobile/MobileModbusView.vue';
import ProfileLibraryView from '@/views/ProfileLibraryView.vue';
import MobileDrawer from '@/components/MobileDrawer.vue';
import { useDeviceStore } from '@/stores/deviceStore';

const deviceStore = useDeviceStore();
const currentView = ref('modbus');
const isDrawerOpen = ref(false);

const pageTitle = computed(() => {
  switch (currentView.value) {
    case 'modbus': return 'Modbus RTU';
    case 'profiles': return '点表库';
    case 'settings': return '设置';
    default: return 'Anyport';
  }
});

function handleViewChange(id: string) {
  currentView.value = id;
}

function toggleDrawer() {
  isDrawerOpen.value = !isDrawerOpen.value;
}
</script>

<template>
  <div class="mobile-layout">
    <!-- Top AppBar -->
    <header class="mobile-app-bar">
      <button class="icon-btn menu-toggle" @click="toggleDrawer" aria-label="Open Menu">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      
      <h2 class="view-title">{{ pageTitle }}</h2>
      
      <div class="status-indicator-wrapper">
        <div 
          class="status-dot" 
          :class="{ connected: deviceStore.isConnected, connecting: deviceStore.isConnecting }"
        ></div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="mobile-main">
      <Transition name="page-fade" mode="out-in">
        <keep-alive>
          <div :key="currentView" class="view-container">
            <div v-if="currentView === 'modbus'" class="mobile-dev-overlay-container">
              <MobileModbusView />
              <div class="mobile-future-tag">
                <div class="tag-content">
                  <span class="icon">🚧</span>
                  <h3>移动端视图 (Coming Soon)</h3>
                  <p>当前专注于 PC 端体验优化</p>
                </div>
              </div>
            </div>
            <ProfileLibraryView v-else-if="currentView === 'profiles'" />
            <div v-else class="placeholder-view">
              <span class="icon">🚀</span>
              <h3>{{ pageTitle }} 规划中</h3>
              <p>更多功能即将上线</p>
            </div>
          </div>
        </keep-alive>
      </Transition>
    </main>

    <!-- Drawer Navigation -->
    <Transition name="drawer">
      <MobileDrawer 
        v-if="isDrawerOpen" 
        :active-tab="currentView" 
        @change="handleViewChange" 
        @close="isDrawerOpen = false" 
      />
    </Transition>
  </div>
</template>

<style scoped>
.mobile-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--color-bg);
  overflow: hidden;
  position: relative;
}

.mobile-app-bar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
  z-index: 100;
  flex-shrink: 0;
}

.view-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.icon-btn {
  background: none;
  border: none;
  padding: 8px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background 0.2s;
}

.icon-btn:active {
  background: var(--color-surface-hover);
}

.status-indicator-wrapper {
  padding: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  box-shadow: 0 0 0 rgba(0,0,0,0);
  transition: all 0.3s ease;
}

.status-dot.connected {
  background: var(--color-success);
  box-shadow: 0 0 8px var(--color-success);
}

.status-dot.connecting {
  background: var(--color-warning);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
  100% { opacity: 1; transform: scale(1); }
}

.mobile-main {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.view-container {
  height: 100%;
  width: 100%;
}

.placeholder-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  gap: 1rem;
}

.placeholder-view .icon {
  font-size: 3rem;
}

/* Page Transition */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Drawer Transition */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.3s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-active :deep(.drawer-content),
.drawer-leave-active :deep(.drawer-content) {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-enter-from :deep(.drawer-content) {
  transform: translateX(-100%);
}

.drawer-leave-to :deep(.drawer-content) {
  transform: translateX(-100%);
}
.mobile-dev-overlay-container {
  position: relative;
  height: 100%;
  width: 100%;
}

.mobile-future-tag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--color-bg-rgb), 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 2rem;
  text-align: center;
}

.tag-content {
  background: var(--color-surface);
  padding: 2rem;
  border-radius: 1rem;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
}

.tag-content .icon {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 1rem;
}

.tag-content h3 {
  margin: 0 0 0.5rem 0;
  color: var(--color-text);
  font-size: 1.1rem;
}

.tag-content p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}
</style>
