<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useFsStore } from '../stores/fs';
import { useUserSettingsStore } from '../stores/userSettings';
import { useModalStore } from '../stores/modal';
import { useGallerySearch } from '../composables/useGallerySearch';
import { windowsCompareStrings } from '../utils/format';
import { unobserveAll } from '../composables/useThumbnail';
import { refreshFolder, reloadProject } from '../services/filesystem';
import { useToastStore } from '../stores/uiToast';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const toast = useToastStore();
const { searchTerm, debouncedTerm, filteredCount, totalCount } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const colCount = computed(() => settings.settings.columnCount);

// 过滤 + 排序(用 debouncedTerm,避免每键全量重排)
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = debouncedTerm.value.toLowerCase();
  let list = files.filter((f) => f.path.toLowerCase().includes(term));
  const dir = sortAsc.value ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (sortField.value === 'name') return windowsCompareStrings(a.name, b.name) * dir;
    if (sortField.value === 'size') return (a.size - b.size) * dir;
    return (a.lastModified - b.lastModified) * dir;
  });
  // 回写计数(搜索框 fixed 右上读)
  filteredCount.value = list.length;
  totalCount.value = files.length;
  return list;
});

const columns = computed(() => {
  const n = colCount.value;
  const cols = Array.from({ length: n }, () => []);
  displayFiles.value.forEach((f, i) => cols[i % n].push(f));
  return cols;
});

const estHeight = computed(() => `${Math.round((window.innerWidth - 300) / colCount.value) + 60}px`);

const rerunKey = ref(0);
watch(
  () => settings.settings.thumbnailSize,
  () => {
    rerunKey.value++;
    unobserveAll();
  },
);

// 刷新当前目录:ALL_MEDIA 重载项目,否则重扫当前文件夹(捕获外部增删改)
const refreshing = ref(false);
async function onRefresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    if (fsStore.currentFolder === fsStore.allMediaFolder) await reloadProject();
    else await refreshFolder(fsStore.currentFolder);
  } catch (e) {
    toast.error('刷新失败: ' + e.message);
  } finally {
    refreshing.value = false;
  }
}

function openPreview(file) {
  modal.open(file, displayFiles.value);
}

watch(
  () => fsStore.currentFolder,
  () => {
    unobserveAll();
    searchTerm.value = '';
    debouncedTerm.value = ''; // 立即清,不等 debounce
  },
);
onBeforeUnmount(() => unobserveAll());
</script>

<template>
  <div id="galleryContainer" class="gallery-container">
    <div class="gallery-toolbar">
      <button class="gallery-refresh-btn" :disabled="refreshing" @click="onRefresh" title="刷新当前目录">
        <i class="fas fa-sync-alt" :class="{ 'fa-spin': refreshing }"></i> 刷新
      </button>
    </div>
    <div v-if="displayFiles.length === 0" class="empty-state">
      <i class="fas fa-images empty-icon"></i>
      <p>{{ debouncedTerm ? '没有匹配的文件' : '此文件夹为空' }}</p>
    </div>
    <div v-else class="gallery-grid" :style="{ '--estimated-height': estHeight }">
      <div v-for="(col, i) in columns" :key="i" class="masonry-col">
        <PhotoCard
          v-for="f in col"
          :key="f.path + '-' + rerunKey"
          :file="f"
          :target-size="settings.settings.thumbnailSize"
          @click="openPreview(f)"
        />
      </div>
    </div>
  </div>
</template>
