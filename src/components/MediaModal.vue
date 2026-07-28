<script setup>
import { ref, watch } from 'vue';
import { useModal } from '../composables/useModal';
import { useModalStore } from '../stores/modal';
import AudioPlayer from './AudioPlayer.vue';

const modal = useModalStore();
const modalEl = ref(null);
const contentEl = ref(null);
const mediaEl = ref(null);

const { loading, svgText, mediaKind, isHoveringVideo, onImgLoad } = useModal(
  modalEl,
  contentEl,
  mediaEl,
);

// 图片/视频 src:ensureBlobUrl 取(fromSnapshot 重建的文件 blobUrl 懒,首次显示时单文件 IO)。
const imgSrc = ref('');
watch(
  [() => modal.currentFile, () => mediaKind.value],
  async () => {
    const f = modal.currentFile;
    if (f && (mediaKind.value === 'image' || mediaKind.value === 'video')) {
      imgSrc.value = await f.ensureBlobUrl();
    }
    else {
      imgSrc.value = '';
    }
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="modal.isOpen" ref="modalEl" class="modal">
      <div ref="contentEl" class="modal-content">
        <img
          v-if="mediaKind === 'image'"
          ref="mediaEl"
          class="modal-media modal-image"
          :src="imgSrc"
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
