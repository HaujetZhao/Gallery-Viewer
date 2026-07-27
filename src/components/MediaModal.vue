<script setup>
import { ref } from 'vue';
import { useModalStore } from '../stores/modal.js';
import { useModal } from '../composables/useModal.js';

const modal = useModalStore();
const modalEl = ref(null);
const contentEl = ref(null);
const mediaEl = ref(null);

const { loading, svgText, mediaKind, isHoveringVideo, onImgLoad, copyCurrent } = useModal(
  modalEl,
  contentEl,
  mediaEl,
);
</script>

<template>
  <Teleport to="body">
    <div v-if="modal.isOpen" class="modal" ref="modalEl">
      <div class="modal-content" ref="contentEl">
        <img
          v-if="mediaKind === 'image'"
          ref="mediaEl"
          class="modal-media modal-image"
          :src="modal.currentFile.blobUrl"
          draggable="false"
          alt="Full view"
          @load="onImgLoad"
        />
        <video
          v-else-if="mediaKind === 'video'"
          ref="mediaEl"
          class="modal-media modal-video"
          :src="modal.currentFile.blobUrl"
          controls
          @mouseenter="isHoveringVideo = true"
          @mouseleave="isHoveringVideo = false"
        />
        <div
          v-else-if="mediaKind === 'svg'"
          ref="mediaEl"
          class="modal-media svg-container"
          v-html="svgText"
        ></div>
        <audio
          v-else-if="mediaKind === 'audio'"
          :src="modal.currentFile.blobUrl"
          controls
          autoplay
        ></audio>
      </div>
      <div v-if="loading" class="loader">
        <i class="fas fa-spinner fa-spin"></i>
      </div>
    </div>
  </Teleport>
</template>
