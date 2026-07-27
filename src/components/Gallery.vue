<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useGallerySearch } from '../composables/useGallerySearch';
import { redrawSignal, unobserveAll } from '../composables/useThumbnail';
import { useFsStore } from '../stores/fs';
import { useModalStore } from '../stores/modal';
import { useUserSettingsStore } from '../stores/userSettings';
import { windowsCompareStrings } from '../utils/format';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const { searchTerm, debouncedTerm, filteredCount, totalCount } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const colCount = computed(() => settings.settings.columnCount);

// 过滤 + 排序(用 debouncedTerm,避免每键全量重排)
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = debouncedTerm.value.toLowerCase();
  let list = files.filter(f => f.path.toLowerCase().includes(term));
  const dir = sortAsc.value ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (sortField.value === 'name')
      return windowsCompareStrings(a.name, b.name) * dir;
    if (sortField.value === 'size')
      return (a.size - b.size) * dir;
    return (a.lastModified - b.lastModified) * dir;
  });
  return list;
});
// 回写计数(搜索框 fixed 右上读)。computed 不应有副作用,用 watch 同步。
watch(
  [displayFiles, () => fsStore.currentFolder?.files],
  ([list, files]) => {
    filteredCount.value = list.length;
    totalCount.value = (files || []).length;
  },
  { immediate: true },
);

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
// 重绘信号:forceRegenerateCurrentThumbnails 删缓存后 ++ → 卡片重挂载重新生成
watch(redrawSignal, () => {
  rerunKey.value++;
});

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
    <div v-if="displayFiles.length === 0" class="empty-state">
      <i class="fas fa-images empty-icon" />
      <p>{{ debouncedTerm ? '没有匹配的文件' : '此文件夹为空' }}</p>
    </div>
    <div v-else class="gallery-grid" :style="{ '--estimated-height': estHeight }">
      <div v-for="(col, i) in columns" :key="i" class="masonry-col">
        <PhotoCard
          v-for="f in col"
          :key="`${f.path}-${rerunKey}`"
          :file="f"
          :target-size="settings.settings.thumbnailSize"
          @click="openPreview(f)"
        />
      </div>
    </div>
  </div>
</template>
