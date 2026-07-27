<script setup>
import { onMounted } from 'vue';
import { useThemeStore } from './stores/theme';

const themeStore = useThemeStore();

onMounted(() => {
  // 应用持久化的主题
  themeStore.init();
});
</script>

<template>
  <div class="startup-placeholder">
    <i class="fas fa-images"></i>
    <h1>相册浏览器</h1>
    <p>骨架就绪 · 阶段 1:主题切换可用</p>

    <!-- 临时主题切换 UI(阶段 7 设置面板做好后替换) -->
    <div class="theme-switcher">
      <button
        v-for="t in themeStore.getThemes()"
        :key="t.id"
        :class="['theme-btn', { active: themeStore.currentTheme === t.id }]"
        @click="themeStore.applyTheme(t.id)"
      >
        <span class="icon">{{ t.icon }}</span>
        <span>{{ t.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.startup-placeholder {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg-secondary, #f5f7fa);
  color: var(--text-primary, #333);
}
.startup-placeholder i {
  font-size: 80px;
  color: var(--color-primary, #3498db);
}
.startup-placeholder h1 {
  font-size: 36px;
  margin: 0;
}
.startup-placeholder p {
  color: var(--text-secondary, #666);
}

.theme-switcher {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 2px solid var(--color-primary, #3498db);
  border-radius: 999px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.theme-btn:hover {
  background: var(--color-primary, #3498db);
  color: #fff;
}
.theme-btn.active {
  background: var(--color-primary, #3498db);
  color: #fff;
}
.theme-btn .icon {
  font-size: 18px;
}
</style>
