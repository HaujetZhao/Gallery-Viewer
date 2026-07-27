<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useUserSettingsStore } from '../stores/userSettings.js';
import { useThemeStore } from '../stores/theme.js';
import { useFsStore } from '../stores/fs.js';
import { useToastStore } from '../stores/uiToast.js';
import { useStorageEstimate } from '../composables/useStorageEstimate.js';
import { clearAllCache, cleanOldCache } from '../services/db.js';
import { reloadProject } from '../services/filesystem.js';

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

// 打开时刷新存储 + 智能定位(右上角,避开左上齿轮)
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

// ===== 拖拽(按 .settings-header 拖) =====
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

// ESC 关闭
function onKeydown(e) {
  if (e.key === 'Escape' && props.modelValue) emit('update:modelValue', false);
}
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});

// ===== 控件(绑 userSettings) =====
const thumbnailSize = ref(settings.settings.thumbnailSize);
const scrollZoneEnabled = ref(settings.settings.scrollZoneEnabled);
const scrollSpeed = ref(settings.settings.scrollSpeed);

function commitThumbnailSize() {
  settings.set('thumbnailSize', Number(thumbnailSize.value));
}
function toggleScrollZone() {
  scrollZoneEnabled.value = !scrollZoneEnabled.value;
  settings.set('scrollZoneEnabled', scrollZoneEnabled.value);
}
function commitScrollSpeed() {
  settings.set('scrollSpeed', Number(scrollSpeed.value));
}

// ===== 缓存按钮 =====
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
        <div class="setting-item info-item">
          <label>当前路径</label>
          <span class="info-value">{{ fsStore.currentFolder?.path || '—' }}</span>
        </div>

        <div class="separator"></div>

        <div class="setting-item">
          <label>缩略图质量</label>
          <input
            type="range"
            min="100"
            max="1000"
            step="50"
            v-model.number="thumbnailSize"
            @change="commitThumbnailSize"
          />
          <span>{{ thumbnailSize }}px</span>
        </div>

        <div class="setting-item">
          <label :inactive="!scrollZoneEnabled">感应滚动</label>
          <button class="btn-small" @click="toggleScrollZone">
            <i :class="scrollZoneEnabled ? 'fas fa-toggle-on' : 'fas fa-toggle-off'"></i>
            {{ scrollZoneEnabled ? '开' : '关' }}
          </button>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            v-model.number="scrollSpeed"
            @change="commitScrollSpeed"
            :disabled="!scrollZoneEnabled"
          />
          <span>{{ scrollSpeed.toFixed(1) }}</span>
        </div>

        <div class="separator"></div>

        <div class="setting-item" style="justify-content: flex-start">
          <label>主题</label>
        </div>
        <div class="theme-selector">
          <div
            v-for="t in themeStore.getThemes()"
            :key="t.id"
            class="theme-option"
            :class="{ active: themeStore.currentTheme === t.id }"
            @click="themeStore.applyTheme(t.id)"
          >
            <span class="theme-icon">{{ t.icon }}</span>
            <span>{{ t.name }}</span>
          </div>
        </div>

        <div class="separator"></div>

        <div class="setting-item info-item">
          <label>缓存占用</label>
          <span class="info-value">{{ storageText }}</span>
        </div>

        <div class="setting-item button-group">
          <button class="btn-block" @click="onReload">重载项目</button>
          <button class="btn-block warning" @click="onCleanOld">清理过期</button>
          <button class="btn-block danger" @click="onClearAll">清空全部</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.theme-selector {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.theme-option {
  flex: 1;
  padding: 8px;
  border: 2px solid #e1e5eb;
  border-radius: 6px;
  text-align: center;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.theme-option:hover {
  border-color: var(--color-primary, #3498db);
}
.theme-option.active {
  border-color: var(--color-primary, #3498db);
  background: rgba(52, 152, 219, 0.1);
}
.theme-icon {
  display: block;
  font-size: 18px;
  margin-bottom: 4px;
}
</style>
