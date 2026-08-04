<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useOverlay } from '../composables/useOverlay';
import { useStorageEstimate } from '../composables/useStorageEstimate';
import { cleanOldCache, clearAllCache } from '../services/db';
import { refreshFolder, reloadProject } from '../services/folderActions';
import { forceRegenerateCurrentThumbnails } from '../services/thumbnail';
import { useFsStore } from '../stores/fs';
import { useThemeStore } from '../stores/theme';
import { useToastStore } from '../stores/uiToast';
import { useUserSettingsStore } from '../stores/userSettings';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const settings = useUserSettingsStore();
const themeStore = useThemeStore();
const fsStore = useFsStore();
const toast = useToastStore();
const { text: storageText, refresh: refreshStorage } = useStorageEstimate();

const panelEl = ref(null);
const left = ref(80);
const top = ref(80);

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      await refreshStorage();
      await nextTick();
      // 贴近设置按钮(左上;sidebar-pinned 时右移)正下方,而非固定窗口右侧
      const btn = document.querySelector('.settings-btn');
      const panelWidth = 350;
      if (btn) {
        const r = btn.getBoundingClientRect();
        left.value = Math.max(10, Math.min(r.left, window.innerWidth - panelWidth - 10));
        top.value = r.bottom + 8;
      }
      else {
        left.value = Math.max(10, window.innerWidth - panelWidth - 20);
        top.value = 80;
      }
    }
  },
);

// 拖拽
let dragOffset = null;
function onDragStart(e) {
  if (!e.target.closest('.settings-header'))
    return;
  e.preventDefault();
  const rect = panelEl.value.getBoundingClientRect();
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove(e) {
  if (!dragOffset)
    return;
  const maxX = window.innerWidth - panelEl.value.offsetWidth;
  const maxY = window.innerHeight - panelEl.value.offsetHeight;
  left.value = Math.max(0, Math.min(e.clientX - dragOffset.x, maxX));
  top.value = Math.max(0, Math.min(e.clientY - dragOffset.y, maxY));
}
function onDragEnd() {
  dragOffset = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// ESC 关闭 + 点外关闭;拖拽兜底卸载
// outsideClick 只响应真 click(mousedown+mouseup 同处),按住 header 拖到面板外是 drag → 无 click 事件 → 不误触发关闭。
useOverlay({
  isVisible: () => props.modelValue,
  overlayEl: panelEl,
  onClose: () => emit('update:modelValue', false),
  outsideClick: true, // 点外关(click≠drag,拖拽不误触发)
});
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});

// 控件(本地 ref + change 提交 userSettings)
const sortField = ref(settings.settings.sortField);
const sortAsc = ref(settings.settings.sortDirection === 'asc');
// 排序分段选项:第一段字段、第二段升降序。
const sortFieldOptions = [
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'date', label: '时间' },
];
const sortDirOptions = [
  { value: 'asc', icon: 'fas fa-arrow-down-short-wide', title: '升序' },
  { value: 'desc', icon: 'fas fa-arrow-up-wide-short', title: '降序' },
];
const sortDir = computed(() => (sortAsc.value ? 'asc' : 'desc'));
function setSortField(v) {
  sortField.value = v;
  settings.set('sortField', v);
}
function setSortDir(v) {
  sortAsc.value = v === 'asc';
  settings.set('sortDirection', v);
}
const colCount = ref(settings.settings.columnCount);
const thumbnailSize = ref(settings.settings.thumbnailSize);
const cardStyle = ref(settings.settings.cardStyle);
const scrollZoneEnabled = ref(settings.settings.scrollZoneEnabled);
const scrollSpeed = ref(settings.settings.scrollSpeed);

function commitCol() {
  settings.set('columnCount', Number(colCount.value));
}
function commitThumb() {
  settings.set('thumbnailSize', Number(thumbnailSize.value));
}
// 卡片样式选项(分段按钮组,互斥;后续加新样式只需往这里加一项)。
const cardStyleOptions = [
  { value: 'hover', label: '悬停显示' },
  { value: 'always', label: '常驻显示' },
  { value: 'detail', label: '信息卡片' },
];
function setCardStyle(v) {
  cardStyle.value = v;
  settings.set('cardStyle', v);
}
function toggleScrollZone() {
  scrollZoneEnabled.value = !scrollZoneEnabled.value;
  settings.set('scrollZoneEnabled', scrollZoneEnabled.value);
}
function commitSpeed() {
  settings.set('scrollSpeed', Number(scrollSpeed.value));
}

