<script setup>
import { computed, ref } from 'vue';
import { useFileActions } from '../composables/useFileActions';
import { useThumbnail } from '../composables/useThumbnail';
import { getThumbnailStrategy } from '../services/thumbnail-strategies';
import { useContextMenuStore } from '../stores/contextMenu';
import { formatDate, formatFileSize } from '../utils/format';
import RenameInput from './RenameInput.vue';

const props = defineProps({
  file: { type: Object, required: true },
  targetSize: { type: Number, default: 400 },
});
const emit = defineEmits(['click']);

const strategy = computed(() => getThumbnailStrategy(props.file.type));
const badge = computed(() => strategy.value.getCardBadge());
const isCanvas = computed(() => ['image', 'video', 'audio'].includes(strategy.value.name));

const mediaEl = ref(null);
const { loaded, loading } = useThumbnail(mediaEl, props.file, props.targetSize);

const contextMenu = useContextMenuStore();

// 内联重命名:逻辑封装在 RenameInput(选区/focus/防重入/校验/history/toast),父只管显隐
const editing = ref(false);
function startRename() {
  editing.value = true;
}

// 统一文件右键菜单(属性/重命名/删除);重命名回调触发本组件显示 RenameInput
const { fileMenu } = useFileActions(startRename);

function onContextmenu(e) {
  contextMenu.show(e.clientX, e.clientY, fileMenu(props.file));
}

function onDragstart(e) {
  // x-photo-path 供内部移动;uri-list/plain/DownloadURL 供拖到外部。
  // blobUrl 可能 null(fromSnapshot 重建懒建);dragstart 同步不能 await,此时仅内部移动可用,外部 MIME 跳过。
  const dt = e.dataTransfer;
  const url = props.file.blobUrl;
  dt.setData('application/x-photo-path', props.file.path);
  if (url) {
    dt.setData('text/uri-list', url);
    dt.setData('text/plain', url);
    dt.setData('DownloadURL', `${props.file.type}:${props.file.name}:${url}`);
  }
  dt.effectAllowed = 'all';
}

// click + 键盘(Enter/Space)共用
function openPreview() {
  emit('click');
}
</script>

<template>
  <div
    class="photo-card"
    tabindex="0"
    role="button"
    :aria-label="`查看 ${file.name}`"
    draggable="true"
    @click="openPreview"
    @keydown.enter="openPreview"
    @keydown.space.prevent="openPreview"
    @contextmenu.prevent="onContextmenu"
    @dragstart="onDragstart"
  >
    <div class="thumbnail-container">
      <canvas
        v-if="isCanvas"
        ref="mediaEl"
        class="thumbnail-canvas"
        :data-loading="loading ? 'true' : 'false'"
      />
      <img
        v-else-if="strategy.name === 'gif'"
        ref="mediaEl"
        class="thumbnail-img"
        :data-loading="loading ? 'true' : 'false'"
      >
      <div
        v-else
        ref="mediaEl"
        class="thumbnail-svg"
        :data-loading="loading ? 'true' : 'false'"
      />

      <div v-if="!loaded" class="loading-indicator">
        <i class="fas fa-spinner" :class="{ 'fa-spin': loading }" />
      </div>

      <div v-if="badge" class="media-badge" :class="badge.className">
        <i class="fas" :class="badge.icon" /> {{ badge.text }}
      </div>
    </div>

    <div class="card-info-filename">
      <RenameInput v-if="editing" :file="props.file" @done="editing = false" />
      <div v-else class="file-name">
        {{ file.name }}
      </div>
    </div>

    <div class="card-info-meta">
      <div class="file-meta">
        <div class="file-size">
          <i class="fas fa-hdd" /> {{ formatFileSize(file.size) }}
        </div>
        <div class="file-date">
          <i class="far fa-calendar" /> {{ formatDate(file.lastModified) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 图片卡片 */
.photo-card {
    background-color: var(--bg-primary);
    /* 使用CSS变量 */
    border-radius: var(--radius-lg);
    /* 使用CSS变量 */
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    /* 使用CSS变量 */
    border: none;
    transition: transform var(--transition-base) cubic-bezier(0.25, 0.8, 0.25, 1),
        box-shadow var(--transition-base) cubic-bezier(0.25, 0.8, 0.25, 1);
    cursor: pointer;
    position: relative;
    user-select: none;
    width: 100%;
}

.photo-card:hover,
.photo-card.renaming,
.photo-card.context-menu-active {
    transform: translateY(-6px);
    box-shadow: var(--shadow-lg);
    /* 使用CSS变量 */
    z-index: 10;
}

.photo-card:active:not(.renaming):not(.context-menu-active) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transition-duration: 0.1s;
}

.photo-card.dragging {
    opacity: 0.4;
    border: 2px dashed #2C3E50;
}

/* 缩略图 */
.thumbnail-container {
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    background-color: var(--color-gray-50);
    /* 使用CSS变量 */
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}

.thumbnail-canvas,
.thumbnail-img {
    width: 100%;
    height: 100%;
    display: block;
    background-color: var(--color-gray-50);
    /* 使用CSS变量 */
    transition: opacity var(--transition-base) ease;
    object-fit: cover;
    pointer-events: none;
}

.thumbnail-canvas[data-loading="true"],
.thumbnail-img[data-loading="true"] {
    opacity: 0.5;
}

/* 加载指示器 */
.loading-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-primary);
    /* 使用CSS变量 */
    font-size: 20px;
    z-index: 10;
    pointer-events: none;
}

