<script setup lang="ts">
import { watch } from 'vue';

const props = defineProps<{
  activeTab: string;
}>();

const emits = defineEmits<{
  (e: 'change', value: string): void;
  (e: 'close'): void;
}>();

const menuItems = [
  { id: 'modbus', label: 'Modbus RTU', icon: '📡' },
  { id: 'profiles', label: '点表库', icon: '📚' },
  { id: 'dlt645', label: 'DL/T 645', icon: '⚡', disabled: true },
  { id: 'mqtt', label: 'MQTT Client', icon: '☁️', disabled: true },
  { id: 'settings', label: '设置', icon: '⚙️', disabled: true },
];

function selectTab(id: string) {
  const item = menuItems.find(i => i.id === id);
  if (item?.disabled) return;
  emits('change', id);
  emits('close');
}

// 阻止滚动穿透 (预留)
watch(() => props.activeTab, () => {
  // 处理逻辑
});
</script>

<template>
  <div class="mobile-drawer-overlay" @click="emits('close')">
    <div class="drawer-content" @click.stop>
      <div class="drawer-header">
        <div class="logo">
          <span class="logo-icon">🔌</span>
          <div class="logo-info">
            <span class="logo-text">Anyport</span>
            <span class="version">v1.0.1</span>
          </div>
        </div>
      </div>

      <nav class="drawer-nav">
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

      <div class="drawer-footer">
        <p>© 2024 Anyport Team</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-drawer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 1000;
}

.drawer-content {
  width: 280px;
  height: 100%;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.drawer-header {
  padding: 2rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.logo {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo-icon {
  font-size: 2rem;
}

.logo-info {
  display: flex;
  flex-direction: column;
}

.logo-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text);
}

.version {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.drawer-nav {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  transition: all 0.2s;
  user-select: none;
}

.nav-item.active {
  background: rgba(102, 126, 234, 0.1);
  color: var(--color-primary);
  font-weight: 600;
}

.nav-item.disabled {
  opacity: 0.5;
}

.nav-icon {
  font-size: 1.25rem;
}

.nav-badge {
  margin-left: auto;
  font-size: 0.65rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.drawer-footer {
  padding: 1.5rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  text-align: center;
}
</style>
