<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useFileActions } from '../composables/useFileActions';
import { hoveredFile, renameTick } from '../composables/useHoveredFile';
import { useThumbnail } from '../composables/useThumbnail';
import { ensureBlobUrl } from '../models/SmartFile';
import { saveFileMeta } from '../services/fileMeta';
import { getThumbnailStrategy } from '../services/thumbnail-strategies';
import { useContextMenuStore } from '../stores/contextMenu';
import { useFavoritesStore } from '../stores/favorites';
import { useModalStore } from '../stores/modal';
import { useNotesStore } from '../stores/notes';
import { useUserSettingsStore } from '../stores/userSettings';
import { formatDate, formatDuration, formatFileSize } from '../utils/format';
import { computeVideoExpand } from '../utils/gallery-layout';
import RenameInput from './RenameInput.vue';

const props = defineProps({
  file: { type: Object, required: true },
  targetSize: { type: Number, default: 400 },
  // 列宽 px(来自 Gallery 实测):视频悬浮等比拓展用。无(0)时拓展几何拿不到 → 保持方形。
  colWidth: { type: Number, default: 0 },
});
const emit = defineEmits(['click']);

const settings = useUserSettingsStore();
const modalStore = useModalStore();
// 卡片信息显示样式(hover/always/...),根元素挂 card-style-<style> class,CSS 据此控制信息条显隐。
const cardStyleClass = computed(() => `card-style-${settings.settings.cardStyle || 'hover'}`);

const strategy = computed(() => getThumbnailStrategy(props.file.type));
const badge = computed(() => strategy.value.getCardBadge());
// 视频预览方式(设置面板):thumbnail=静态缩略图 / hover=悬浮循环 / auto=视口内常驻循环。
const videoPreviewMode = computed(() => settings.settings.videoPreviewMode || 'thumbnail');
const videoPreviewSpeed = computed(() => settings.settings.videoPreviewSpeed ?? 1);
const isVideo = computed(() => strategy.value.name === 'video');
// 视频:仅缩略图模式用 canvas 静态帧;悬浮/自动用 <video> 元素(见模板)。image/audio 恒用 canvas。
const isCanvas = computed(() => {
  if (isVideo.value)
    return videoPreviewMode.value === 'thumbnail';
  return ['image', 'audio'].includes(strategy.value.name);
});

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
const cardEl = ref(null); // 卡片根元素;传给 useThumbnail 供播放观察器观察(见下)。
const { loaded, loading, isVisible } = useThumbnail(mediaEl, props.file, props.targetSize, cardEl);

// 视频预览播/停:只在卡片整卡在视口内播放(isVisible 基于「卡片」——useThumbnail 播放观察器观察卡片而非视频
// 元素);悬浮模式额外要求卡片 hover,auto 视口内即播。媒体展开后出视口不会让 isVisible 翻转(卡片稳定)。
const cardHovered = ref(false);
function updatePlayback() {
  const v = mediaEl.value;
  if (!v || v.tagName !== 'VIDEO')
    return;
  // modal 打开时一律暂停卡片预览(避免与全屏媒体同时播/抢资源),关闭后恢复。
  if (modalStore.isOpen) {
    v.pause?.();
    return;
  }
  if (videoPreviewMode.value === 'thumbnail') {
    v.pause?.();
    return;
  }
  const shouldPlay = isVisible.value && (videoPreviewMode.value === 'auto' || cardHovered.value);
  if (shouldPlay)
    v.play?.().catch(() => {});
  else
    v.pause?.();
}
watch([isVisible, cardHovered, videoPreviewMode], updatePlayback);
// modal 开/关会让卡片预览暂停/恢复。
watch(() => modalStore.isOpen, updatePlayback);
// 应用预览播放速度。⚠️ 设 video.src 会让浏览器把 playbackRate 重置为默认 1,
// 故除"速度变化即时生效"外,还须在每次媒体加载完成(loadedmetadata)后重新应用,否则新开文件夹又回到 1。
function applyPlaybackRate(v) {
  if (v)
    v.playbackRate = videoPreviewSpeed.value;
}
// 播放速度变化即时生效。
watch(videoPreviewSpeed, () => {
  const v = mediaEl.value;
  if (v && v.tagName === 'VIDEO')
    applyPlaybackRate(v);
});
// 读取媒体固有尺寸(原始比例)。返回 {w,h} 或 null。
// VIDEO→videoWidth/Height;CANVAS→canvas.width/height(缩略图原比例 blob 画上后);IMG(GIF)→naturalWidth/Height;
// 其余(svg 的 div)→null(不拓展)。尺寸是 DOM 属性不可响应式,故读后落 ref(mediaDims)触发重算。
function readMediaDims(el) {
  if (!el)
    return null;
  if (el.tagName === 'VIDEO')
    return el.videoWidth ? { w: el.videoWidth, h: el.videoHeight } : null;
  if (el.tagName === 'CANVAS')
    return el.width ? { w: el.width, h: el.height } : null;
  if (el.tagName === 'IMG')
    return el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  return null;
}
// mediaDims:媒体固有尺寸(loaded 后由 readMediaDims 填,驱动悬浮拓展)。声明在 watch 前,供 onloadedmetadata 闭包引用。
const mediaDims = ref(null);
// loaded 就绪 / mediaEl 切换(canvas↔video)时刷新尺寸。视频 loadeddata、图片 drawBlob 后 loaded 即真。
watch([loaded, mediaEl], () => {
  const d = readMediaDims(mediaEl.value);
  if (d)
    mediaDims.value = d;
});