.loading-indicator i {
    transition: none;
}

.loading-indicator.hidden {
    display: none !important;
}

/* 媒体类型标识 */
.media-badge {
    position: absolute;
    top: calc(8px);
    right: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: white;
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 3;
    backdrop-filter: blur(4px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: transform 0.3s ease;
    /* transform: translateY(-100%); */
}

.photo-card:hover .media-badge,
.photo-card.renaming .media-badge {
    transform: translateY(100%);
}

.badge-gif {
    background: rgba(156, 39, 176, 0.9);
}

.badge-video {
    background: rgba(244, 67, 54, 0.9);
}

.badge-audio {
    background: rgba(103, 58, 183, 0.9);
}

/* SVG 缩略图:inline 注入(thumbnail-strategies fetch+innerHTML,与 modal 同机制);
   SVG 元素无 data-v,用 :deep 穿透控制尺寸(contain,完整显示 SVG 内容),
   绕开 <img>(拒绝含脚本 SVG)与 <object>(像素尺寸渲染异常)的坑 */
.thumbnail-svg {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background-color: var(--color-gray-50);
    pointer-events: none;
}

.thumbnail-svg :deep(svg) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
}

/* 卡片信息 */
.card-info-filename {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 5px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.9));
    color: white;
    font-size: 12px;
    transform: translateY(100%);
    transition: transform 0.3s ease;
    z-index: 2;
    min-height: 25px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.photo-card:hover .card-info-filename,
.photo-card.renaming .card-info-filename {
    transform: translateY(0);
}

.card-info-meta {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 5px 5px;
    background: linear-gradient(rgba(0, 0, 0, 0.6), transparent);
    color: white;
    font-size: 11px;
    transform: translateY(-100%);
    transition: transform 0.3s ease;
    z-index: 2;
    pointer-events: none;
}

.photo-card:hover .card-info-meta,
.photo-card.renaming .card-info-meta {
    transform: translateY(0);
}

.file-name {
    font-weight: 600;
    color: #ffffff;
    font-size: 14px;
    line-height: 1.4;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.file-meta {
    display: flex;
    justify-content: space-between;
    opacity: 0.9;
    padding-right: 5px;
}

.file-size,
.file-date {
    display: flex;
    align-items: center;
    gap: 4px;
}

.file-size i,
.file-date i {
    color: #ffffff;
    font-size: 10px;
}
</style>
