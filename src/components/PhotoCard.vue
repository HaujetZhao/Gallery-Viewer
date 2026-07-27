<script setup>
import { ref, computed, nextTick } from 'vue';
import { useThumbnail } from '../composables/useThumbnail';
import { getThumbnailStrategy } from '../services/thumbnail-strategies';
import { formatFileSize, formatDate } from '../utils/format';
import { useContextMenuStore } from '../stores/contextMenu';
import { useHistoryStore } from '../stores/history';
import { useToastStore } from '../stores/uiToast';
import { usePropertiesStore } from '../stores/properties';

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
const history = useHistoryStore();
const toast = useToastStore();
const properties = usePropertiesStore();

// 内联重命名
const editing = ref(false);
const draftName = ref('');
const nameInputEl = ref(null);

function startRename() {
  draftName.value = props.file.name;
  editing.value = true;
  nextTick(() => {
    const dotIdx = props.file.name.lastIndexOf('.');
    if (dotIdx > 0) nameInputEl.value?.setSelectionRange(0, dotIdx);
    else nameInputEl.value?.select();
    nameInputEl.value?.focus();
  });
}
let committing = false; // 防重入(@keyup.enter 提交后 input 卸载又触发 @blur)
async function commitRename() {
  if (committing) return;
  committing = true;
  try {
    const newName = draftName.value.trim();
    editing.value = false;
    if (!newName || newName === props.file.name) return;
    if (/[<>:"/\\|?*]/.test(newName)) {
      toast.error('文件名包含非法字符');
      return;
    }
    await history.renameFile(props.file, newName);
    toast.success('重命名成功(Ctrl+Z 撤销)');
  } catch (e) {
    toast.error('重命名失败: ' + e.message);
  } finally {
    committing = false;
  }
}
function cancelRename() {
  editing.value = false;
}

function onContextmenu(e) {
  contextMenu.show(e.clientX, e.clientY, [
    { label: '属性', icon: 'fas fa-info-circle', action: () => properties.open(props.file) },
    { label: '重命名', icon: 'fas fa-edit', action: startRename },
    { divider: true },
    { label: '删除', icon: 'fas fa-trash-alt', danger: true, action: onDelete },
  ]);
}
async function onDelete() {
  try {
    await history.deleteFile(props.file);
    toast.success('已移动到 .trash 回收站(Ctrl+Z 撤销)');
  } catch (e) {
    toast.error('删除失败: ' + e.message);
  }
}

function onDragstart(e) {
  // 多 MIME:x-photo-path 供内部移动;uri-list/plain/DownloadURL 供拖到外部(桌面下载/浏览器打开/其他应用)
  const dt = e.dataTransfer;
  const url = props.file.blobUrl;
  dt.setData('application/x-photo-path', props.file.path);
  dt.setData('text/uri-list', url);
  dt.setData('text/plain', url);
  dt.setData('DownloadURL', `${props.file.type}:${props.file.name}:${url}`);
  dt.effectAllowed = 'all';
}
</script>

<template>
  <div
    class="photo-card"
    draggable="true"
    @click="$emit('click')"
    @contextmenu.prevent="onContextmenu"
    @dragstart="onDragstart"
  >
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
      <input
        v-if="editing"
        ref="nameInputEl"
        v-model="draftName"
        class="renaming-input"
        @keyup.enter="commitRename"
        @keyup.esc="cancelRename"
        @blur="commitRename"
        @click.stop
      />
      <div v-else class="file-name">{{ file.name }}</div>
    </div>

    <div class="card-info-meta">
      <div class="file-meta">
        <div class="file-size"><i class="fas fa-hdd"></i> {{ formatFileSize(file.size) }}</div>
        <div class="file-date"><i class="far fa-calendar"></i> {{ formatDate(file.lastModified) }}</div>
      </div>
    </div>
  </div>
</template>