// 刷新目录:ALL_MEDIA 走重载项目,否则重扫当前文件夹(捕获外部增删改)
async function onRefreshCurrent() {
  if (!fsStore.currentFolder)
    return;
  if (fsStore.currentFolder === fsStore.allMediaFolder) {
    await onReload();
    return;
  }
  toast.info('刷新中...');
  try {
    await refreshFolder(fsStore.currentFolder);
    toast.success('已刷新当前目录');
  }
  catch (e) {
    toast.error(`刷新失败: ${e.message}`);
  }
}
// 重绘当前:删当前视图缩略图缓存 + 重挂卡片重新生成(forceRegenerateCurrentThumbnails 内部已 toast)
function onRedrawCurrent() {
  forceRegenerateCurrentThumbnails();
}
async function onReload() {
  toast.info('重载项目中...');
  await reloadProject();
  toast.success('已重载');
}
async function onCleanOld() {
  const { deletedCount } = await cleanOldCache();
  toast.success(deletedCount > 0 ? `已清理 ${deletedCount} 张旧缩略图` : '没有超过 20 天未访问的图片');
  await refreshStorage();
}
async function onClearAll() {
  if (!confirm('确定要清空所有缩略图缓存吗?'))
    return;
  await clearAllCache();
  toast.success('已清空所有缓存');
  await refreshStorage();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      ref="panelEl"
      class="settings-modal show"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @mousedown="onDragStart"
    >
      <div class="settings-header">
        <h3><i class="fas fa-sliders-h" /> 设置</h3>
        <div class="drag-handle">
          <i class="fas fa-arrows-alt" />
        </div>
      </div>
      <div class="settings-body">
        <div class="setting-item">
          <label>当前路径</label>
          <span class="info-value" style="word-break: break-all; font-size: 12px; text-align: right;">
            {{ fsStore.currentFolder?.path || '—' }}
          </span>
        </div>

        <div class="separator" />

        <div class="setting-item">
          <label>排序方式</label>
          <div class="sort-seg-row">
            <div class="seg-group sort-field-group">
              <button
                v-for="opt in sortFieldOptions"
                :key="opt.value"
                class="seg-btn"
                :class="{ active: sortField === opt.value }"
                @click="setSortField(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
            <div class="seg-group sort-dir-group">
              <button
                v-for="opt in sortDirOptions"
                :key="opt.value"
                class="seg-btn"
                :class="{ active: sortDir === opt.value }"
                :title="opt.title"
                @click="setSortDir(opt.value)"
              >
                <i :class="opt.icon" />
              </button>
            </div>
          </div>
        </div>

        <div class="setting-item">
          <label>卡片样式</label>
          <div class="seg-group">
            <button
              v-for="opt in cardStyleOptions"
              :key="opt.value"
              class="seg-btn"
              :class="{ active: cardStyle === opt.value }"
              @click="setCardStyle(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label>显示列数</label>
          <input v-model.number="colCount" type="range" min="1" max="10" step="1" @change="commitCol">
          <span>{{ colCount }}列</span>
        </div>

        <div class="setting-item">
          <label>缩略图质量</label>
          <input v-model.number="thumbnailSize" type="range" min="100" max="1000" step="50" @change="commitThumb">
          <span>{{ thumbnailSize }}px</span>
        </div>

        <div class="setting-item">
          <label style="cursor: pointer; user-select: none;" @click="toggleScrollZone">
            感应滚动 <i :class="scrollZoneEnabled ? 'fas fa-toggle-on' : 'fas fa-toggle-off'" />
          </label>
          <input
            v-model.number="scrollSpeed"
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            :disabled="!scrollZoneEnabled"
            @change="commitSpeed"
          >
          <span>{{ scrollSpeed.toFixed(1) }}</span>
        </div>

        <div class="separator" />

        <div class="settings-section">
          <h3><i class="fas fa-palette" /> 主题</h3>
          <div class="theme-selector">
            <div
              v-for="t in themeStore.getThemes()"
              :key="t.id"
              class="theme-option"
              :class="{ active: themeStore.currentTheme === t.id }"
              @click="themeStore.applyTheme(t.id)"
            >
              <div class="theme-preview" :class="t.id" />
              <span class="theme-name">{{ t.icon }} {{ t.name }}</span>
            </div>
          </div>
        </div>

        <div class="separator" />

        <div class="setting-item info-item">
          <label>缓存占用</label>
          <span class="info-value">{{ storageText }}</span>
        </div>

        <div class="setting-item button-group">
          <button class="btn-block warning" @click="onRefreshCurrent">
            刷新目录
          </button>
          <button class="btn-block warning" @click="onRedrawCurrent">
            重绘当前
          </button>
          <button class="btn-block danger" @click="onCleanOld">
            清理过期
          </button>
          <button class="btn-block danger" @click="onClearAll">
            清空全部
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 设置弹窗 */
.settings-modal {
    position: fixed;
    top: 80px;
    left: 80px;
    width: 350px;
    background-color: var(--bg-primary);
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    z-index: 200;
    display: none;
    overflow: hidden;
}

.settings-modal.show {
    display: block;
}

.settings-header {
    background-color: var(--sidebar-bg);
    padding: 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    cursor: move;
}

.settings-header h3 {
    font-size: 18px;
    color: white;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
}

.drag-handle {
    color: rgba(255, 255, 255, 0.7);
    cursor: grab;
    padding: 5px;
}

.settings-body {
    padding: 20px;
    max-height: 70vh;
    overflow-y: auto;
}

.setting-item {
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
}

.setting-item:last-child {
    margin-bottom: 0;
}

.info-item {
    background-color: var(--bg-secondary);
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--color-gray-200);
}

