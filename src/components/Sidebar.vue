<script setup>
import { ref } from 'vue';
import { useSidebar } from '../composables/useSidebar';
import { switchToAllPhotos } from '../services/folderActions';
import { useContextMenuStore } from '../stores/contextMenu';
import { useFsStore } from '../stores/fs';
import RootSwitcher from './RootSwitcher.vue';
import SidebarTreeItem from './SidebarTreeItem.vue';

const emit = defineEmits(['toggleSettings']);

const fsStore = useFsStore();
const contextMenu = useContextMenuStore();
const resizeEl = ref(null);
const { pinned, width, overlayOpen, collapseSidebar } = useSidebar(resizeEl);

async function onAllMediaClick() {
  await switchToAllPhotos();
}

// 反馈1:侧栏任意处右键吞掉原生菜单(.prevent);若自定义菜单正开着,顺手关掉它
// (useOverlay 的 outsideClick 只听 click,右键不关)。节点自身右键已 stopPropagation,不会到这里。
function onSidebarContextmenu() {
  if (contextMenu.visible)
    contextMenu.hide();
}
</script>

<template>
  <div
    id="sidebar"
    :class="{ pinned, 'overlay-open': overlayOpen }"
    :style="{ '--sidebar-width': `${width}px` }"
    @contextmenu.prevent="onSidebarContextmenu"
  >
    <div id="sidebar-content">
      <div class="sidebar-header">
        <RootSwitcher />
        <!-- 收起按钮:宽屏收起 pin,窄屏关 overlay 抽屉 -->
        <button id="pinSidebarBtn" title="收起侧栏" @click="collapseSidebar">
          <i class="fas fa-chevron-left" />
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

      <!-- 底部设置入口(齿轮 → 弹出 SettingsPanel 浮层) -->
      <div class="sidebar-footer">
        <button class="sidebar-settings-btn" title="设置" @click.stop="emit('toggleSettings')">
          <i class="fas fa-cog" /><span>设置</span>
        </button>
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
    height: 100dvh;
    background-color: var(--sidebar-bg);
    color: var(--sidebar-text);
    z-index: var(--z-sidebar);
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
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
    touch-action: none; /* 触屏拖动调宽不被页面滚动劫持 */
    z-index: 20;
}
.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
    background: rgba(255, 255, 255, 0.2);
}

#sidebar.pinned,
#sidebar.overlay-open {
    transform: translateX(0);
}

/* 窄屏抽屉:钳制宽度 + 让出顶部搜索框行(搜索框 z-index 高于侧栏,保持盖在展开卡片上,
   故靠空间错开而非降层级——抽屉从顶部搜索框下方开始,不与右上搜索框重叠)。 */
/* 响应式断点字面量须与 src/utils/breakpoints.js 的 BREAKPOINTS 保持一致 */
@media (max-width: 880px) {
    #sidebar.overlay-open {
        max-width: 86vw;
        top: 60px;
        bottom: 0;
        height: auto;
    }
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
    font-size: 16px;
    transition: color 0.2s;
}

#pinSidebarBtn:hover {
    color: #fff;
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

/* 底部设置入口 */
.sidebar-footer {
    padding: 10px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.sidebar-settings-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #bdc3c7;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
}
.sidebar-settings-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
}
.sidebar-settings-btn i {
    font-size: 15px;
}
</style>
