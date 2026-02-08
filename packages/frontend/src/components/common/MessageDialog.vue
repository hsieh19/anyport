<script setup lang="ts">
/**
 * 专业的居中弹窗组件
 */

interface Props {
  show: boolean;
  title?: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
}

const props = withDefaults(defineProps<Props>(), {
  title: '系统提示',
  type: 'info'
});

const emit = defineEmits(['close']);

function handleClose() {
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <Transition name="zoom">
          <div v-if="show" class="modal-container" :class="type">
            <div class="modal-header">
              <span class="modal-icon">
                <template v-if="type === 'warning'">⚠️</template>
                <template v-else-if="type === 'error'">❌</template>
                <template v-else>ℹ️</template>
              </span>
              <h3 class="modal-title">{{ title }}</h3>
            </div>
            
            <div class="modal-body">
              <p class="modal-message">{{ message }}</p>
            </div>
            
            <div class="modal-footer">
              <button class="btn-confirm" @click="handleClose">确认</button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-container {
  background: #1e1e2d;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  width: 90%;
  max-width: 400px;
  padding: 1.5rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
  color: #fff;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.modal-icon {
  font-size: 1.5rem;
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.modal-container.warning { border-top: 4px solid #facc15; }
.modal-container.error { border-top: 4px solid #f87171; }
.modal-container.warning .modal-title { color: #facc15; }
.modal-container.error .modal-title { color: #f87171; }

.modal-body {
  margin-bottom: 1.5rem;
}

.modal-message {
  line-height: 1.6;
  color: #e2e8f0;
  margin: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
}

.btn-confirm {
  padding: 0.6rem 2rem;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  border-radius: 6px;
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s;
}

.btn-confirm:active {
  transform: scale(0.95);
}

/* 动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.zoom-enter-active {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.zoom-leave-active {
  transition: transform 0.2s ease;
}
.zoom-enter-from {
  transform: scale(0.9);
}
.zoom-leave-to {
  transform: scale(0.95);
}
</style>
