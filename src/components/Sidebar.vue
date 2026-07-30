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

<style scoped>
/* 侧边栏(原 src/styles/sidebar.css 的 Sidebar 归属,T14c 纯搬家,视觉零变化) */
/* 侧边栏容器 */
#sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width, 280px);
    height: 100vh;
    background-color: var(--sidebar-bg);
    color: var(--sidebar-text);
    z-index: 900;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
}

/* 内容包裹层(flex 子元素;absolute 在 transform 父内边界 hover 易断,改 flex 更稳) */
#sidebar-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    z-index: 2;
}

/* 右边缘拖拽调宽 handle(替代幽灵 resize-helper,sidebar-content 可填满到最右) */
.sidebar-resize-handle {
    position: absolute;
    top: 0;
    right: -6px;
    bottom: 0;
    width: 12px;
    cursor: col-resize;
    z-index: 20;
}
.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
    background: rgba(255, 255, 255, 0.2);
}

/* 侧边栏感应区：鼠标靠左显示 */
#sidebar::after {
    content: '';
    position: absolute;
    top: 0;
    right: -10px;
    width: 14px;
    height: 100%;
    z-index: 10;
}

#sidebar:hover,
#sidebar.pinned {
    transform: translateX(0);
}

/* 固定按钮样式 */
.sidebar-header {
    padding: 15px;
    background-color: rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 5px;
    user-select: none;
}

.sidebar-header h3 {
    font-size: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
}

#pinSidebarBtn {
    background: none;
    border: none;
    color: #95a5a6;
    cursor: pointer;
    font-size: 14px;
    transition: color 0.2s;
}

#pinSidebarBtn:hover,
#sidebar.pinned #pinSidebarBtn {
    color: var(--accent-color);
    transform: rotate(45deg);
}

/* 侧边栏内容 */
#virtualContainer,
#folderContainer {
    padding: 10px;
}

#folderContainer {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
}

#folderContainer::-webkit-scrollbar {
    display: none;
}

/* 原 #folderContainer ul, .virtualContainer ul{list-style} + #folderContainer ul{padding/border} 合并;
   .virtualContainer ul 为死选择器(模板是 id=virtualContainer 非 class),删 */
#folderContainer ul {
    list-style: none;
    padding-left: 0;
    border-left: none;
}

#folderTreeRoot {
    padding-left: 0;
    border-left: none;
}

.separator-line {
    height: 1px;
    background-color: rgba(255, 255, 255, 0.1);
    margin: 5px 15px;
}

/* ALL_MEDIA 虚拟节点用 .tree-node(.tree-node 完整块在 SidebarTreeItem;
   此处 ALL_MEDIA li 需基础+hover+active,跨组件 scoped 各一份) */
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

@media (max-width: 768px) {
    #sidebar {
        width: 100%;
        max-width: 300px;
    }
}
</style>
