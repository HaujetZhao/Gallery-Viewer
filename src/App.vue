<script setup>
import { computed, onMounted } from 'vue';
import { useThemeStore } from './stores/theme.js';
import { useFsStore } from './stores/fs.js';
import { useUserSettingsStore } from './stores/userSettings.js';
import { initDB } from './services/db.js';
import { openFolderPicker } from './services/filesystem.js';
import Sidebar from './components/Sidebar.vue';
import Gallery from './components/Gallery.vue';
import MediaModal from './components/MediaModal.vue';

const themeStore = useThemeStore();
const fsStore = useFsStore();
const settings = useUserSettingsStore();

// pinned/width 从 userSettings 读(main-wrapper 据此调 margin-left)
const sidebarPinned = computed(() => !!settings.settings.sidebarPinned);
const sidebarWidth = computed(() => settings.settings.sidebarWidth || 280);
const mainStyle = computed(() => ({
  marginLeft: sidebarPinned.value ? sidebarWidth.value + 'px' : '0px',
}));

onMounted(async () => {
  themeStore.init();
  try {
    await initDB();
  } catch (e) {
    console.warn('initDB 失败:', e);
  }
});

async function open() {
  await openFolderPicker();
}
</script>

<template>
  <div class="app-root" :class="{ 'sidebar-pinned': sidebarPinned }">
    <Sidebar />

    <div class="main-content-wrapper" :style="mainStyle">
      <div class="top-bar">
        <button class="top-btn" @click="open">
          <i class="fas fa-folder-open"></i> 打开文件夹
        </button>
        <div class="theme-switcher">
          <button
            v-for="t in themeStore.getThemes()"
            :key="t.id"
            :class="['theme-chip', { active: themeStore.currentTheme === t.id }]"
            @click="themeStore.applyTheme(t.id)"
            :title="t.name"
          >{{ t.icon }}</button>
        </div>
      </div>

      <Gallery v-if="fsStore.currentFolder" />
      <div v-else class="empty-state">
        <i class="fas fa-images empty-icon"></i>
        <p>点击「打开文件夹」选择一个含图片/视频的目录</p>
      </div>
    </div>

    <MediaModal />
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
  background: var(--bg-secondary, #f5f7fa);
}
.main-content-wrapper {
  transition: margin-left 0.3s ease;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--sidebar-bg, #2c3e50);
  color: var(--sidebar-text, #ecf0f1);
}
.top-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  background: var(--color-primary, #3498db);
  color: #fff;
}
.top-btn:hover {
  background: var(--color-primary-dark, #2980b9);
}
.theme-switcher {
  display: flex;
  gap: 4px;
}
.theme-chip {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  cursor: pointer;
  font-size: 16px;
}
.theme-chip.active {
  background: var(--color-primary, #3498db);
}
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary, #666);
}
.empty-state .empty-icon {
  font-size: 80px;
  color: var(--color-gray-400, #adb5bd);
}
</style>
