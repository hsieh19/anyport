<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import DesktopLayout from '@/layouts/DesktopLayout.vue';
import MobileLayout from '@/layouts/MobileLayout.vue';

const isMobile = ref(false);

function checkDevice() {
  isMobile.value = window.innerWidth < 768;
}

onMounted(() => {
  checkDevice();
  window.addEventListener('resize', checkDevice);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkDevice);
});
</script>

<template>
  <component :is="isMobile ? MobileLayout : DesktopLayout" />
</template>

<style>
/* Global resets if needed */
body {
  margin: 0;
  background: var(--color-bg);
}
</style>
