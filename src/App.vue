<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import BrowserUnsupportedWarning from './components/BrowserUnsupportedWarning.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ContextMenu from './components/ContextMenu.vue';
import Gallery from './components/Gallery.vue';
import MediaModal from './components/MediaModal.vue';
import PropertiesPanel from './components/PropertiesPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import Sidebar from './components/Sidebar.vue';
import Toast from './components/Toast.vue';
import { useGallerySearch } from './composables/useGallerySearch';
import { useScrollZone } from './composables/useScrollZone';
import { initDB } from './services/db';
import { openFolderPicker } from './services/filesystem';
import { useFsStore } from './stores/fs';
import { useHistoryStore } from './stores/history';
import { useThemeStore } from './stores/theme';
import { useToastStore } from './stores/uiToast';
import { useUserSettingsStore } from './stores/userSettings';
import { isFileSystemAccessSupported } from './utils/browser';

const themeStore = useThemeStore();
const fsStore = useFsStore();
const settings = useUserSettingsStore();
const toast = useToastStore();
const history = useHistoryStore();
const { searchTerm, filteredCount, totalCount } = useGallerySearch();

const sidebarPinned = computed(() => !!settings.settings.sidebarPinned);
const sidebarWidth = computed(() => settings.settings.sidebarWidth || 280);
const mainStyle = computed(() => ({
  marginLeft: sidebarPinned.value ? `${sidebarWidth.value}px` : '0px',
  width: sidebarPinned.value ? `calc(100% - ${sidebarWidth.value}px)` : '100%',
}));

watch(
  sidebarPinned,
  v => document.body.classList.toggle('sidebar-pinned', v),
  { immediate: true },
);

const settingsOpen = ref(false);
const browserSupported = isFileSystemAccessSupported();
const sidebarEl = ref(null);
const settingsBtnEl = ref(null);
const filterEl = ref(null);
useScrollZone([sidebarEl, settingsBtnEl, filterEl]);

onMounted(async () => {
  themeStore.init();
  try {
    await initDB();
  }
  catch (e) {
    console.warn('initDB 失败:', e);
  }
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

async function open() {
  await openFolderPicker();
}
function onKeydown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA')
    return;
  const isCtrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (isCtrl && key === 'o') {
    e.preventDefault();
    open();
  }
  else if (isCtrl && key === 'z') {
    e.preventDefault();
    if (!history.canUndo)
      return;
    history
      .undoLastOperation()
      .then(op => toast.success(`已撤销: ${op.getDescription()}`))
      .catch(err => toast.error(`撤销失败: ${err.message}`));
  }
}
</script>

<template>
  <div :class="{ 'sidebar-pinned': sidebarPinned }">
    <div ref="sidebarEl">
      <Sidebar />
    </div>

    <!-- 启动页(无 currentFolder) -->
    <div v-if="!fsStore.currentFolder" id="hint">
      <div class="intro-content" @click="open">
        <i class="fas fa-images" />
        <h1>相册浏览器</h1>
        <p>点击打开文件夹(纯本地处理)</p>
        <div class="features">
          <div class="feature">
            <i class="fas fa-folder-tree" /><span>文件树</span>
          </div>
          <div class="feature">
            <i class="fas fa-image" /><span>缩略图缓存</span>
          </div>
          <div class="feature">
            <i class="fas fa-info-circle" /><span>EXIF信息</span>
          </div>
          <div class="feature">
            <i class="fas fa-folder-open" /><span>文件整理</span>
          </div>
        </div>
        <BrowserUnsupportedWarning v-if="!browserSupported" />
      </div>
    </div>

    <!-- 主界面 -->
    <div v-else class="main-content-wrapper" :style="mainStyle">
      <div class="container">
        <header class="header">
          <h1><i class="fas fa-images" /> 相册浏览器</h1>
        </header>
        <Gallery />
        <div class="footer">
          <p>使用提示:拖动卡片到左侧文件夹可移动,右键菜单可重命名/删除,Ctrl+Z 撤销。</p>
        </div>
      </div>
    </div>

    <!-- 全局浮层 -->
    <button ref="settingsBtnEl" class="settings-btn" title="设置" @click="settingsOpen = !settingsOpen">
      <i class="fas fa-cog" />
    </button>

    <div v-if="fsStore.currentFolder" ref="filterEl" class="filter-container">
      <input v-model="searchTerm" type="text" placeholder="搜索文件名...">
      <div class="filter-count">
        {{ filteredCount }}/{{ totalCount }}
      </div>
    </div>

    <SettingsPanel v-model="settingsOpen" />
    <MediaModal />
    <Toast />
    <ConfirmDialog />
    <ContextMenu />
    <PropertiesPanel />
  </div>
</template>
