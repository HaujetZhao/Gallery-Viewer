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
      <object v-else ref="mediaEl" class="thumbnail-svg" type="image/svg+xml" />

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
