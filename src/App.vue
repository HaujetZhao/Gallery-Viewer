<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useThemeStore } from './stores/theme.js';
import { useFsStore } from './stores/fs.js';
import { initDB } from './services/db.js';
import { openFolderPicker } from './services/filesystem.js';
import Gallery from './components/Gallery.vue';

const themeStore = useThemeStore();
const fsStore = useFsStore();

onMounted(async () => {
  themeStore.init();
  try {
    await initDB();
  } catch (e) {
    console.warn('initDB 失败:', e);
  }
});

// 临时 folder 切换(阶段 5b Sidebar 做好后替换)
const selectedPath = ref('');
const folderOptions = computed(() =>
  [...fsStore.foldersData.entries()]
    .filter(([k]) => k !== 'ALL_MEDIA')
    .map(([k, v]) => ({ path: k, name: v.name, count: v.files.length })),
);
watch(selectedPath, (p) => {
  if (p) fsStore.currentFolder = fsStore.foldersData.get(p);
});

async function open() {
  await openFolderPicker();
  if (fsStore.currentFolder) selectedPath.value = fsStore.currentFolder.path;
}
</script>

<template>
  <div class="app-root">
    <!-- 顶部栏:打开 + folder 切换 + 主题 -->
    <div class="top-bar">
      <button class="top-btn primary" @click="open">
        <i class="fas fa-folder-open"></i> 打开文件夹
      </button>
      <select v-if="folderOptions.length" v-model="selectedPath" class="folder-select">
        <option v-for="f in folderOptions" :key="f.path" :value="f.path">
          📁 {{ f.name }} ({{ f.count }})
        </option>
      </select>
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

    <!-- 主区 -->
    <Gallery v-if="fsStore.currentFolder" />
    <div v-else class="empty-state">
      <i class="fas fa-images empty-icon"></i>
      <p>点击「打开文件夹」选择一个含图片/视频的目录</p>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
  background: var(--bg-secondary, #f5f7fa);
  display: flex;
  flex-direction: column;
}
.top-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--sidebar-bg, #2c3e50);
  color: var(--sidebar-text, #ecf0f1);
  flex-wrap: wrap;
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
.folder-select {
  flex: 1;
  min-width: 200px;
  max-width: 400px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  color: var(--sidebar-text, #ecf0f1);
}
.folder-select option {
  color: #333;
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
