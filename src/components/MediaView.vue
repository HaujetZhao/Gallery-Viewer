<script setup>
// R12:从 MediaModal 抽出的媒体渲染子组件。按 mediaKind 渲染 image/video/svg/audio。
// 被 MediaModal 的 <KeepAlive :max="10"> 缓存:切走再切回同图瞬开(DOM 复用)、视频 currentTime 隐式保留。
// 激活时通过注入的 mediaApi 注册当前媒体元素 + 触发图片 fit;R5 视频自动播放/时长回填在此。
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { triggerRedraw } from '../composables/useThumbnail';
import { FileTypes } from '../config/file-types';
import { detectFileChange, ensureBlobUrl, getFile } from '../models/SmartFile';
import { saveFileMeta } from '../services/fileMeta';
import { useModalStore } from '../stores/modal';
import { ensureMediaSession } from '../utils/mediaSession';
import AudioPlayer from './AudioPlayer.vue';

const props = defineProps({ file: { type: Object, default: null } });
const modal = useModalStore();

// 从父(MediaModal/useModal)注入:注册当前媒体元素 + 变换/fit + 视频 hover 态。
const mediaApi = inject('modalMedia');

function getKind(type) {
  if (FileTypes.image.svg.includes(type))
    return 'svg';
  if (FileTypes.video.all.includes(type))
    return 'video';
  if (FileTypes.audio.all.includes(type))
    return 'audio';
  return 'image';
}
const mediaKind = computed(() => (props.file ? getKind(props.file.type) : null));

const mediaEl = ref(null); // 本实例的媒体根元素(img/video/svg div)
const imgSrc = ref('');
const svgText = ref('');
const loading = ref(false);
const fitted = ref(false); // T17:fit 完成前隐藏 img,避免巨大原图闪一下
const videoReady = ref(false); // 视频:loadeddata(首帧)前隐藏,避免"小空框→大框→有画面"闪烁
let changeDetected = false; // R3:detectFileChange 检出内容变 → 离开时重挂卡片重生缩略图

// R17:视频的 MediaSession 绑定(音频在 AudioPlayer 内自行绑,因其 <audio> 元素在子组件)。
let msCleanup = null;
function bindMs() {
  unbindMs();
  if (mediaKind.value === 'video' && mediaEl.value)
    msCleanup = ensureMediaSession(mediaEl.value, props.file, { onPrev: () => modal.prev(), onNext: () => modal.next() });
}
function unbindMs() {
  msCleanup?.();
  msCleanup = null;
}

// SVG:读 File 文本 → innerHTML(与缩略图 svg 策略同机制)。peek 池里 File ?? handle.getFile() 兜底,绕开 blobUrl。
async function loadSvg() {
  if (mediaKind.value !== 'svg' || !props.file)
    return;
  try {
    const f = await getFile(props.file);
    svgText.value = await f.text();
  }
  catch (e) {
    console.warn('SVG 加载失败:', e);
  }
  finally {
    loading.value = false; // svg 走 v-html 无 onImgLoad,读完即视为加载完(否则转圈常驻)
  }
}

// R5:视频自动播放——loadedmetadata 后 play();被拦(NotAllowedError)→ 静音续播。顺带回填缺失的 duration。
function tryAutoplay(video) {
  video.play().catch((err) => {
    if (err?.name === 'NotAllowedError') {
      video.muted = true;
      video.play().catch(() => {}); // 静音续播,失败静默
    }
    // AbortError(切换中断)等忽略
  });
}

async function onLoadedMetadata(e) {
  const video = e.target;
  // loading/videoReady 在 onLoadedData(首帧)再清,避免 metadata 后、首帧前露出大空框。
  const f = props.file;
  if (!f)
    return;
  // R5:时长回填(解决 R11 老缓存视频时长为空的边界)。
  // 与 thumbnail-strategies video 策略同一通道:saveFileMeta 填 _meta 运行时缓存 + 落 file-meta store(md5 索引),
  // 跨副本共享、持久化。原直接写 _meta + afterFolderMutation 不走 file-meta store,已统一于此。
  if (f.duration == null && Number.isFinite(video.duration)) {
    await saveFileMeta(f, { duration: video.duration, width: video.videoWidth, height: video.videoHeight });
  }
  tryAutoplay(video);
}

// 视频:首帧就绪 → 隐藏转圈 + 淡入(此时尺寸已定,直接是有画面的大框,无闪烁)。
function onLoadedData() {
  videoReady.value = true;
  loading.value = false;
}

function onImgLoad() {
  loading.value = false;
  if (mediaEl.value)
    mediaApi.setMediaEl(mediaEl.value);
  mediaApi.initializeMediaDisplay();
  fitted.value = true; // fit 完成,可显示(避免 fit 前的巨大原图闪现)
}

