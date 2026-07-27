<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useFsStore } from '../stores/fs.js';
import { useUserSettingsStore } from '../stores/userSettings.js';
import { useModalStore } from '../stores/modal.js';
import { useGallerySearch } from '../composables/useGallerySearch.js';
import { windowsCompareStrings } from '../utils/format.js';
import { unobserveAll } from '../composables/useThumbnail.js';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const { searchTerm, filteredCount, totalCount } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const colCount = computed(() => settings.settings.columnCount);

// 过滤 + 排序
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = searchTerm.value.toLowerCase();
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

function openPreview(file) {
  modal.open(file, displayFiles.value);
}

watch(
  () => fsStore.currentFolder,
  () => {
    unobserveAll();
    searchTerm.value = ''; // 切文件夹清搜索
  },
);
onBeforeUnmount(() => unobserveAll());
</script>

<template>
  <div id="galleryContainer" class="gallery-container">
    <div class="gallery-grid" :style="{ '--estimated-height': estHeight }">
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
