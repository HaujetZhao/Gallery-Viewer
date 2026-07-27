<script setup>
import { ref } from 'vue';
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
</script>

<template>
  <Teleport to="body">
    <div v-if="modal.isOpen" ref="modalEl" class="modal">
      <div ref="contentEl" class="modal-content">
        <img
          v-if="mediaKind === 'image'"
          ref="mediaEl"
          class="modal-media modal-image"
          :src="modal.currentFile.blobUrl"
          draggable="false"
          alt="Full view"
          @load="onImgLoad"
        >
        <video
          v-else-if="mediaKind === 'video'"
          ref="mediaEl"
          class="modal-media modal-video"
          :src="modal.currentFile.blobUrl"
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
