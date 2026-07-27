<script setup>
import { ref, computed } from 'vue';
import { useThumbnail } from '../composables/useThumbnail.js';
import { getThumbnailStrategy } from '../services/thumbnail-strategies.js';
import { formatFileSize, formatDate } from '../utils/format.js';

const props = defineProps({
  file: { type: Object, required: true },
  targetSize: { type: Number, default: 400 },
});

defineEmits(['click']);

const strategy = computed(() => getThumbnailStrategy(props.file.type));
const badge = computed(() => strategy.value.getCardBadge());
// image/video/audio → canvas;gif → img;svg → object
const isCanvas = computed(() => ['image', 'video', 'audio'].includes(strategy.value.name));

const mediaEl = ref(null);
const { loaded, loading } = useThumbnail(mediaEl, props.file, props.targetSize);
</script>

<template>
  <div class="photo-card" draggable="true" @click="$emit('click')">
    <div class="thumbnail-container">
      <canvas
        v-if="isCanvas"
        ref="mediaEl"
        class="thumbnail-canvas"
        :data-loading="loading ? 'true' : 'false'"
      ></canvas>
      <img
        v-else-if="strategy.name === 'gif'"
        ref="mediaEl"
        class="thumbnail-img"
        :data-loading="loading ? 'true' : 'false'"
      />
      <object v-else ref="mediaEl" class="thumbnail-svg" type="image/svg+xml"></object>

      <div v-if="!loaded" class="loading-indicator">
        <i class="fas fa-spinner" :class="{ 'fa-spin': loading }"></i>
      </div>

      <div v-if="badge" class="media-badge" :class="badge.className">
        <i class="fas" :class="badge.icon"></i> {{ badge.text }}
      </div>
    </div>

    <div class="card-info-filename">
      <div class="file-name">{{ file.name }}</div>
    </div>

    <div class="card-info-meta">
      <div class="file-meta">
        <div class="file-size"><i class="fas fa-hdd"></i> {{ formatFileSize(file.size) }}</div>
        <div class="file-date"><i class="far fa-calendar"></i> {{ formatDate(file.lastModified) }}</div>
      </div>
    </div>
  </div>
</template>
