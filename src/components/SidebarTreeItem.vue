<script setup>
import { ref } from 'vue';
import { handleDeleteFolder } from '../services/fileOps';
import { handleFolderClick } from '../services/filesystem';
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
  props.folder.treeNode.toggleExpanded();
}

function onContextmenu(e) {
  if (props.isRoot)
    return;
  e.preventDefault();
  e.stopPropagation();
  contextMenu.show(e.clientX, e.clientY, [
    { label: '删除文件夹', icon: 'fas fa-trash-alt', danger: true, action: () => handleDeleteFolder(props.folder) },
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
  for (const [, folder] of fsStore.foldersData) {
    const f = folder.files.find(x => x.path === path);
    if (f)
      return f;
  }
  return null;
}
</script>

<template>
  <li
    class="tree-node" :class="[
      {
        'root-node': isRoot,
        'active': fsStore.currentFolder === folder,
        'empty-folder': folder.treeNode.isEmpty,
        'drag-over': dragOver,
      },
    ]"
    @click="onClick"
    @contextmenu="onContextmenu"
    @dragover="onDragover"
    @dragleave="onDragleave"
    @drop="onDrop"
  >
    <i
      :class="folder.treeNode.expanded ? 'fas fa-folder-open' : 'fas fa-folder'"
      @click="toggle"
    />
    <span class="tree-node-name">{{ folder.name }}</span>
    <span class="tree-node-count">({{ folder.files.length }})</span>
  </li>
  <ul class="tree-sub-list" :class="[{ expanded: folder.treeNode.expanded }]">
    <SidebarTreeItem v-for="child in folder.subFolders" :key="child.path" :folder="child" />
  </ul>
</template>