// —— 展开视频底部进度指示(胶囊游标条)——
// duration 优先 video 元素实际值,否则回退 file._meta.duration(时长角标同源)。
const videoProgress = ref(0);
// 视频元素实际时长,由 loadedmetadata/durationchange 事件写入(ref,响应式)。
// 不能直接读 mediaEl.value.duration——DOM 属性不可响应式,metadata 晚于首次渲染加载时若无此 ref,
// computed 不会重算 → 部分视频(其 file-meta 未存 duration)的进度条一直不出现。
const videoDurationState = ref(0);
const videoDuration = computed(() => videoDurationState.value || props.file._meta?.duration || 0);
const videoProgressPct = computed(() => {
  const d = videoDuration.value;
  if (!d)
    return 0;
  return Math.min(100, (videoProgress.value / d) * 100);
});

// —— 平滑播放跟随 + 可交互进度 ——
// 播放中用 rAF 逐帧读 currentTime 更新进度(timeupdate 只 ~4Hz 会跳帧);拖动/点击时暂停跟随,由指针驱动。
const scrubbing = ref(false); // 拖动/点击调整中:rAF 跟随暂停,进度由指针驱动
const progressEl = ref(null); // 进度条容器(取 rect 算比例)
let progressRaf = null;
function startProgressLoop() {
  if (progressRaf)
    return;
  progressRaf = requestAnimationFrame(progressTick);
}
function stopProgressLoop() {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf);
    progressRaf = null;
  }
}
function progressTick() {
  const v = mediaEl.value;
  if (scrubbing.value || !v || v.tagName !== 'VIDEO' || v.paused) {
    stopProgressLoop();
    return;
  }
  videoProgress.value = v.currentTime || 0;
  progressRaf = requestAnimationFrame(progressTick);
}
// 从指针事件算 ratio(相对进度条容器宽),写入 videoProgress(拖动/点击共用)。
function setProgressFromEvent(e) {
  const el = progressEl.value;
  if (!el)
    return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  videoProgress.value = videoDuration.value * ratio;
}
// 指针松开/点击结束:把当前进度提交为视频实际播放位置(seek)。
function commitSeek() {
  const v = mediaEl.value;
  if (v && v.tagName === 'VIDEO' && videoDuration.value)
    v.currentTime = videoProgress.value;
}
function onProgressPointerDown(e) {
  if (!videoDuration.value)
    return;
  e.preventDefault();
  scrubbing.value = true;
  stopProgressLoop();
  setProgressFromEvent(e);
  document.addEventListener('pointermove', onProgressMove);
  document.addEventListener('pointerup', onProgressUp);
}
function onProgressMove(e) {
  if (!scrubbing.value)
    return;
  setProgressFromEvent(e);
}
function onProgressUp() {
  document.removeEventListener('pointermove', onProgressMove);
  document.removeEventListener('pointerup', onProgressUp);
  scrubbing.value = false;
  commitSeek();
  // seek 后视频若仍在播放,恢复 rAF 跟随(否则拖完就停住)。
  const v = mediaEl.value;
  if (v && v.tagName === 'VIDEO' && !v.paused)
    startProgressLoop();
}

