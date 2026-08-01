<script setup>
import { computed, ref, watch } from 'vue';
import { useFileActions } from '../composables/useFileActions';
import { hoveredFile, renameTick } from '../composables/useHoveredFile';
import { useThumbnail } from '../composables/useThumbnail';
import { getThumbnailStrategy } from '../services/thumbnail-strategies';
import { useContextMenuStore } from '../stores/contextMenu';
import { useFavoritesStore } from '../stores/favorites';
import { useModalStore } from '../stores/modal';
import { useNotesStore } from '../stores/notes';
import { useUserSettingsStore } from '../stores/userSettings';
import { formatDate, formatDuration, formatFileSize } from '../utils/format';
import RenameInput from './RenameInput.vue';

const props = defineProps({
  file: { type: Object, required: true },
  targetSize: { type: Number, default: 400 },
});
const emit = defineEmits(['click']);

const settings = useUserSettingsStore();
// 卡片信息显示样式(hover/always/...),根元素挂 card-style-<style> class,CSS 据此控制信息条显隐。
const cardStyleClass = computed(() => `card-style-${settings.settings.cardStyle || 'hover'}`);

const strategy = computed(() => getThumbnailStrategy(props.file.type));
const badge = computed(() => strategy.value.getCardBadge());
const isCanvas = computed(() => ['image', 'video', 'audio'].includes(strategy.value.name));

// 视频/音频:右上 badge 文本显示时长(替代原 'VIDEO'/'AUDIO' 字样),与图标共存,免左下角再叠一个时长。
const badgeText = computed(() => {
  const name = strategy.value.name;
  if (name === 'video' || name === 'audio')
    return props.file.duration ? formatDuration(props.file.duration) : '';
  return badge.value?.text ?? '';
});

// R6:收藏爱心。md5 未算(null)按未收藏且不显示爱心;favorited 依赖 favorites Set(整体替换响应式)。
const favorites = useFavoritesStore();
const hasMd5 = computed(() => !!props.file.md5);
const favorited = computed(() => favorites.isFavorite(props.file.md5));
function onToggleFav() {
  if (props.file.md5)
    favorites.toggle(props.file.md5);
}

// R14:md5 备注。仅当 md5 有备注时,hover 在缩略图中央叠一层备注(CSS 控制显隐,无需算坐标)。
const notes = useNotesStore();
const noteText = computed(() => notes.getNote(props.file.md5));

const mediaEl = ref(null);
const { loaded, loading } = useThumbnail(mediaEl, props.file, props.targetSize);

const contextMenu = useContextMenuStore();

// 内联重命名:逻辑封装在 RenameInput(选区/focus/防重入/校验/history/toast),父只管显隐
const editing = ref(false);
function startRename() {
  editing.value = true;
}

// F2 重命名:App 全局 F2 → requestRename bump;仅 hover 中的这张卡响应(modal 打开时 App 不 bump)。
watch(renameTick, () => {
  if (hoveredFile.value === props.file && !editing.value)
    startRename();
});

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

// click + 键盘(Enter/Space)共用。
// modal 已打开时(焦点可能还停在背后这张卡片上),键盘不再重开 modal——否则空格/回车会把
// 这张卡片重新 open 到前台,顶掉当前正在看的媒体(也会让 modal 的空格=暂停 失效)。
function openPreview() {
  if (useModalStore().isOpen)
    return;
  emit('click');
}
</script>

<template>
  <div
    class="photo-card"
    :class="[cardStyleClass, { renaming: editing }]"
    tabindex="0"
    role="button"
    :aria-label="`查看 ${file.name}`"
    :draggable="!editing"
    @click="openPreview"
    @keydown.enter="openPreview"
    @keydown.space.prevent="openPreview"
    @contextmenu.prevent="onContextmenu"
    @dragstart="onDragstart"
    @mouseenter="hoveredFile = file"
    @mouseleave="hoveredFile = null"
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
        <i class="fas" :class="badge.icon" /> {{ badgeText }}
      </div>

      <!-- R6:收藏爱心(左上角)。已收藏常显实心;未收藏 hover 显空心;md5 未算不显示。@click.stop 防冒泡开 modal -->
      <button
        v-if="hasMd5"
        class="fav-btn"
        :class="{ favorited }"
        title="收藏 (L)"
        @click.stop="onToggleFav"
      >
        <i :class="favorited ? 'fas fa-heart' : 'far fa-heart'" />
      </button>

      <!-- R14:md5 备注 hover 时叠在缩略图中央(CSS 控制显隐) -->
      <div v-if="noteText" class="note-overlay">
        <pre>{{ noteText }}</pre>
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

/* 媒体类型/时长标识:常驻缩略图右下角;hover 时文件名条从底部滑入,badge 同步上移避让。
   z-index 高于文件名条。 */
