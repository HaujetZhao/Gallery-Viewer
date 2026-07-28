<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { openFolderPicker, switchToRoot } from '../services/filesystem';
import * as handleStore from '../services/handleStore';
import { clearScan } from '../services/scanCache';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { formatRelativeTime } from '../utils/format';

const rootStore = useRootStore();
const fsStore = useFsStore();
const open = ref(false);

const currentName = computed(() => {
  const r = rootStore.roots.find(it => it.id === rootStore.currentRootId);
  return r?.name || '未选择';
});

function toggle() {
  open.value = !open.value;
}
function close() {
  open.value = false;
}
async function onSwitch(id) {
  close();
  await switchToRoot(id);
}
async function onOpenNew() {
  close();
  await openFolderPicker();
}
async function onRemove(id) {
  await handleStore.remove(id);
  await clearScan(id);
  rootStore.remove(id);
  // 移除的是当前根 → 回启动页
  if (!rootStore.currentRootId) {
    fsStore.rootFolder = null;
    fsStore.currentFolder = null;
  }
}

function onDocClick() {
  if (open.value)
    close();
}
function onKeydown(e) {
  if (e.key === 'Escape' && open.value)
    close();
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="root-switcher">
    <button class="root-current" title="切换文件夹" @click.stop="toggle">
      <i class="fas fa-folder-open" />
      <span class="root-name">{{ currentName }}</span>
      <i class="fas fa-caret-down root-caret" :class="{ open }" />
    </button>
    <div v-if="open" class="root-dropdown" @click.stop>
      <div
        v-for="r in rootStore.roots"
        :key="r.id"
        class="root-item"
        :class="{ active: r.id === rootStore.currentRootId }"
        @click="onSwitch(r.id)"
      >
        <div class="root-item-info">
          <div class="root-item-name">
            <i class="fas fa-folder" /> {{ r.name }}
          </div>
          <div class="root-item-meta">
            {{ r.fileCount || 0 }} 文件 · {{ formatRelativeTime(r.lastUsed) }}
          </div>
        </div>
        <button class="root-remove" title="移除记录" @click.stop="onRemove(r.id)">
          <i class="fas fa-times" />
        </button>
      </div>
      <div class="root-item root-add" @click="onOpenNew">
        <i class="fas fa-plus" /> 打开新文件夹
      </div>
    </div>
  </div>
</template>

<style scoped>
.root-switcher {
  position: relative;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-gray-200, #dee2e6);
}
.root-current {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
  font-size: 13px;
}
.root-current:hover {
  border-color: var(--color-primary, #3498db);
}
.root-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root-caret {
  transition: transform 0.2s;
}
.root-caret.open {
  transform: rotate(180deg);
}
.root-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 10px;
  right: 10px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 50;
  max-height: 60vh;
  overflow-y: auto;
}
.root-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--color-gray-100, #e9ecef);
}
.root-item:last-child {
  border-bottom: none;
}
.root-item:hover {
  background: var(--bg-secondary, #f5f7fa);
}
.root-item.active {
  background: var(--bg-tertiary, #ecf0f1);
}
.root-item-info {
  flex: 1;
  min-width: 0;
}
.root-item-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root-item-meta {
  font-size: 11px;
  color: var(--text-muted, #999);
}
.root-remove {
  border: none;
  background: transparent;
  color: var(--text-muted, #999);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.root-remove:hover {
  color: var(--color-danger, #e74c3c);
  background: var(--bg-tertiary, #ecf0f1);
}
.root-add {
  color: var(--color-primary, #3498db);
  font-weight: 500;
  justify-content: center;
}
</style>