// <video> 预览元素挂载时设 src;src 赋值会重置 playbackRate,故 loadedmetadata(加载完成)后重新应用。
// src 就绪后补一次播放判定(hover 早于 src 也能开播)。
watch(mediaEl, (el) => {
  if (!el || el.tagName !== 'VIDEO')
    return;
  videoProgress.value = 0; // 换元素/重绑清零进度
  videoDurationState.value = 0; // 时长待 metadata 加载后写入
  // loadedmetadata:重新应用倍速 + 记录固有尺寸(驱动悬浮拓展)+ 进度/时长归位。
  el.onloadedmetadata = () => {
    applyPlaybackRate(el);
    videoProgress.value = 0;
    videoDurationState.value = el.duration || 0;
    const d = readMediaDims(el);
    if (d)
      mediaDims.value = d;
    // hover 模式不走缩略图抽帧,file-meta 常无 duration;把实时时长补写进持久化 store(幂等,仅缺失时)。
    // 好处:时长角标(右上)有数据 + 下次 ensureFileMetaLoaded 直接读 store,无需重抽。与缩略图抽帧同款写法。
    if (props.file._meta?.duration == null && Number.isFinite(el.duration) && el.duration > 0)
      saveFileMeta(props.file, { duration: el.duration, width: el.videoWidth, height: el.videoHeight });
  };
  // durationchange:容器尺寸等变化时时长可能再次更新(兜底)。
  el.ondurationchange = () => {
    videoDurationState.value = el.duration || 0;
  };
  // 播放 rAF 跟随开始/停止;暂停/快进时对齐进度。不用 timeupdate(只 ~4Hz,跳动)。
  el.onplay = () => startProgressLoop();
  el.onpause = () => {
    stopProgressLoop();
    videoProgress.value = el.currentTime || 0;
  };
  el.onseeked = () => {
    videoProgress.value = el.currentTime || 0;
  };
  ensureBlobUrl(props.file).then(() => {
    if (mediaEl.value === el) {
      el.src = props.file.blobUrl;
      applyPlaybackRate(el);
      updatePlayback();
    }
  });
});

// —— 媒体悬浮满幅等比拓展(cardHoverStyle='expand' 时生效,图片/GIF/视频通用)——
// hover 时把方形缩略图拓成媒体原始比例,露出被 object-fit:cover 裁掉的部分。
// mediaDims 由 readMediaDims 在媒体加载后填入;colWidth 来自 Gallery 实测(prop)。
// 拿不到比例(未加载/解码失败/svg)→ 不拓展,保持方形,优雅降级。
//
// 所有媒体统一:开启 expand 样式 + hover + 尺寸齐即展开。不设「整卡在视口」限制(能悬停即视为可展开)。
const isExpandStyle = computed(() => settings.settings.cardHoverStyle === 'expand');
// 内联重命名(逻辑封装在 RenameInput,父只管显隐)。声明在此(mediaExpand 前),重命名时不展开。
const editing = ref(false);
// 右键菜单 store。声明在 mediaExpand 前供其引用。
const contextMenu = useContextMenuStore();
const mediaExpand = computed(() => {
  // 重命名或右键菜单打开时也不展开——否则展开画面盖住重命名输入框/右键菜单。
  if (!cardHovered.value || editing.value || contextMenu.visible || !isExpandStyle.value || !props.colWidth)
    return null;
  const w = mediaDims.value?.w;
  const h = mediaDims.value?.h;
  if (!w || !h)
    return null;
  const g = computeVideoExpand(props.colWidth, w, h);
  return g.expanded ? g : null;
});
// 拓展几何 → CSS 变量挂到卡片根,scoped CSS 据此设媒体宽高。
// 媒体绝对定位 + 居中,变大后自动保持中心不动(无需手动平移)。
const mediaExpandStyle = computed(() => {
  const g = mediaExpand.value;
  if (!g)
    return null;
  return {
    '--exp-w': `${g.width}px`,
    '--exp-h': `${g.height}px`,
  };
});
// 进度条渲染门:展开样式 + 真实 <video> 元素 + 有时长。缩略图模式的 canvas 静态帧不显示。
// 常驻渲染(即使未展开),以便 hover 时几何从"贴容器方形底"过渡到"贴展开媒体底"——与视频拓宽/拓高同步,
// 而不是白条先以完整展开尺寸出现再等视频长大。
const showProgressBar = computed(() => isExpandStyle.value && mediaEl.value?.tagName === 'VIDEO' && videoDuration.value > 0);

