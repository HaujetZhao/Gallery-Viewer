<script setup>
import { ref } from 'vue';
import { collectAllFiles } from '../models/SmartFolder';
import { handleDeleteFolder } from '../services/fileOps';
import { handleFolderClick } from '../services/folderActions';
import { useContextMenuStore } from '../stores/contextMenu';
import { useFsStore } from '../stores/fs';
import { useHistoryStore } from '../stores/history';
import { useToastStore } from '../stores/uiToast';

defineOptions({ name: 'SidebarTreeItem' });

const props = defineProps({
  folder: { type: Object, required: true },
  isRoot: { type: Boolean, default: false },
});

const fsStore = useFsStore();
const contextMenu = useContextMenuStore();
const history = useHistoryStore();
const toast = useToastStore();
const dragOver = ref(false);

async function onClick() {
  await handleFolderClick(props.folder);
}
function toggle(e) {
  e.stopPropagation();
  props.folder.toggleExpanded();
}

function onContextmenu(e) {
  // 根目录也弹同款菜单,但"删除文件夹"禁用(disabled:true 灰显不可点)。
  e.preventDefault();
  e.stopPropagation();
  contextMenu.show(e.clientX, e.clientY, [
    { label: '删除文件夹', icon: 'fas fa-trash-alt', danger: true, disabled: props.isRoot, action: () => handleDeleteFolder(props.folder) },
  ]);
}

function onDragover(e) {
  e.preventDefault();
  dragOver.value = true;
}
function onDragleave() {
  dragOver.value = false;
}
async function onDrop(e) {
  e.preventDefault();
  dragOver.value = false;
  const path = e.dataTransfer.getData('application/x-photo-path');
  if (!path)
    return;
  const file = findFileByPath(path);
  if (!file)
    return;
  if (file.parent === props.folder)
    return; // 拖到自己父文件夹,无意义
  try {
    await history.moveFile(file, props.folder);
    toast.success(`已移动到 ${props.folder.name}(Ctrl+Z 撤销)`);
  }
  catch (err) {
    toast.error(`移动失败: ${err.message}`);
  }
}
function findFileByPath(path) {
  if (!fsStore.rootFolder)
    return null;
  // 遍历 rootFolder 树找 file(collectAllFiles 递归整树)。
  return collectAllFiles(fsStore.rootFolder).find(x => x.path === path) || null;
}
</script>

<template>
  <li
    class="tree-node" :class="[
      {
        'root-node': isRoot,
        'active': fsStore.currentFolder === folder,
        'empty-folder': folder.isEmpty,
        'drag-over': dragOver,
      },
    ]"
    role="treeitem"
    :aria-expanded="folder.expanded"
    @click="onClick"
    @contextmenu="onContextmenu"
    @dragover="onDragover"
    @dragleave="onDragleave"
    @drop="onDrop"
  >
    <i
      :class="folder.expanded ? 'fas fa-folder-open' : 'fas fa-folder'"
      @click="toggle"
    />
    <span class="tree-node-name">{{ folder.name }}</span>
    <span class="tree-node-count">({{ folder.files.length }})</span>
  </li>
  <ul class="tree-sub-list" :class="[{ expanded: folder.expanded }]">
    <SidebarTreeItem v-for="child in folder.subFolders" :key="child.path" :folder="child" />
  </ul>
</template>

<style scoped>
/* 树节点(原 src/styles/sidebar.css 的 tree-node 归属,T14c 纯搬家,视觉零变化) */
/* 子级列表 */
.tree-sub-list {
    padding-left: 18px !important;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    margin-left: 5px;
    display: none;
}

.tree-sub-list.expanded {
    display: block;
}

/* 根节点样式 */
.tree-node.root-node {
    font-weight: bold;
    color: #ecf0f1;
    margin-bottom: 5px;
}

.tree-node {
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #bdc3c7;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.tree-node:hover,
.tree-node.context-menu-active {
    background-color: rgba(255, 255, 255, 0.1);
    color: white;
}

.tree-node.active {
    background-color: var(--accent-color);
    color: white;
}

.tree-node.drag-over {
    background-color: rgba(52, 152, 219, 0.4);
    border: 1px dashed #fff;
}

/* 空文件夹样式 */
.tree-node.empty-folder {
    opacity: 0.6;
    color: #7f8c8d;
}

.tree-node.empty-folder i {
    color: #95a5a6;
}

.tree-node-count {
    font-size: 0.8em;
    opacity: 0.6;
    margin-left: 4px;
}
</style>
