<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useFsStore } from '../stores/fs.js';
import { useUserSettingsStore } from '../stores/userSettings.js';
import { windowsCompareStrings, debounce } from '../utils/format.js';
import { unobserveAll } from '../composables/useThumbnail.js';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();

// 搜索(本地,不持久化)。v-model + 300ms 防抖更新 searchTerm。
const searchInput = ref('');
const searchTerm = ref('');
const onSearch = debounce(() => {
  searchTerm.value = searchInput.value;
}, 300);

// 排序/列数绑 userSettings(持久化)
const sortField = computed({
  get: () => settings.settings.sortField,
  set: (v) => settings.set('sortField', v),
});
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
function toggleSort() {
  settings.set('sortDirection', sortAsc.value ? 'desc' : 'asc');
}
const colCount = computed({
  get: () => settings.settings.columnCount,
  set: (v) => settings.set('columnCount', Number(v)),
});

// 过滤 + 排序
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = searchTerm.value.toLowerCase();
  let list = files.filter((f) => f.path.toLowerCase().includes(term));
  const dir = sortAsc.value ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (sortField.value === 'name') return windowsCompareStrings(a.name, b.name) * dir;
    if (sortField.value === 'size') return (a.size - b.size) * dir;
    return (a.lastModified - b.lastModified) * dir; // date
  });
  return list;
});

// masonry 列分配:index % colCount(等价源码轮询塞列)
const columns = computed(() => {
  const n = colCount.value;
  const cols = Array.from({ length: n }, () => []);
  displayFiles.value.forEach((f, i) => cols[i % n].push(f));
  return cols;
});

// content-visibility 估算高度(源码:(innerWidth-300)/colCount+60)
const estHeight = computed(() => `${Math.round((window.innerWidth - 300) / colCount.value) + 60}px`);

// 切换文件夹时清 observer(避免观察旧卡片)
watch(
  () => fsStore.currentFolder,
  () => unobserveAll(),
);
onBeforeUnmount(() => unobserveAll());
</script>

<template>
  <div class="gallery-container">
    <!-- 控件栏 -->
    <div class="gallery-controls">
      <input
        v-model="searchInput"
        @input="onSearch"
        placeholder="搜索文件名/路径..."
        class="search-input"
      />
      <select v-model="sortField">
        <option value="name">名称</option>
        <option value="size">大小</option>
        <option value="date">修改日期</option>
      </select>
      <button @click="toggleSort" :title="sortAsc ? '升序' : '降序'">
        <i :class="sortAsc ? 'fas fa-arrow-up-short-wide' : 'fas fa-arrow-down-wide-short'"></i>
      </button>
      <label class="col-control">
        列数: {{ colCount }}
        <input type="range" min="1" max="10" :value="colCount" @input="colCount = $event.target.value" />
      </label>
      <span class="filter-count">{{ displayFiles.length }} / {{ fsStore.currentFolder?.files.length || 0 }}</span>
    </div>

    <!-- masonry 网格 -->
    <div class="gallery-grid" :style="{ '--estimated-height': estHeight }">
      <div v-for="(col, i) in columns" :key="i" class="masonry-col">
        <PhotoCard
          v-for="f in col"
          :key="f.path"
          :file="f"
          :target-size="settings.settings.thumbnailSize"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gallery-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-primary, #fff);
  border-bottom: 1px solid var(--color-gray-200, #dee2e6);
  flex-wrap: wrap;
}
.search-input {
  flex: 1;
  min-width: 200px;
  padding: 6px 12px;
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  font-size: 14px;
}
.gallery-controls select {
  padding: 6px 8px;
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
}
.gallery-controls button {
  padding: 6px 10px;
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--color-primary, #3498db);
  cursor: pointer;
}
.col-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}
.filter-count {
  font-size: 13px;
  color: var(--text-muted, #999);
}
</style>
