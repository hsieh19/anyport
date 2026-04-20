<script setup lang="ts">
import {} from "vue";

interface Props {
  show: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:show", value: boolean): void;
}>();

// 防止右键菜单和图片拖拽，增加基础防爬保护
const handleImageProtection = (e: Event) => {
  e.preventDefault();
};

const workerBase = "https://update.anyport.one";
const rewardImgUrl = `${workerBase}/anyport/reward.png`;

function handleDownload() {
  // 1. 先请求签名地址
  fetch(`${workerBase}/anyport/get-link?ver=bridge`)
    .then((res) => res.json())
    .then((data) => {
      if (data.url) {
        // 2. 使用带签名的地址进行下载
        window.open(data.url, "_blank");
      } else {
        alert("获取下载链接失败，请稍后重试");
      }
    })
    .catch((err) => {
      console.error("Download error:", err);
      alert("网络错误，无法连接下载服务器");
    });
}

function handleClose() {
  emit("update:show", false);
}

function openFlasher() {
  window.open("?view=flasher", "_blank");
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="props.show" class="sponsor-overlay" @click.self="handleClose">
        <Transition name="zoom">
          <div v-if="props.show" class="sponsor-card">
            <header class="sponsor-header">
              <div class="title-group">
                <h3>💖 支持作者 & 工具下载</h3>
                <p class="subtitle">感谢支持 Anyport 的开源开发</p>
              </div>
              <button class="btn-close" @click="handleClose">×</button>
            </header>

            <section class="sponsor-body">
              <div class="qr-container">
                <!-- 基础隐私保护：禁用右键、拖放、不发送 Referrer -->
                <img
                  v-if="props.show"
                  :src="rewardImgUrl"
                  alt="Reward Code"
                  class="reward-qr"
                  referrerpolicy="no-referrer"
                  @contextmenu="handleImageProtection"
                  @dragstart="handleImageProtection"
                />
              </div>

              <div class="sponsor-tips">
                <p>您的每一份支持，都是我维护 Anyport 的动力。</p>
              </div>
            </section>

            <footer class="sponsor-footer">
              <div class="footer-actions">
                <button class="btn-done" @click="handleDownload">
                  下载 anyport-bridge
                </button>
                <button class="btn-outline" @click="openFlasher">
                  ESP32 固件烧录工具 ↗
                </button>
              </div>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sponsor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px); /* 背景磨砂效果 */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.sponsor-card {
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: var(--radius-lg);
  width: 95%;
  max-width: 540px;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: cardFadeIn 0.3s ease-out;
}

.sponsor-header {
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--color-border);
}

.title-group h3 {
  margin: 0;
  font-size: 1.25rem;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 700;
}

.subtitle {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 0.25rem 0 0;
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.sponsor-body {
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.qr-container {
  position: relative;
  width: 320px; /* 从 260px 增加至 320px */
  height: 320px;
  background: #fff;
  padding: 0; /* 移除 padding，由图片自带边距控制 */
  border-radius: var(--radius-md);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.reward-qr {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.sponsor-tips {
  text-align: center;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.sponsor-footer {
  padding: 1rem 1.5rem 1.5rem;
}

.footer-actions {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  width: 100%;
}

.btn-done, .btn-outline {
  flex: 1;
  padding: 0.75rem;
  border-radius: var(--radius-md);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-done {
  background: var(--gradient-primary);
  color: white;
  border: none;
}

.btn-done:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.btn-outline {
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}

.btn-outline:hover {
  background: rgba(102, 126, 234, 0.08);
}

/* 动画效果 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.zoom-enter-active {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.zoom-leave-active {
  transition: transform 0.2s ease-in;
}
.zoom-enter-from {
  transform: scale(0.85);
  opacity: 0;
}
.zoom-leave-to {
  transform: scale(0.95);
  opacity: 0;
}
</style>