// R12:激活(首次挂载 / KeepAlive 重新激活)→ 注册媒体元素 + 重置变换;图片若已 loaded 顺带 fit。
// 音频的 <audio> 元素由 AudioPlayer 自行注册(其 onMounted/onActivated 设 mediaElRef,时序更稳),
// 此处对音频跳过 setMediaEl,避免覆盖。
function activate() {
  if (mediaKind.value !== 'audio')
    mediaApi.setMediaEl(mediaEl.value);
  mediaApi.resetTransform();
  if (
    mediaKind.value === 'image'
    && mediaEl.value?.complete
    && mediaEl.value?.naturalWidth
  ) {
    mediaApi.initializeMediaDisplay();
    fitted.value = true;
    loading.value = false;
  }
  else if (mediaKind.value === 'video' && mediaEl.value?.readyState >= 1) {
    // 缓存视频重新激活:已有数据 → 直接显示(不闪)+ 续播。
    if (mediaEl.value.readyState >= 2) {
      videoReady.value = true;
      loading.value = false;
    }
    tryAutoplay(mediaEl.value);
  }
  // R17:视频激活时绑系统媒体键(切回重绑,与 KeepAlive 生命周期联动)。
  bindMs();
}
onMounted(activate);
onActivated(activate);

// R5 + R3:切走暂停视频/音频;若该图内容变了 → 重挂卡片重生缩略图。
onDeactivated(() => {
  const el = mediaEl.value;
  if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO'))
    el.pause();
  // R17:切走解绑媒体键,避免后台/关闭后仍被耳机控制。
  unbindMs();
  if (changeDetected) {
    triggerRedraw();
    changeDetected = false;
  }
});

// R17:卸载兜底解绑(组件被 KeepAlive 淘汰彻底销毁时)。
onBeforeUnmount(unbindMs);

// ensureBlobUrl + detectFileChange + 按需 svg(搬自 MediaModal)。
watch(
  [() => props.file, mediaKind],
  async () => {
    const f = props.file;
    if (f) {
      await ensureBlobUrl(f);
      imgSrc.value = (mediaKind.value === 'image' || mediaKind.value === 'video') ? f.blobUrl : '';
      const changed = await detectFileChange(f); // 比 _meta,变则清 md5
      if (changed)
        changeDetected = true;
      loading.value = !!mediaKind.value && mediaKind.value !== 'audio';
      fitted.value = false; // 新图先隐藏,等 load+fit
      videoReady.value = false; // 新视频先隐藏,等 loadeddata 首帧
      svgText.value = '';
      if (mediaKind.value === 'svg')
        loadSvg();
    }
    else {
      // file=null(modal 关闭):若该图内容变了 → 重挂卡片重生缩略图
      if (changeDetected) {
        triggerRedraw();
        changeDetected = false;
      }
      imgSrc.value = '';
      svgText.value = '';
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="modal-content-inner">
    <img
      v-if="mediaKind === 'image'"
      ref="mediaEl"
      class="modal-media modal-image"
      :src="imgSrc"
      :style="{ opacity: fitted ? 1 : 0 }"
      draggable="false"
      alt="Full view"
      @load="onImgLoad"
    >
    <video
      v-else-if="mediaKind === 'video'"
      ref="mediaEl"
      class="modal-media modal-video"
      :src="imgSrc"
      :style="{ opacity: videoReady ? 1 : 0 }"
      controls
      @loadedmetadata="onLoadedMetadata"
      @loadeddata="onLoadedData"
    />
    <div
      v-else-if="mediaKind === 'svg'"
      ref="mediaEl"
      class="modal-media svg-container"
      v-html="svgText"
    />
    <AudioPlayer
      v-else-if="mediaKind === 'audio'"
      :file="props.file"
      @prev="modal.prev()"
      @next="modal.next()"
    />
    <div v-if="loading" class="loader">
      <i class="fas fa-spinner fa-spin" />
    </div>
  </div>
</template>

<style scoped>
/* 媒体元素样式(从 MediaModal 平移,与 .modal-media 全局 class 配合) */
/* R12:wrapper 必须是满屏 + flex 居中 + 定位上下文——.modal-media 是 position:absolute,
   绝对元素的静态位置由「最近 flex 父容器」的 justify/align 决定;否则左上角落到视窗中央。 */
.modal-content-inner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-media {
    position: absolute;
    user-select: none;
    transform-origin: center center;
    will-change: scale, translate;
}

.modal-image {
    max-width: none;
    -webkit-user-drag: none;
    transition: filter 0.3s ease;
    pointer-events: auto;
}

.svg-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.svg-container :deep(svg) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
    pointer-events: none;
    user-select: none;
}

.modal-video {
    max-width: 90vw;
    max-height: 90vh;
    max-height: 90dvh;
    outline: none;
    transition: opacity 0.2s ease; /* 首帧就绪后淡入,无空框闪烁 */
}

/* 窄屏:去掉 90vw 宽度上限,视频可占满 modal 宽度(小屏 90vw 显窄) */
/* 响应式断点字面量须与 src/utils/breakpoints.js 的 BREAKPOINTS 保持一致 */
@media (max-width: 768px) {
    .modal-video {
        max-width: 100%;
    }
}

.loader {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #2C3E50;
    font-size: 20px;
    z-index: 10;
}
</style>
