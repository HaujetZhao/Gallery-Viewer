<script setup>
import { ref } from 'vue';
import { useFsStore } from '../stores/fs';
import { useSidebar } from '../composables/useSidebar';
import { switchToAllPhotos } from '../services/filesystem';
import SidebarTreeItem from './SidebarTreeItem.vue';

const fsStore = useFsStore();
const resizeEl = ref(null);
const { pinned, width, togglePin } = useSidebar(resizeEl);

async function onAllMediaClick() {
  await switchToAllPhotos();
}
</script>

<template>
  <div id="sidebar" :class="{ pinned }" :style="{ '--sidebar-width': width + 'px' }">
    <div id="sidebar-content">
      <div class="sidebar-header">
        <h3><i class="fas fa-folder-tree"></i> 文件夹</h3>
        <button id="pinSidebarBtn" @click="togglePin" :title="pinned ? '取消固定' : '固定侧边栏'">
          <i class="fas fa-thumbtack"></i>
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
            <i class="fas fa-layer-group"></i>
            <span class="tree-node-name">所有媒体</span>
          </li>
        </ul>
      </div>

      <div class="separator-line"></div>

      <!-- 实际文件树 -->
      <div id="folderContainer">
        <ul id="folderTreeRoot">
          <SidebarTreeItem v-if="fsStore.rootFolder" :folder="fsStore.rootFolder" :is-root="true" />
        </ul>
      </div>
    </div>
    <!-- 幽灵 resize 条(ResizeObserver 监听其 offsetWidth) -->
    <div id="resize-helper" ref="resizeEl"></div>
  </div>
</template>
