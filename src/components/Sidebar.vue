<script setup>
import { ref } from 'vue';
import { useSidebar } from '../composables/useSidebar';
import { switchToAllPhotos } from '../services/folderActions';
import { useFsStore } from '../stores/fs';
import RootSwitcher from './RootSwitcher.vue';
import SidebarTreeItem from './SidebarTreeItem.vue';

const fsStore = useFsStore();
const resizeEl = ref(null);
const { pinned, width, togglePin } = useSidebar(resizeEl);

async function onAllMediaClick() {
  await switchToAllPhotos();
}
</script>

<template>
  <div id="sidebar" :class="{ pinned }" :style="{ '--sidebar-width': `${width}px` }">
    <div id="sidebar-content">
      <div class="sidebar-header">
        <RootSwitcher />
        <button id="pinSidebarBtn" :title="pinned ? '取消固定' : '固定侧边栏'" @click="togglePin">
          <i class="fas fa-thumbtack" />
        </button>
      </div>

      <!-- 虚拟节点:ALL_MEDIA -->
      <div id="virtualContainer">
        <ul>
          <li
            class="tree-node"
            :class="{ active: fsStore.currentFolder === fsStore.allMediaFolder }"
            @click="onAllMediaClick"
          >
            <i class="fas fa-layer-group" />
            <span class="tree-node-name">所有媒体</span>
          </li>
        </ul>
      </div>

      <div class="separator-line" />

      <!-- 实际文件树 -->
      <div id="folderContainer">
        <ul id="folderTreeRoot">
          <SidebarTreeItem v-if="fsStore.rootFolder" :folder="fsStore.rootFolder" :is-root="true" />
        </ul>
      </div>
    </div>
    <!-- 右边缘拖拽调宽 handle -->
    <div ref="resizeEl" class="sidebar-resize-handle" />
  </div>
</template>
