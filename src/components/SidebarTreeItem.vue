<script setup>
import { useFsStore } from '../stores/fs.js';
import { handleFolderClick } from '../services/filesystem.js';

defineOptions({ name: 'SidebarTreeItem' }); // 确保递归引用自身

const props = defineProps({
  folder: { type: Object, required: true },
  isRoot: { type: Boolean, default: false },
});

const fsStore = useFsStore();

async function onClick() {
  await handleFolderClick(props.folder);
}

// 点图标切换展开(不触发文件夹切换)
function toggle(e) {
  e.stopPropagation();
  props.folder.treeNode.toggleExpanded();
}
</script>

<template>
  <li
    :class="[
      'tree-node',
      {
        'root-node': isRoot,
        active: fsStore.currentFolder === folder,
        'empty-folder': folder.treeNode.isEmpty,
      },
    ]"
    @click="onClick"
  >
    <i
      :class="folder.treeNode.expanded ? 'fas fa-folder-open' : 'fas fa-folder'"
      @click="toggle"
    ></i>
    <span class="tree-node-name">{{ folder.name }}</span>
    <span class="tree-node-count">({{ folder.files.length }})</span>
  </li>
  <ul :class="['tree-sub-list', { expanded: folder.treeNode.expanded }]">
    <SidebarTreeItem
      v-for="child in folder.subFolders"
      :key="child.path"
      :folder="child"
    />
  </ul>
</template>
