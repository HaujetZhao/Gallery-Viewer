<script setup>
import { ref, watch } from 'vue';
import { useModal } from '../composables/useModal';
import { triggerRedraw } from '../composables/useThumbnail';
import { detectFileChange, ensureBlobUrl } from '../models/SmartFile';
import { useModalStore } from '../stores/modal';
import AudioPlayer from './AudioPlayer.vue';

const modal = useModalStore();
const modalEl = ref(null);
const contentEl = ref(null);
const mediaEl = ref(null);

const { loading, svgText, mediaKind, isHoveringVideo, onImgLoad, fitted } = useModal(
  modalEl,
  contentEl,
  mediaEl,
);

// 所有类型先 ensureBlobUrl(确保 peek 有 url):
// image/video 直接读 blobUrl 设 imgSrc;audio(AudioPlayer :src)/svg(loadSvg fetch)靠 ensureBlobUrl 后 peek 有 url。
// Phase 2:listFolder 零 getFile → 新文件 blobUrl 可能 null,enrich 完成前打开 Modal 也要懒建。
// R3:顺手 detectFileChange(比 _meta,变则清 md5);关 modal 时若变了 → triggerRedraw 重挂卡片重生缩略图。
const imgSrc = ref('');
let fileChanged = false;
watch(
  [() => modal.currentFile, () => mediaKind.value],
  async () => {
    const f = modal.currentFile;
    if (f) {
      await ensureBlobUrl(f);
      imgSrc.value = (mediaKind.value === 'image' || mediaKind.value === 'video') ? f.blobUrl : '';
      fileChanged = await detectFileChange(f); // 不阻塞大图(ensureBlobUrl 已读完 getFile,peek 复用)
    }
    else {
      if (fileChanged)
        triggerRedraw(); // 关闭时若该图内容变了,重挂卡片让 useThumbnail 按新 md5 重生缩略图
      fileChanged = false;
      imgSrc.value = '';
    }
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="modal.isOpen" ref="modalEl" class="modal" role="dialog" aria-modal="true">
      <div ref="contentEl" class="modal-content">
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
          controls
          @loadeddata="loading = false"
          @mouseenter="isHoveringVideo = true"
          @mouseleave="isHoveringVideo = false"
        />
        <div
          v-else-if="mediaKind === 'svg'"
          ref="mediaEl"
          class="modal-media svg-container"
          v-html="svgText"
        />
        <AudioPlayer
          v-else-if="mediaKind === 'audio'"
          :file="modal.currentFile"
          @prev="modal.prev()"
          @next="modal.next()"
        />
      </div>
      <div v-if="loading" class="loader">
        <i class="fas fa-spinner fa-spin" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 弹窗(原 src/styles/modal.css L1-98,T14c 纯搬家,视觉零变化) */
.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.9);
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
}

.modal.hidden {
    display: none;
}

.modal-content {
    width: 100%;
    height: 100%;
    position: absolute;
    display: flex;
    justify-content: center;
    align-items: center;
}

/* 统一媒体元素样式(.modal-media 跨组件:MediaModal 的 img/video/svg 与 AudioPlayer 根 div 共用,两边 scoped 各一份) */
.modal-media {
    /* 使用绝对定位，不限制尺寸 */
    position: absolute;
    user-select: none;
    /* 变换原点设为中心，用于 scale 和 translate */
    transform-origin: center center;
    /* 提示浏览器优化 scale 和 translate 性能 */
    will-change: scale, translate;
}

/* 图片特定样式 */
#modalImage,
.modal-image {
    /* 取消 Tailwind preflight 的 img{max-width:100%} 钳制:modal 图片由 JS 设 naturalWidth 像素
       + transform scale 适配视口;若被 max-width:100% 钳到容器宽(高度仍是满 naturalHeight)
       → 大图被压成高瘦长条(T09 引入 Tailwind 后的回归,b13c89a 修)。本项目 CSS 非 layer,级联优先于 @layer base。 */
    max-width: none;
    -webkit-user-drag: none;
    transition: filter 0.3s ease;
    /* 允许接收鼠标事件，包括右键菜单 */
    pointer-events: auto;
}

/* SVG 容器样式 */
.svg-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* svg 由 v-html 注入(无 data-v),必须 :deep 穿透 scoped,否则 svg 样式丢失 */
.svg-container :deep(svg) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
    pointer-events: none;
    user-select: none;
}

/* 视频样式 */
.modal-video {
    max-width: 90vw;
    max-height: 90vh;
    outline: none;
}

/* 注:原 .modal-audio(L80) 为死代码——audio 已走 AudioPlayer 组件,grep 全 src 无 class="modal-audio"(仅 modal-audio-player),删而非搬 */

.loader {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #2C3E50;
    font-size: 20px;
    z-index: 10;
}

.loader.hidden {
    display: none;
}
</style>