// 内联重命名:逻辑封装在 RenameInput(选区/focus/防重入/校验/history/toast),父只管显隐(editing 声明在上方)
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

// 卸载清理:取消进度 rAF + 移除指针拖动监听(防拖动中卸载泄漏)。
onBeforeUnmount(() => {
  stopProgressLoop();
  document.removeEventListener('pointermove', onProgressMove);
  document.removeEventListener('pointerup', onProgressUp);
});
</script>

<template>
  <div
    ref="cardEl"
    class="photo-card"
    :class="[cardStyleClass, { 'renaming': editing, 'media-expanding': !!mediaExpand, 'hover-expand': isExpandStyle }]"
    :style="mediaExpandStyle"
    tabindex="0"
    role="button"
    :aria-label="`查看 ${file.name}`"
    :draggable="!editing"
    @click="openPreview"
    @keydown.enter="openPreview"
    @keydown.space.prevent="openPreview"
    @contextmenu.prevent="onContextmenu"
    @dragstart="onDragstart"
    @mouseenter="hoveredFile = file; cardHovered = true"
    @mouseleave="hoveredFile = null; cardHovered = false"
  >
    <div class="thumbnail-container">
      <!-- 视频悬浮/自动预览:<video> 循环静音播放,src 由 mediaEl watch 设,播/停由 isVisible+hover 驱动(仅视口内播) -->
      <video
        v-if="isVideo && videoPreviewMode !== 'thumbnail'"
        ref="mediaEl"
        class="thumbnail-video"
        muted
        loop
        playsinline
        preload="metadata"
        :data-loading="loading ? 'true' : 'false'"
      />
      <canvas
        v-else-if="isCanvas"
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

      <!-- 展开视频底部进度指示(胶囊细条 + 游标圆点)。仅展开态且真实 video 元素时出现;
           绝对定位以容器中心为基准,用 --exp-w/--exp-h 对齐到展开媒体底边。
           可交互:pointerdown 起拖动/点击跳进度,拖动时(scrubbing)强制显示圆点。 -->
      <div
        v-if="showProgressBar"
        ref="progressEl"
        class="expand-progress"
        :class="{ dragging: scrubbing }"
        @pointerdown="onProgressPointerDown"
        @click.stop
      >
        <div class="expand-progress-track" />
        <div class="expand-progress-fill" :style="{ width: `${videoProgressPct}%` }" />
        <div class="expand-progress-dot" :style="{ left: `${videoProgressPct}%` }" />
      </div>
    </div>

    <div class="card-info-clip">
      <div class="card-info-filename">
        <div v-if="badge && (badgeText || strategy.name === 'video' || strategy.name === 'audio')" class="media-badge" :class="badge.className">
          <i v-if="strategy.name === 'video' || strategy.name === 'audio'" class="fas" :class="badge.icon" />
          {{ badgeText }}
        </div>
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
            <i class="far fa-calendar" /> {{ formatDate(file.displayDate) }}
          </div>
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

/* 展开模式(:not(.hover-expand))下点击不抬起——展开时媒体盖住邻卡,点按微动让整卡 2px 位移很违和。
   重命名/右键菜单打开时也沿用旧排除(避免盖住输入框/菜单)。 */
