<script setup>
import { computed, onBeforeUnmount, onErrorCaptured, onMounted, ref, watch } from 'vue';
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
import { hoveredFile, requestRename } from './composables/useHoveredFile';
import { useScrollZone } from './composables/useScrollZone';
import { initDB } from './services/db';
import { openFolderPicker, switchToRoot } from './services/folderActions';
import * as handleStore from './services/handleStore';
import { flushPendingPersist } from './services/persistence';
import { useFavoritesStore } from './stores/favorites';
import { useFsStore } from './stores/fs';
import { useHistoryStore } from './stores/history';
import { useModalStore } from './stores/modal';
import { usePropertiesStore } from './stores/properties';
import { useRootStore } from './stores/root';
import { useThemeStore } from './stores/theme';
import { useToastStore } from './stores/uiToast';
import { useUserSettingsStore } from './stores/userSettings';
import { isFileSystemAccessSupported } from './utils/browser';
import { formatRelativeTime } from './utils/format';

const themeStore = useThemeStore();
const fsStore = useFsStore();
const rootStore = useRootStore();
const settings = useUserSettingsStore();
const toast = useToastStore();
const history = useHistoryStore();
const favorites = useFavoritesStore();
const properties = usePropertiesStore();
const modal = useModalStore();
const { searchTerm, filteredCount, totalCount, filterFavorite, filterNote } = useGallerySearch();

const sidebarPinned = computed(() => !!settings.settings.sidebarPinned);

// 全局错误边界:兜底所有子组件未处理错误——toast 提示 + return false 阻止错误上抛(不白屏)。
// ponytail:App.vue 是根,onErrorCaptured 一处兜底,替代散落各组件的 try/catch。
onErrorCaptured((err) => {
  console.error('组件错误(已兜底):', err);
  toast.error(`发生错误:${err?.message || err}`);
  return false;
});
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
const searchInputEl = ref(null);
// 待恢复:{ id, name } 权限需用户手势重新授权时,启动页显示"打开上次"按钮
const restorableHandle = ref(null);
const settingsPanelEl = ref(null); // SettingsPanel 组件 ref;面板根经 defineExpose 暴露
// 设置面板根元素(面板 v-if 关闭时为 null → computed 返回 null,排除区跳过)。hover 面板时不触发边缘感应滚动。
const settingsPanelRoot = computed(() => settingsPanelEl.value?.panelEl);
useScrollZone([sidebarEl, settingsBtnEl, filterEl, settingsPanelRoot]);

