<script setup lang="ts">
import { useProfileStore } from '@/stores/profileStore';

defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'select', id: string): void;
}>();

const profileStore = useProfileStore();

function select(id: string) {
  emit('select', id);
  emit('update:show', false);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="overlay" @click.self="emit('update:show', false)">
        <div class="card">
          <header>
            <h3>选择点表</h3>
             <button class="close-btn" @click="emit('update:show', false)">×</button>
          </header>
          <div class="body">
             <div class="list">
               <div v-if="profileStore.profiles.length === 0" class="empty">
                 暂无可用点表
               </div>
               <div 
                 v-for="p in profileStore.profiles" 
                 :key="p.id" 
                 class="item"
                 @click="select(p.id)"
               > 
                 <div class="main">
                   <div class="name">{{ p.name }}</div>
                   <div class="model-tag">{{ p.data.protocol_summary?.model || 'Unknown' }}</div>
                 </div>
                 <div class="desc">{{ p.description || '无描述' }}</div>
                 <div class="meta">{{ p.data.registers?.length || 0 }} 个寄存器</div>
               </div>
             </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.card {
  background: white;
  width: 90%;
  max-width: 450px;
  border-radius: 12px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2);
}

header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #111827;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #9ca3af;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #4b5563;
}

.body {
  padding: 1.5rem;
  overflow-y: auto;
  background: #f9fafb;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.item {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  transition: all 0.2s;
}

.item:hover {
  border-color: #6366f1;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.name {
  font-weight: 600;
  color: #111827;
  font-size: 0.95rem;
}

.model-tag {
  font-size: 0.75rem;
  background: #e0e7ff;
  color: #4338ca;
  padding: 2px 6px;
  border-radius: 4px;
}

.desc {
  font-size: 0.85rem;
  color: #6b7280;
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

.meta {
  font-size: 0.75rem;
  color: #9ca3af;
  text-align: right;
}

.empty {
  text-align: center;
  color: #9ca3af;
  padding: 2rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