.photo-card:active:not(.renaming):not(.context-menu-active):not(.hover-expand) {
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
.thumbnail-img,
.thumbnail-video {
    width: 100%;
    height: 100%;
    display: block;
    background-color: var(--color-gray-50);
    /* 使用CSS变量 */
    transition: opacity var(--transition-base) ease;
    object-fit: cover;
    pointer-events: none;
}

/* 媒体悬浮弹出预览的定位:绝对定位 + 居中(translate -50%,-50%)。
   脱离文档流 → 不参与布局,不会撑高卡片/所在行(否则 grid 行高被拉伸,整行卡片都变高)。
   任何尺寸都以容器中心为基准,中心天然不动。
   max-width:none:Tailwind preflight 的 img,video{max-width:100%} 会把悬浮拓宽的媒体钳到容器宽,
   横向溢出被裁;显式关掉让弹出的媒体能横向溢出覆盖邻卡。
   canvas/img(图片/GIF/静态帧)与 video 同机制,都可按原始比例弹出。 */
.thumbnail-canvas,
.thumbnail-img,
.thumbnail-video {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    max-width: none;
    transition: opacity var(--transition-base) ease, width 0.25s ease, height 0.25s ease;
}

.thumbnail-canvas[data-loading="true"],
.thumbnail-img[data-loading="true"],
.thumbnail-video[data-loading="true"] {
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

/* 媒体类型/时长标识:钉在 card-info-filename 顶部(bottom:100%),跟随其 transform 整体上下——
   非 hover 时 card-info-filename 下藏,badge 恰好落在缩略图右下;hover 时整体上移到文件名条上方。
   上移量天然 = 文件名条高度,无需 JS 测高/硬编码。 */
.media-badge {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 8px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    font-size: 12px;
    font-weight: 500;
    color: white;
    display: flex;
    align-items: baseline;
    gap: 4px;
    z-index: 3;
    backdrop-filter: blur(4px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* 音频图标上色(胶囊黑底上的紫色标识);视频图标沿用白色,文字时长也白 */
.media-badge.badge-audio i {
    color: #b388ff;
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

/* —— 媒体悬浮弹出预览(cardHoverStyle='expand')——
   悬浮时媒体(canvas/img/video)自身变大到原始比例(横屏拓宽/竖屏拓高,由 computeVideoExpand 算 --exp-w/--exp-h),
   绝对定位 + 居中,中心不动,弹出覆盖邻卡与卡内信息条。卡片/容器本身尺寸不变(卡片不动)。
   需卡片与容器 overflow:visible 才能露出弹出的媒体;卡片 hover 已有 z-index:10,弹出层在其 stacking context 内。 */
.photo-card.media-expanding,
.photo-card.media-expanding .thumbnail-container {
    overflow: visible;
    /* overflow:visible 会让 grid 项的自动最小尺寸从 0 变回 min-content(如 nowrap 文件名/aspect-ratio 容器),
       把所在 grid 列撑爆(其余列挤成 0、卡片变得巨大);显式归零,防横向/纵向撑爆。 */
    min-width: 0;
    min-height: 0;
}

/* 展开的卡片提 z-index 高于侧栏(#sidebar z-index:900),让弹出的媒体能盖过侧栏(横向溢出到侧栏区时)。 */
.photo-card.media-expanding {
    z-index: 950;
}

.photo-card.media-expanding .thumbnail-canvas,
.photo-card.media-expanding .thumbnail-img,
.photo-card.media-expanding .thumbnail-video {
    width: var(--exp-w);
    height: var(--exp-h);
    z-index: 20; /* 弹出层盖过卡内 fav/badge/note/info(都在 2~5) */
    border-radius: var(--radius-lg); /* 弹出媒体圆角与卡片一致 */
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); /* 柔和投影:弹出图浮起、与邻卡拉开层次 */
}

/* expand 样式下不「上浮」:hover 不提卡片(仅 z-index:10 仍生效,供弹出层覆盖邻卡)。 */
.photo-card.hover-expand:hover {
    transform: none;
}

/* —— 展开视频底部进度指示(胶囊游标条)——
   进度条常驻渲染(showProgressBar),非展开态贴「容器方形底边」(整宽、内缩圆角)且 opacity:0、不拦点击;
   hover 展开(media-expanding)时几何过渡到「展开媒体底边」(宽 --exp-w、高 --exp-h,左右内缩圆角)。
   width/left/bottom 用与媒体展开一致的 0.25s 过渡 → 白条随视频拓宽/拓高同步动画,不先以完整尺寸出现。
   track/fill 是 2px 圆角细线,filled 段随进度撑宽;游标圆点跟进度平移(hover/拖动时显示)。
   z-index 高于媒体(20)。可点击/拖动调进度(cursor + 接收 pointer 事件;拖动时 .dragging 强制显示圆点)。 */
.expand-progress {
    position: absolute;
    left: var(--radius-lg); /* 非展开:贴容器方形底边,整宽(仅内缩圆角) */
    width: calc(100% - 2 * var(--radius-lg));
    bottom: 0;
    height: 8px;
    cursor: pointer;
    z-index: 21;
    touch-action: none; /* 触摸拖动不被页面滚动劫持 */
    opacity: 0;
    pointer-events: none;
    transition: width 0.25s ease, left 0.25s ease, bottom 0.25s ease, opacity 0.25s ease;
}

/* 展开态:进度条移到展开媒体底边、内缩圆角,随媒体同步显现、可交互。 */
.photo-card.media-expanding .expand-progress {
    left: calc(50% - var(--exp-w, 0) / 2 + var(--radius-lg));
    width: calc(var(--exp-w, 0) - 2 * var(--radius-lg));
    bottom: calc(50% - var(--exp-h, 0) / 2);
    opacity: 1;
    pointer-events: auto;
}

.expand-progress-track,
.expand-progress-fill {
    position: absolute;
    bottom: 0; /* 2px 线贴容器(即媒体)底边,紧贴下边缘;容器高 8px 只给圆点留活动空间 */
    left: 0;
    height: 2px;
    border-radius: 999px;
}

.expand-progress-track {
    width: 100%;
    background: rgba(255, 255, 255, 0.25);
}

.expand-progress-fill {
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.35);
}

.expand-progress-dot {
    position: absolute;
    top: 7px; /* 圆点中心对齐贴底细线的中心(8px 容器内,线占 y6..8,中心 y7) */
    left: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    opacity: 0; /* 默认隐藏,低调;hover 或拖动时显示 */
    transition: opacity 0.15s ease;
}

/* hover 或拖动调整进度时亮出圆点 */
.expand-progress:hover .expand-progress-dot,
.expand-progress.dragging .expand-progress-dot {
    opacity: 1;
}

/* 拖动调整时略微提亮细条已播段,提示可交互 */
.expand-progress:hover .expand-progress-track {
    background: rgba(255, 255, 255, 0.4);
}

/* 卡片信息条剪辑容器:上下两条信息条(文件名/元信息)都包在这一层,overflow:hidden 把滑动隐藏时的
   translateY(±100%) 裁到卡片内。此前靠 .photo-card 的 overflow:hidden 裁,但 expand 样式下卡片要
   overflow:visible 才能露出弹出媒体,信息条滑入的瞬间会在卡片外现形——改为独立裁剪层,与卡片自身
   overflow 解耦。detail 样式下信息区走正常流,override 回 static(见下)。pointer-events:none 防整层
   挡缩略图点击;文件名条自身 re-enable(重命名输入框需交互)。 */
.card-info-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 2;
}

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
    pointer-events: auto; /* 盖过 clip 层 pointer-events:none,文件名/重命名框可交互 */
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
/* 信息块从绝对叠层重排为图下方正常流(relative 仍占流,兼作 badge 的定位锚点);去渐变背景
   (继承卡 bg-primary),整卡一个圆角块。关掉 transform 过渡——hover/always 靠它做滑入,但 detail
   信息区常驻,留着会在切换样式时播一段从 translateY(±100%) 归位的交错位移动画,违和。 */
/* 剪辑容器在 detail 下还原为正常流:信息区在图下方独立可见、无裁切(absolute inset:0 会把信息区
   钉死在卡内盖图,破坏上图下信息布局;overflow:hidden 也会裁掉图下信息)。 */
.photo-card.card-style-detail .card-info-clip {
    position: static;
    inset: auto;
    overflow: visible;
    z-index: auto;
}

.photo-card.card-style-detail .card-info-filename,
.photo-card.card-style-detail .card-info-meta {
    position: relative;
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

/* 文件名左对齐单行省略(detail 信息区第一行);字号沿用 base 14px,与 hover/always 一致 */
.photo-card.card-style-detail .card-info-filename .file-name {
    text-align: left;
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