onMounted(async () => {
  themeStore.init();
  try {
    await initDB();
  }
  catch (e) {
    console.warn('initDB 失败:', e);
  }
  // R6/R14:favorites/notes 不再启动 load——改为 thumbnail.js 视窗与缩略图同流程懒加载
  // (userData.ensureLoaded 填镜像,卡片爱心/备注按需显示,无需启动 IO)。
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('visibilitychange', onVisibilityChange);
  await tryRestoreFolder();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

// 启动:加载历史 → 取最近 → 权限 granted 自动恢复;否则启动页显示"打开上次"(requestPermission 需用户手势)。
async function tryRestoreFolder() {
  try {
    await rootStore.loadFromHandleStore();
    const last = await handleStore.getLastUsed();
    if (!last)
      return;
    const perm = await last.handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      await switchToRoot(last.id);
    }
    else {
      restorableHandle.value = { id: last.id, name: last.handle.name };
    }
  }
  catch (e) {
    console.warn('恢复文件夹失败:', e);
  }
}

// 用户点击"打开上次":此时有用户手势,switchToRoot 内 requestPermission 可弹框
async function restoreLast() {
  const r = restorableHandle.value;
  if (!r)
    return;
  restorableHandle.value = null;
  await switchToRoot(r.id);
}

async function open() {
  await openFolderPicker();
  restorableHandle.value = null;
}
function onKeydown(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA')
    return;
  const isCtrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // R6:L 切收藏。modal 打开 → 切当前大图;否则切 hover 的卡片。输入框聚焦已在上方 return。
  if (!isCtrl && key === 'l') {
    const f = modal.isOpen ? modal.currentFile : hoveredFile.value;
    if (f?.md5) {
      e.preventDefault();
      favorites.toggle(f.md5);
    }
    return;
  }
  // R16-b:modal 内 N → 打开属性面板并直达备注栏(备注入口)。
  if (!isCtrl && key === 'n') {
    if (modal.isOpen && modal.currentFile) {
      e.preventDefault();
      properties.open(modal.currentFile, { focusNote: true });
    }
    return;
  }
  // F2:重命名。modal 打开 → 打开属性面板直达文件名 inline 编辑(方案 A);
  // modal 未开 → 重命名 hover 的卡片。输入框聚焦已在上方 return。
  if (!isCtrl && key === 'f2') {
    if (modal.isOpen && modal.currentFile) {
      e.preventDefault();
      properties.open(modal.currentFile, { focusRename: true });
    }
    else if (hoveredFile.value) {
      e.preventDefault();
      requestRename();
    }
    return;
  }
  if (isCtrl && key === 'o') {
    e.preventDefault();
    open();
  }
  else if (isCtrl && key === 'f') {
    // Ctrl+F:聚焦右上角搜索框(拦掉浏览器原生查找)。
    if (searchInputEl.value) {
      e.preventDefault();
      searchInputEl.value.focus();
      searchInputEl.value.select?.();
    }
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

// 切后台/关页面前 best-effort 落盘在途 debounce 写(防 1s 窗口内关浏览器丢改动)。
// visibilitychange:hidden 在 pagehide 前触发,是 IDB 写的最后可靠时机之一(多数浏览器 hidden 下仍允许写完);
// 真正的关标签页 IDB async 不可靠,但比不写强。无在途写时 flushPendingPersist 零成本快路径 return。
function onVisibilityChange() {
  if (document.visibilityState === 'hidden')
    flushPendingPersist();
}
</script>

<template>
  <div :class="{ 'sidebar-pinned': sidebarPinned }">
    <div ref="sidebarEl">
      <Sidebar />
    </div>

    <!-- 启动页(无 currentFolder) -->
    <div v-if="!fsStore.currentFolder" class="main-content-wrapper" :style="mainStyle">
      <div class="container">
        <header class="header">
          <h1><i class="fas fa-images" /> 相册浏览器</h1>
        </header>
        <div id="hint">
          <div class="intro-content" @click="open">
            <i class="fas fa-images" />
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
          <!-- 恢复上次(权限需重新授权) -->
          <div v-if="restorableHandle" class="restore-card" @click.stop="restoreLast">
            <i class="fas fa-folder-open" />
            <span>打开上次:{{ restorableHandle.name }}</span>
          </div>
          <!-- 历史文件夹列表 -->
          <div v-if="rootStore.roots.length" class="root-history">
            <div
              v-for="r in rootStore.roots"
              :key="r.id"
              class="root-history-item"
              @click="switchToRoot(r.id)"
            >
              <i class="fas fa-folder" />
              <div class="r-info">
                <div class="r-name">
                  {{ r.name }}
                </div>
                <div class="r-meta">
                  {{ r.fileCount || 0 }} 文件 · {{ formatRelativeTime(r.lastUsed) }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="footer">
          <p>使用提示:拖动卡片到左侧文件夹可移动,右键菜单可重命名/删除,Ctrl+Z 撤销。</p>
        </div>
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
    <button ref="settingsBtnEl" class="settings-btn" title="设置" @click.stop="settingsOpen = !settingsOpen">
      <i class="fas fa-cog" />
    </button>

    <div v-if="fsStore.currentFolder" ref="filterEl" class="filter-container">
      <div class="filter-row">
        <input ref="searchInputEl" v-model="searchTerm" type="text" placeholder="搜索文件名...">
        <!-- R16-a:收藏/备注筛选内嵌搜索框右侧、数量左边(图标 toggle,激活高亮) -->
        <div class="filter-inline">
          <button
            class="filter-icon"
            :class="{ active: filterFavorite }"
            title="仅显示收藏的文件"
            @click="filterFavorite = !filterFavorite"
          >
            <i :class="filterFavorite ? 'fas fa-heart' : 'far fa-heart'" />
          </button>
          <button
            class="filter-icon fav-note"
            :class="{ active: filterNote }"
            title="仅显示有备注的文件"
            @click="filterNote = !filterNote"
          >
            <i class="fas fa-edit" />
          </button>
          <div class="filter-count">
            {{ filteredCount }}/{{ totalCount }}
          </div>
        </div>
      </div>
    </div>

    <SettingsPanel ref="settingsPanelEl" v-model="settingsOpen" />
    <MediaModal />
    <Toast />
    <ConfirmDialog />
    <ContextMenu />
    <PropertiesPanel />
  </div>
</template>

<style scoped>
.restore-card {
  margin: 20px auto 0;
  padding: 12px 20px;
  max-width: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed var(--color-primary);
  border-radius: var(--radius-lg);
  color: var(--color-primary);
  cursor: pointer;
  font-size: 15px;
  transition: all var(--transition-fast) var(--ease-out);
}
.restore-card:hover {
  background-color: var(--bg-tertiary);
  transform: translateY(-2px);
}
.root-history {
  max-width: 360px;
  margin: 12px auto 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.root-history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--color-gray-200);
  border-radius: var(--radius-lg);
  cursor: pointer;
  background: var(--bg-secondary);
  transition: all var(--transition-fast) var(--ease-out);
}
.root-history-item:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}
.root-history-item .r-info {
  flex: 1;
  min-width: 0;
}
.r-name {
  font-size: 14px;
}
.r-meta {
  font-size: 11px;
  color: var(--text-muted);
}

/* ===== 启动页(原 components.css) ===== */
#hint {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px 0;
}

.intro-content {
    max-width: 600px;
    padding: 40px;
    background-color: var(--bg-primary);
    border-radius: 15px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.intro-content:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
}

.intro-content i {
    font-size: 80px;
    color: var(--text-primary);
    margin-bottom: 20px;
}

.intro-content h1 {
    font-size: 36px;
    margin-bottom: 15px;
    color: var(--text-primary);
}

.intro-content p {
    font-size: 18px;
    color: var(--text-secondary);
    margin-bottom: 10px;
}

.features {
    display: flex;
    justify-content: center;
    gap: 30px;
    margin-top: 30px;
}

.feature {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.feature i {
    font-size: 28px !important;
    margin-bottom: 0 !important;
    color: #2C3E50;
}

.feature span {
    font-size: 14px;
    color: var(--text-secondary);
}

@media (max-width: 768px) {
    .intro-content {
        max-width: 90%;
        padding: 30px 20px;
    }

    .intro-content i {
        font-size: 60px;
    }

    .intro-content h1 {
        font-size: 28px;
    }

    .intro-content p {
        font-size: 16px;
    }

    .features {
        gap: 20px;
        flex-wrap: wrap;
    }

    .feature {
        min-width: 100px;
    }
}

@media (max-width: 480px) {
    .intro-content {
        padding: 20px 15px;
    }

    .intro-content i {
        font-size: 50px;
    }

    .intro-content h1 {
        font-size: 24px;
    }

    .intro-content p {
        font-size: 14px;
    }

    .features {
        gap: 15px;
    }

    .feature i {
        font-size: 24px !important;
    }

    .feature span {
        font-size: 12px;
    }
}

/* ===== 悬浮设置按钮(原 components.css) ===== */
/* body 级 class,scoped 不给 body 加 data-v;body.sidebar-pinned .settings-btn[data-v] 仍匹配 */
.settings-btn {
    position: fixed;
    top: 20px;
    left: 20px;
    width: 50px;
    height: 50px;
    background-color: #2C3E50;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 1000; /* 高于展开媒体(950)/侧栏(900),设置按钮始终可见可点 */
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border: none;
}

body.sidebar-pinned .settings-btn {
    left: calc(var(--sidebar-width) + 20px);
}

.settings-btn:hover {
    transform: rotate(30deg);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.settings-btn i {
    font-size: 24px;
    color: white;
}

/* ===== 筛选悬浮区域(原 components.css) ===== */
.filter-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000; /* 高于展开媒体(950),搜索框不被盖住 */
}

.filter-row {
    position: relative;
}

.filter-container input[type="text"] {
    padding: 12px 20px;
    border: 1px solid var(--color-gray-300);
    border-radius: 25px;
    font-size: 14px;
    width: 250px;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transition: all 0.3s ease;
    /* 右侧留出筛选图标 + 数量的空间(♡ ✎ 各 26 + count ~40 + 间距 + 边距) */
    padding-right: 108px;
}

.filter-container input[type="text"]:focus {
    outline: none;
    border-color: #2C3E50;
    box-shadow: 0 6px 16px rgba(67, 97, 238, 0.15);
    width: 300px;
}

/* R16-a 筛选图标 + 数量,内嵌输入框右侧(图标在数量左边) */
.filter-inline {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    z-index: 1;
}

.filter-icon {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, color 0.15s ease;
}

.filter-icon:hover {
    background: var(--bg-secondary);
}

/* 收藏激活=实心红心;备注激活=主题蓝 */
.filter-icon.active {
    color: #ff4d6d;
}

.filter-icon.fav-note.active {
    color: var(--color-primary, #2C3E50);
}

.filter-count {
    background-color: #2C3E50;
    color: white;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    pointer-events: none;
    margin-left: 4px;
}

/* ===== 布局(原 layout.css) ===== */
.header {
    text-align: center;
    margin-bottom: 30px;
    padding: 20px 0;
    border-bottom: 1px solid var(--color-gray-200);
}

.header h1 {
    color: var(--text-primary);
    font-size: 2.5rem;
    margin: 0;
}

.footer {
    margin-top: 30px;
    text-align: center;
    padding: 15px;
    color: var(--text-muted);
    font-size: 0.9rem;
    border-top: 1px solid var(--color-gray-200);
}

.footer p {
    margin: 8px 0;
}

/* ponytail: .footer-links 删除 —— 全工程无 DOM 使用(grep 零命中),原 layout.css 死代码 */

.main-content-wrapper {
    flex: 1;
    width: 100%;
    margin-left: 0;
    transition: margin-left 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

body.sidebar-pinned .main-content-wrapper {
    margin-left: var(--sidebar-width, 280px);
    width: calc(100% - var(--sidebar-width, 280px));
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1;
}

@media (max-width: 768px) {
    body.sidebar-pinned .main-content-wrapper {
        margin-left: 0;
    }
}
</style>
