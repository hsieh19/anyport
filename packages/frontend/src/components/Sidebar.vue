<script setup lang="ts">
import { ref } from "vue";
import { Coffee } from "lucide-vue-next";
import SponsorDialog from "./SponsorDialog.vue";

const emits = defineEmits<{
  (e: "change", value: string): void;
}>();

const appVersion = __APP_VERSION__;
// 读取 URL 参数以同步激活状态，确保侧边栏没有任何菜单项处于虚假高亮状态
const activeTab = ref(new URLSearchParams(window.location.search).get("view") || "modbus");
const showSponsor = ref(false);

const menuItems = [
  { id: "modbus", label: "Modbus 调试", icon: "📡" },
  { id: "raw232", label: "串口调试", icon: "📟" },
  { id: "bacnet", label: "BACnet 调试", icon: "🏢" },
  { id: "profiles", label: "点表库", icon: "📚" },
  { id: "dlt645", label: "DL/T 645", icon: "⚡", disabled: true },
  { id: "mqtt", label: "Remote (MQTT)", icon: "☁️", disabled: true },
  { id: "settings", label: "设置", icon: "⚙️", disabled: true },
];

function selectTab(id: string) {
  const item = menuItems.find((i) => i.id === id);
  if (item?.disabled) return;

  activeTab.value = id;
  emits("change", id);
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
      <button class="sponsor-trigger" @click="showSponsor = true">
        <Coffee :size="16" />
        <span>支持作者&工具下载</span>
      </button>
      <p class="copyright">© 2026 Hotwon-CD2-Hsieh</p>
    </div>

    <!-- 赞赏弹窗 -->
    <SponsorDialog v-model:show="showSponsor" />
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
  padding: 1.25rem 1.5rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sponsor-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.6rem;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sponsor-trigger:hover {
  background: var(--gradient-primary);
  color: white;
  border-color: transparent;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.copyright {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-align: center;
  margin: 0;
  white-space: nowrap;
  opacity: 0.7;
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
