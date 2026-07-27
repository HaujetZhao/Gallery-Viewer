<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useThemeStore } from './stores/theme.js';
import { useFsStore } from './stores/fs.js';
import { useUserSettingsStore } from './stores/userSettings.js';
import { initDB } from './services/db.js';
import { openFolderPicker } from './services/filesystem.js';
import { isFileSystemAccessSupported } from './utils/browser.js';
import Sidebar from './components/Sidebar.vue';
import Gallery from './components/Gallery.vue';
import MediaModal from './components/MediaModal.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import Toast from './components/Toast.vue';
import BrowserUnsupportedWarning from './components/BrowserUnsupportedWarning.vue';
import { useScrollZone } from './composables/useScrollZone.js';

const themeStore = useThemeStore();
const fsStore = useFsStore();
const settings = useUserSettingsStore();

const sidebarPinned = computed(() => !!settings.settings.sidebarPinned);
const sidebarWidth = computed(() => settings.settings.sidebarWidth || 280);
const mainStyle = computed(() => ({
  marginLeft: sidebarPinned.value ? sidebarWidth.value + 'px' : '0px',
}));

const settingsOpen = ref(false);
const browserSupported = isFileSystemAccessSupported();

// scrollzone 排除区域 ref
const sidebarEl = ref(null);
const settingsBtnEl = ref(null);
useScrollZone([sidebarEl, settingsBtnEl]);

onMounted(async () => {
  themeStore.init();
  try {
    await initDB();
  } catch (e) {
    console.warn('initDB 失败:', e);
  }
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function open() {
  await openFolderPicker();
}

// Ctrl+O 打开文件夹(modal 内键盘由 useModal 处理,这里只管全局)
function onKeydown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    open();
  }
}
</script>

<template>
  <div class="app-root" :class="{ 'sidebar-pinned': sidebarPinned }">
    <div ref="sidebarEl"><Sidebar /></div>

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
        <div class="intro-content" @click="open">
          <i class="fas fa-images empty-icon"></i>
          <h1>相册浏览器</h1>
          <p>点击选择文件夹(纯本地处理)</p>
          <BrowserUnsupportedWarning v-if="!browserSupported" />
        </div>
      </div>
    </div>

    <!-- 齿轮按钮(fixed top-left) -->
    <button class="settings-btn" ref="settingsBtnEl" @click="settingsOpen = !settingsOpen" title="设置">
      <i class="fas fa-cog"></i>
    </button>

    <SettingsPanel v-model="settingsOpen" />
    <MediaModal />
    <Toast />
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
  align-items: center;
  justify-content: center;
}
.intro-content {
  max-width: 600px;
  padding: 40px;
  background: var(--bg-primary, #fff);
  border-radius: 15px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  text-align: center;
  cursor: pointer;
  transition: transform 0.3s, box-shadow 0.3s;
}
.intro-content:hover {
  transform: translateY(-5px);
  box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
}
.intro-content .empty-icon {
  font-size: 80px;
  color: var(--color-primary, #3498db);
  margin-bottom: 20px;
}
.intro-content h1 {
  font-size: 36px;
  margin: 0 0 15px;
  color: var(--text-primary, #333);
}
.intro-content p {
  font-size: 18px;
  color: var(--text-secondary, #666);
}
</style>
