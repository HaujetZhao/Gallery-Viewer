<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useUserSettingsStore } from '../stores/userSettings';
import { useThemeStore } from '../stores/theme';
import { useFsStore } from '../stores/fs';
import { useToastStore } from '../stores/uiToast';
import { useStorageEstimate } from '../composables/useStorageEstimate';
import { clearAllCache, cleanOldCache } from '../services/db';
import { reloadProject } from '../services/filesystem';

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
      left.value = Math.max(80, window.innerWidth - 370);
      top.value = 80;
    }
  },
);

// 拖拽
let dragOffset = null;
function onDragStart(e) {
  if (!e.target.closest('.settings-header')) return;
  e.preventDefault();
  const rect = panelEl.value.getBoundingClientRect();
  dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}
function onDragMove(e) {
  if (!dragOffset) return;
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

function onKeydown(e) {
  if (e.key === 'Escape' && props.modelValue) emit('update:modelValue', false);
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});

// 控件(本地 ref + change 提交 userSettings)
const sortField = ref(settings.settings.sortField);
const sortAsc = ref(settings.settings.sortDirection === 'asc');
const colCount = ref(settings.settings.columnCount);
const thumbnailSize = ref(settings.settings.thumbnailSize);
const scrollZoneEnabled = ref(settings.settings.scrollZoneEnabled);
const scrollSpeed = ref(settings.settings.scrollSpeed);

function commitSort() {
  settings.set('sortField', sortField.value);
}
function toggleSort() {
  sortAsc.value = !sortAsc.value;
  settings.set('sortDirection', sortAsc.value ? 'asc' : 'desc');
}
function commitCol() {
  settings.set('columnCount', Number(colCount.value));
}
function commitThumb() {
  settings.set('thumbnailSize', Number(thumbnailSize.value));
}
function toggleScrollZone() {
  scrollZoneEnabled.value = !scrollZoneEnabled.value;
  settings.set('scrollZoneEnabled', scrollZoneEnabled.value);
}
function commitSpeed() {
  settings.set('scrollSpeed', Number(scrollSpeed.value));
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
  if (!confirm('确定要清空所有缩略图缓存吗?')) return;
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
      :style="{ left: left + 'px', top: top + 'px' }"
      @mousedown="onDragStart"
    >
      <div class="settings-header">
        <h3><i class="fas fa-sliders-h"></i> 设置</h3>
        <div class="drag-handle"><i class="fas fa-arrows-alt"></i></div>
      </div>
      <div class="settings-body">
        <div class="setting-item">
          <label>当前路径</label>
          <span class="info-value" style="word-break: break-all; font-size: 12px; text-align: right;">
            {{ fsStore.currentFolder?.path || '—' }}
          </span>
        </div>

        <div class="separator"></div>

        <div class="setting-item">
          <label>排序方式</label>
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <select v-model="sortField" @change="commitSort" style="flex: 1;">
              <option value="name">文件名</option>
              <option value="size">文件大小</option>
              <option value="date">修改日期</option>
            </select>
            <button class="btn-small" @click="toggleSort" :title="sortAsc ? '升序' : '降序'">
              <i :class="sortAsc ? 'fas fa-arrow-down-short-wide' : 'fas fa-arrow-up-wide-short'"></i>
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label>显示列数</label>
          <input type="range" min="1" max="10" step="1" v-model.number="colCount" @change="commitCol" />
          <span>{{ colCount }}列</span>
        </div>

        <div class="setting-item">
          <label>缩略图质量</label>
          <input type="range" min="100" max="1000" step="50" v-model.number="thumbnailSize" @change="commitThumb" />
          <span>{{ thumbnailSize }}px</span>
        </div>

        <div class="setting-item">
          <label style="cursor: pointer; user-select: none;" @click="toggleScrollZone">
            感应滚动 <i :class="scrollZoneEnabled ? 'fas fa-toggle-on' : 'fas fa-toggle-off'"></i>
          </label>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            v-model.number="scrollSpeed"
            @change="commitSpeed"
            :disabled="!scrollZoneEnabled"
          />
          <span>{{ scrollSpeed.toFixed(1) }}</span>
        </div>

        <div class="separator"></div>

        <div class="settings-section">
          <h3><i class="fas fa-palette"></i> 主题</h3>
          <div class="theme-selector">
            <div
              v-for="t in themeStore.getThemes()"
              :key="t.id"
              class="theme-option"
              :class="{ active: themeStore.currentTheme === t.id }"
              @click="themeStore.applyTheme(t.id)"
            >
              <div class="theme-preview" :class="t.id"></div>
              <span class="theme-name">{{ t.icon }} {{ t.name }}</span>
            </div>
          </div>
        </div>

        <div class="separator"></div>

        <div class="setting-item info-item">
          <label>缓存占用</label>
          <span class="info-value">{{ storageText }}</span>
        </div>

        <div class="setting-item button-group">
          <button class="btn-block warning" @click="onReload">重载项目</button>
          <button class="btn-block danger" @click="onCleanOld">清理过期</button>
          <button class="btn-block danger" @click="onClearAll">清空全部</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
