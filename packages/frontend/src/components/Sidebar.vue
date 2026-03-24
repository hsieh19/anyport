<script setup lang="ts">
import { ref } from 'vue';

const emits = defineEmits<{
  (e: 'change', value: string): void
}>();

const appVersion = __APP_VERSION__;
const activeTab = ref('modbus');

const menuItems = [
  { id: 'modbus', label: 'Modbus 调试', icon: '📡' },
  { id: 'bacnet', label: 'BACnet 调试', icon: '🏢' },
  { id: 'profiles', label: '点表库', icon: '📚' },
  { id: 'dlt645', label: 'DL/T 645', icon: '⚡', disabled: true },
  { id: 'mqtt', label: 'Remote (MQTT)', icon: '☁️', disabled: true },
  { id: 'settings', label: '设置', icon: '⚙️', disabled: true },
];

function selectTab(id: string) {
  const item = menuItems.find(i => i.id === id);
  if (item?.disabled) return;
  
  activeTab.value = id;
  emits('change', id);
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <span class="logo-icon">🔌</span>
        <span class="logo-text">Anyport</span>
      </div>
      <p class="version">v{{ appVersion }}</p>
    </div>

    <nav class="sidebar-nav">
      <div 
        v-for="item in menuItems" 
        :key="item.id"
        class="nav-item"
        :class="{ active: activeTab === item.id, disabled: item.disabled }"
        @click="selectTab(item.id)"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="item.disabled" class="nav-badge">WIP</span>
      </div>
    </nav>

    <div class="sidebar-footer">
      <p class="copyright">© 2026 Hotwon-CD2-Hsieh</p>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px;
  height: 100vh;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.25rem;
}

.logo-icon {
  font-size: 1.8rem;
}

.version {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-left: 2.5rem;
}

.sidebar-nav {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
  flex: 1;
}

.sidebar-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.copyright {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-align: center;
  margin: 0;
  white-space: nowrap;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.2s;
  user-select: none;
}

.nav-item:hover:not(.disabled) {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.nav-item.active {
  background: rgba(102, 126, 234, 0.1);
  color: var(--color-primary);
  font-weight: 500;
}

.nav-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nav-icon {
  font-size: 1.2rem;
}

.nav-badge {
  margin-left: auto;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
}
</style>