.info-value {
    font-family: monospace;
    color: #2C3E50;
    font-weight: bold;
}

.button-group {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.btn-block {
    flex: 1;
    padding: 6px 4px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.2s ease;
    min-width: 50px;
    white-space: nowrap;
}

.btn-block.warning {
    background-color: var(--color-warning);
    color: white;
}

.btn-block.warning:hover {
    background-color: var(--color-warning-dark);
}

.btn-block.danger {
    background-color: var(--color-danger);
    color: white;
}

.btn-block.danger:hover {
    background-color: var(--color-danger-dark);
}

.separator {
    height: 1px;
    background-color: var(--color-gray-200);
    margin: 15px 0;
}

.setting-item label {
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 600;
    min-width: 80px;
}

.setting-item select {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--color-gray-300);
    border-radius: 6px;
    font-size: 14px;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
}

.setting-item input[type="range"] {
    flex: 2;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: #e0e5ec;
    border-radius: 3px;
    outline: none;
}

.setting-item input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #2C3E50;
    cursor: pointer;
    transition: all 0.2s ease;
}

.setting-item span {
    min-width: 50px;
    text-align: right;
    color: var(--text-primary);
    font-weight: bold;
    font-size: 12px;
}

.setting-item label[inactive] {
    color: #95a5a6;
    opacity: 0.7;
}

/* 分段按钮组(互斥档位,如风扇低/中/高档):点一个生效、其余弹起。卡片样式等少量枚举选项用。 */
/* 排序:两段并排——字段组(3 档,占宽多)+ 升降序组(2 档) */
.sort-seg-row {
    display: flex;
    gap: 8px;
    flex: 1;
}

.seg-group.sort-field-group {
    flex: 1; /* 字段段占剩余空间(文字需要宽度) */
}

.seg-group.sort-dir-group {
    flex: 0 0 auto; /* 升降序段按内容宽度(图标,不需要多宽);组合选择器提特异性,盖过 .seg-group{flex:1} */
}

.seg-group.sort-dir-group .seg-btn {
    padding: 7px 9px;
    min-width: 30px;
}

.seg-group {
    flex: 1;
    display: flex;
    border: 1px solid var(--color-gray-300);
    border-radius: 6px;
    overflow: hidden;
}

.seg-btn {
    flex: 1;
    padding: 7px 4px;
    border: none;
    border-right: 1px solid var(--color-gray-300);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.seg-btn:last-child {
    border-right: none;
}

.seg-btn:hover {
    background: var(--bg-secondary);
}

.seg-btn.active {
    background: #2C3E50;
    color: #fff;
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.25);
}

.btn-small {
    background-color: #2C3E50;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 20px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    gap: 5px;
}

.btn-small:hover {
    background-color: rgb(77, 104, 225);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(67, 97, 238, 0.2);
}

/* ========================================
   主题选择器样式
   ======================================== */
.settings-section {
    margin-top: var(--spacing-5);
    padding-top: var(--spacing-5);
    border-top: 1px solid var(--color-gray-200);
}

.settings-section h3 {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-4);
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
}

.settings-section h3 i {
    color: var(--color-primary);
}

.theme-selector {
    display: flex;
    gap: var(--spacing-4);
    flex-wrap: wrap;
}

.theme-option {
    cursor: pointer;
    text-align: center;
    padding: var(--spacing-3);
    border-radius: var(--radius-base);
    transition: all var(--transition-fast);
    border: 2px solid transparent;
    min-width: 80px;
    position: relative;
}

.theme-option:hover {
    background: var(--color-gray-50);
    transform: translateY(-2px);
}

.theme-option.active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    background: rgba(52, 152, 219, 0.1);
}

.theme-option.active::after {
    content: '✓';
    position: absolute;
    top: var(--spacing-1);
    right: var(--spacing-1);
    width: 18px;
    height: 18px;
    background: var(--color-primary);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: bold;
}

.theme-preview {
    width: 60px;
    height: 40px;
    border-radius: var(--radius-sm);
    margin: 0 auto var(--spacing-2);
    border: 2px solid var(--color-gray-300);
    box-shadow: var(--shadow-sm);
    transition: all var(--transition-fast);
}

.theme-option:hover .theme-preview {
    box-shadow: var(--shadow-md);
    transform: scale(1.05);
}

/* 主题预览颜色 */
.theme-preview.ocean {
    background: linear-gradient(135deg, #3498db 0%, #2c3e50 100%);
}

.theme-preview.dark {
    background: linear-gradient(135deg, #4a9eff 0%, #1a1d23 100%);
}

.theme-preview.forest {
    background: linear-gradient(135deg, #27ae60 0%, #1e5128 100%);
}

.theme-name {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    display: block;
    font-weight: var(--font-weight-medium);
}

.theme-option.active .theme-name {
    color: var(--color-primary);
    font-weight: var(--font-weight-semibold);
}
</style>
