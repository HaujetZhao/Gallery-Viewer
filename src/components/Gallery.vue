<script setup>
import { useWindowVirtualizer } from '@tanstack/vue-virtual';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useGallerySearch } from '../composables/useGallerySearch';
import { redrawSignal, unobserveAll } from '../composables/useThumbnail';
import { useFsStore } from '../stores/fs';
import { useModalStore } from '../stores/modal';
import { useUserSettingsStore } from '../stores/userSettings';
import { windowsCompareStrings } from '../utils/format';
import { chunkRows, computeRowHeight } from '../utils/gallery-layout';
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
    // enrich 前 size/lastModified undefined → 兜底排末尾(enrich 写 _meta 后响应式重排)
    if (sortField.value === 'size')
      return ((a.size ?? Infinity) - (b.size ?? Infinity)) * dir;
    return ((a.lastModified ?? Infinity) - (b.lastModified ?? Infinity)) * dir;
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

// 行优先切片:每行 colCount 张,供 virtualizer 按行窗口化。
const rows = computed(() => chunkRows(displayFiles.value, colCount.value));

// 行高 = 列宽(thumbnail aspect-ratio 1/1)+ 行间 gap。
// 桌面 gap 15 / 移动 gap 5,与 gallery.css 的 .gallery-row gap 一致。
const DESKTOP_GAP = 15;
const MOBILE_GAP = 5;
function currentGap() {
  return window.matchMedia('(max-width: 768px)').matches ? MOBILE_GAP : DESKTOP_GAP;
}

const gridRef = ref(null);
const rowHeight = ref(300); // 初值;ResizeObserver 实测后覆盖(弃旧 estHeight 公式)

// 整页滚动:用 useWindowVirtualizer(window 版,observe window 的 resize/scroll 事件,
// 而非 ResizeObserver.observe(window)——后者因 window 非 Element 会抛错)。固定行高,无需 measureElement。
const virtualizer = useWindowVirtualizer({
  get count() { return rows.value.length; },
  estimateSize: () => rowHeight.value,
  overscan: 4, // 4 行 ≈ 1200px,覆盖 useThumbnail observer 的 rootMargin(100px)
});
// 行高变化 → 重算 getTotalSize,track 高度跟随
watch(rowHeight, () => virtualizer.value?.measure());

function measureRowHeight() {
  const el = gridRef.value;
  if (!el)
    return;
  rowHeight.value = computeRowHeight(el.clientWidth, colCount.value, currentGap());
}

let ro = null;
// gridRef 在 v-else(有文件)才渲染:出现时首次 measure + observe;卸载时 disconnect。
watch(gridRef, (el) => {
  if (!el || typeof ResizeObserver === 'undefined')
    return;
  measureRowHeight();
  ro?.disconnect();
  ro = new ResizeObserver(measureRowHeight);
  ro.observe(el);
});
// 列数变化(宽度不变但列宽变)也要重测
watch(colCount, () => measureRowHeight());

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
onBeforeUnmount(() => {
  unobserveAll();
  ro?.disconnect();
});
</script>

<template>
  <div id="galleryContainer" class="gallery-container">
    <div v-if="displayFiles.length === 0" class="empty-state">
      <i class="fas fa-images empty-icon" />
      <p>{{ debouncedTerm ? '没有匹配的文件' : '此文件夹为空' }}</p>
    </div>
    <div v-else ref="gridRef" class="gallery-grid">
      <div class="gallery-track" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="vi in virtualizer.getVirtualItems()"
          :key="vi.key"
          class="gallery-row"
          :style="{ transform: `translateY(${vi.start}px)` }"
        >
          <PhotoCard
            v-for="(f, c) in rows[vi.index]"
            :key="`${f.path}-${rerunKey}-${c}`"
            :file="f"
            :target-size="settings.settings.thumbnailSize"
            @click="openPreview(f)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
