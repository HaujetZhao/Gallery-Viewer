<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useOverlay } from '../composables/useOverlay';
import { openFolderPicker, switchToRoot } from '../services/folderActions';
import * as handleStore from '../services/handleStore';
import { clearScan } from '../services/scanCache';
import { useContextMenuStore } from '../stores/contextMenu';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { formatRelativeTime } from '../utils/format';

const rootStore = useRootStore();
const fsStore = useFsStore();
const contextMenu = useContextMenuStore();
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

// R9:右键 header 按钮弹菜单(只"打开新文件夹"一项),免下拉滚底。右键不展开下拉。
// stopPropagation:阻止冒泡到 #sidebar 的 contextmenu(否则 sidebar 会把刚 show 的菜单关掉)。
function onHeaderContextmenu(e) {
  e.stopPropagation();
  contextMenu.show(e.clientX, e.clientY, [
    { label: '打开新文件夹', icon: 'fas fa-folder-plus', action: onOpenNew },
  ]);
}

const dropdownEl = ref(null);
useOverlay({
  isVisible: () => open.value,
  overlayEl: dropdownEl,
  onClose: close,
  outsideClick: true,
});
// 点击仍切换根——浏览器按指针移动区分点击/拖拽。落点按"非被拖项中心"算、移除自身后回插,
// 避开旧 before/after 半区算法的原位 bug(拖到相邻项下半=无响应)。
const dragId = ref(null); // 正被拖的 id;null=常态
const localOrder = ref([]); // 拖拽中的显示顺序(ids)
const orderedRoots = computed(() => {
  if (!dragId.value)
    return rootStore.roots;
  const map = new Map(rootStore.roots.map(r => [r.id, r]));
  return localOrder.value.map(id => map.get(id)).filter(Boolean);
});
function onItemDragstart(e, id) {
  dragId.value = id;
  localOrder.value = rootStore.roots.map(r => r.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id); // Firefox 需 setData 才触发后续 dragover/drop
  // 反馈2:document 级 dragover + dragenter 持续 preventDefault + dropEffect=move。
  // 关键:HTML5 drag 进入新元素先触发 dragenter,它默认显示禁用光标——只有 dragenter 和 dragover
  // 都 preventDefault 才消除"经过条目边缘/元素掠过鼠标"瞬间的禁用光标闪烁。
  document.addEventListener('dragover', onDocDrag);
  document.addEventListener('dragenter', onDocDrag);
}
function onDocDrag(e) {
  if (!dragId.value)
    return;
  e.preventDefault();
  if (e.dataTransfer)
    e.dataTransfer.dropEffect = 'move';
}
// 整个下拉区一个 dragover:实时按指针 y 算落点 → 重排 localOrder → TransitionGroup FLIP 挤位。
function onListDragover(e) {
  if (!dragId.value)
    return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const insertAt = computeInsertIndex(e.clientY);
  const order = localOrder.value.filter(id => id !== dragId.value);
  order.splice(insertAt, 0, dragId.value);
  localOrder.value = order;
}
// 落点索引(相对"非被拖项"序列):指针在某项上半→插它前;都在下→末尾。
function computeInsertIndex(clientY) {
  const el = dropdownEl.value;
  if (!el)
    return 0;
  const items = [...el.querySelectorAll('.root-item:not(.root-add):not(.dragging)')];
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2)
      return i;
  }
  return items.length;
}
function onListDrop(e) {
  if (!dragId.value)
    return;
  e.preventDefault();
  rootStore.reorder(localOrder.value);
  resetDrag();
}
function resetDrag() {
  dragId.value = null;
  localOrder.value = [];
  document.removeEventListener('dragover', onDocDrag);
  document.removeEventListener('dragenter', onDocDrag);
}

// 兜底:组件卸载时若拖拽监听残留(异常中断未触发 dragend),清掉。
onBeforeUnmount(() => {
  document.removeEventListener('dragover', onDocDrag);
  document.removeEventListener('dragenter', onDocDrag);
});
</script>

<template>
  <div class="root-switcher">
    <button class="root-current" title="切换文件夹 / 右键打开新" @click.stop="toggle" @contextmenu.prevent="onHeaderContextmenu">
      <i class="fas fa-folder-open" />
      <span class="root-name">{{ currentName }}</span>
      <i class="fas fa-caret-down root-caret" :class="{ open }" />
    </button>
    <div v-if="open" ref="dropdownEl" class="root-dropdown" @click.stop @dragover="onListDragover" @drop="onListDrop">
      <TransitionGroup name="root-list" tag="div">
        <div
          v-for="r in orderedRoots"
          :key="r.id"
          class="root-item"
          :class="{
            active: r.id === rootStore.currentRootId,
            dragging: dragId === r.id,
          }"
          draggable="true"
          @click="onSwitch(r.id)"
          @dragstart="onItemDragstart($event, r.id)"
          @dragend="resetDrag"
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
      </TransitionGroup>
      <div class="root-item root-add" @click="onOpenNew">
        <i class="fas fa-plus" /> 打开新文件夹
      </div>
    </div>
  </div>
</template>

<style scoped>
.root-switcher {
  position: relative;
  flex: 1;
  min-width: 0;
}
/* 像标题(folder-open 图标 + 名 + 小 caret),但可点:hover 淡白背景提示 */
.root-current {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sidebar-text, #ecf0f1);
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
}
.root-current:hover {
  background: rgba(255, 255, 255, 0.1);
}
.root-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root-caret {
  font-size: 12px;
  opacity: 0.5;
  transition: transform 0.2s, opacity 0.2s;
}
.root-current:hover .root-caret {
  opacity: 1;
}
.root-caret.open {
  transform: rotate(180deg);
  opacity: 1;
}
/* 下拉:白底浮动面板(在深色 sidebar 上对比) */
.root-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--color-gray-300, #ced4da);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
  position: relative;
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
/* R1:被拖项半透明(浏览器幽灵跟随手指);其他项随 localOrder 变化 FLIP 滑动让位(实时挤位) */
.root-item.dragging {
  opacity: 0.4;
}
.root-list-move {
  transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
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
  color: var(--text-primary, #333);
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