.media-badge {
    position: absolute;
    bottom: 8px;
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
}
/* hover/renaming/always:文件名条占住底部,badge 上移到其上方。ponytail: 30px 按文件名条高度(~25px)校准。 */
.photo-card:hover .media-badge,
.photo-card.renaming .media-badge,
.photo-card.card-style-always .media-badge {
    transform: translateY(-30px);
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

/* R6:收藏爱心(左上角)。未收藏不显示;已收藏常显实心红、无背景。
   hover 时与 Video 角标同步 translateY(100%) 下移,给顶部 hover 下滑的文件大小/日期让位,不重叠。 */
.fav-btn {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #ff4d6d;
    cursor: pointer;
    z-index: 4;
    opacity: 0;
    padding: 0;
    transition: opacity 0.2s ease, transform 0.3s ease;
}
/* 未收藏不显示,也不拦截点击(避免透明按钮挡着点图开 modal)。收藏走 modal 的 L 键 / 右键菜单。 */
.fav-btn:not(.favorited) {
    pointer-events: none;
}
/* hover 下移(与 badge 同步);未收藏不再显现(沿用 opacity:0) */
.photo-card:hover .fav-btn {
    transform: translateY(100%);
}
.photo-card:hover .fav-btn:hover {
    transform: translateY(100%) scale(1.15);
}
.fav-btn.favorited {
    opacity: 1;
}

/* 红心无背景,在浅色/亮图上靠单向落影增对比:filter drop-shadow 跟随字形 alpha(比 text-shadow 更贴形)。 */
.fav-btn i {
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.7));
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

/* 卡片信息显示样式(由设置 cardStyle 控制,根元素挂 card-style-<style>):
   - hover(默认):上下信息条 hover 滑入、移开隐藏。
   - always:上下信息条常驻显示;右上 badge 与左上爱心也常驻在"被推挤下来"的位置(爱心并常显)。
   - detail:上图下信息整卡——信息条从绝对叠层重排为图下方正常流(文件名+大小日期两行),
     同卡背景一体式圆角块;badge/爱心撤销 hover 下移、常驻图上原位;备注 hover 胶囊保留。
     信息区固定高度,与 gallery-layout.DETAIL_INFO_HEIGHT 对齐(改这里要同步改那个常量)。
     后续新增样式在此扩展。 */
.photo-card.card-style-always .card-info-filename,
.photo-card.card-style-always .card-info-meta {
    transform: translateY(0);
}

.photo-card.card-style-always .fav-btn.favorited {
    opacity: 1;
    transform: translateY(100%);
}

/* —— detail:上图下信息整卡 —— */
/* 信息块从绝对叠层重排为图下方正常流;去渐变背景(继承卡 bg-primary),整卡一个圆角块。
   关掉 transform 过渡——hover/always 靠它做滑入,但 detail 信息区常驻,留着会在切换样式时
   播一段从 translateY(±100%) 归位的交错位移动画,违和。 */
.photo-card.card-style-detail .card-info-filename,
.photo-card.card-style-detail .card-info-meta {
    position: static;
    transform: none;
    background: none;
    color: var(--text-primary);
    z-index: auto;
    transition: none;
}

.photo-card.card-style-detail .card-info-filename {
    padding: 5px 10px 0;
    min-height: 0;
    justify-content: flex-start;
}

.photo-card.card-style-detail .card-info-meta {
    padding: 3px 10px 7px;
}

/* meta 子元素原为白色(叠在图上渐变层时用);detail 下信息区在卡背景上,改主题次级文字色。 */
.photo-card.card-style-detail .card-info-meta .file-meta,
.photo-card.card-style-detail .card-info-meta .file-size,
.photo-card.card-style-detail .card-info-meta .file-date,
.photo-card.card-style-detail .card-info-meta .file-size i,
.photo-card.card-style-detail .card-info-meta .file-date i {
    color: var(--text-secondary);
}

/* 文件名左对齐单行省略(detail 信息区第一行) */
.photo-card.card-style-detail .card-info-filename .file-name {
    text-align: left;
    font-size: 13px;
    color: var(--text-primary);
}

/* detail:信息区在图外(下方独立区),badge 在图右下不与信息区重叠,保持原位不上移。 */
.photo-card.card-style-detail .media-badge,
.photo-card.card-style-detail:hover .media-badge {
    transform: none;
}

/* detail 下爱心原位不下移(无顶部叠层让位);显隐走默认——未收藏隐藏、卡片 hover 显空心,已收藏常显实心。 */
.photo-card.card-style-detail .fav-btn,
.photo-card.card-style-detail:hover .fav-btn {
    transform: none;
}

.photo-card.card-style-detail:hover .fav-btn:hover {
    transform: scale(1.15);
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

/* R14:md5 备注 hover 时居中显示——文字背后一块半透明圆角"药丸",不遮整张图。
   .note-overlay 是透明 flex 居中容器(无背景),<pre> 本身是药丸。 */
.note-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    opacity: 0;
    transition: opacity 0.18s ease;
    pointer-events: none;
}

.photo-card:hover .note-overlay {
    opacity: 1;
}

.note-overlay pre {
    margin: 0;
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
    padding: 8px 14px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 10px;
    color: #fff;
    text-align: center;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.45;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}
</style>
