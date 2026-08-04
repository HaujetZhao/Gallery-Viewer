<script setup>
// R12:modal DOM 缓存(KeepAlive LRU 10)。MediaModal 只剩 backdrop + 事件挂载 + KeepAlive 包 MediaView。
// v-show(非 v-if)让 KeepAlive 缓存跨「关掉再打开」存活;mediaKey=file.path 会话内稳定,LRU 10 淘汰最旧。
// R19:右上角三按钮(菜单 / 属性 / 关闭)+ 任意位置右键关闭(禁原生菜单)。菜单项来自 buildMediaMenu(R16-b)。
import { provide, ref } from 'vue';
import { buildMediaMenu } from '../composables/useMediaActions';
import { useModal } from '../composables/useModal';
import { useContextMenuStore } from '../stores/contextMenu';
import { useModalStore } from '../stores/modal';
import { usePropertiesStore } from '../stores/properties';
import MediaView from './MediaView.vue';

const modal = useModalStore();
const properties = usePropertiesStore();
const contextMenu = useContextMenuStore();
const modalEl = ref(null);
const contentEl = ref(null);
const mediaEl = ref(null); // 当前激活 MediaView 的媒体元素(由 MediaView 经 mediaApi 注册)

const mediaApi = useModal(modalEl, contentEl, mediaEl);
// R12:把 useModal 的 setMediaEl/resetTransform/initializeMediaDisplay 提供给 MediaView。
provide('modalMedia', {
  setMediaEl: mediaApi.setMediaEl,
  resetTransform: mediaApi.resetTransform,
  initializeMediaDisplay: mediaApi.initializeMediaDisplay,
});

// 会话内稳定的缓存 key(rename 后 miss 可接受,缓存本就会话内)。
const mediaKey = () => modal.currentFile?.path || '__empty__';

// R19:右上角按钮 ① 弹出内容菜单(位置取按钮下方)。
function showMediaMenu(e) {
  const btn = e.currentTarget;
  const r = btn.getBoundingClientRect();
  contextMenu.show(r.left, r.bottom, buildMediaMenu(modal.currentFile));
}
// 按钮 ② 属性面板。
function openProperties() {
  if (modal.currentFile)
    properties.open(modal.currentFile);
}
</script>

<template>
  <Teleport to="body">
    <!-- R19:任意位置右键 → 禁原生菜单 + 关闭 modal。
         PropertiesPanel / ContextMenu 各自 Teleport 到 body,不在此容器内,其右键不会冒泡到此。 -->
    <div v-show="modal.isOpen" ref="modalEl" class="modal" role="dialog" aria-modal="true" @contextmenu.prevent="modal.close">
      <div ref="contentEl" class="modal-content">
        <KeepAlive :max="10">
          <MediaView :key="mediaKey()" :file="modal.currentFile" />
        </KeepAlive>
      </div>

      <!-- R19 右上角三按钮:@click.stop 防冒泡到 backdrop 的 tap 关闭判定;右键沿用根容器(关闭)。 -->
      <div class="modal-toolbar">
        <button class="modal-tool-btn" title="菜单" @click.stop="showMediaMenu">
          <i class="fas fa-ellipsis-v" />
        </button>
        <button class="modal-tool-btn" title="属性 (N 备注 / F2 重命名)" @click.stop="openProperties">
          <i class="fas fa-info-circle" />
        </button>
        <button class="modal-tool-btn" title="关闭 (Esc)" @click.stop="modal.close">
          <i class="fas fa-times" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 弹窗(原 src/styles/modal.css L1-98,T14c 纯搬家,视觉零变化) */
.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.9);
    z-index: var(--z-modal);
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
}

.modal.hidden {
    display: none;
}

.modal-content {
    width: 100%;
    height: 100%;
    position: absolute;
    display: flex;
    justify-content: center;
    align-items: center;
}

/* R19 右上角工具按钮组:绝对定位右上、高于内容,半透明圆形、hover 高亮。 */
.modal-toolbar {
    position: absolute;
    top: 20px;
    right: 20px;
    display: flex;
    gap: 10px;
    z-index: 20;
}

.modal-tool-btn {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    transition: background 0.2s ease, transform 0.2s ease;
}

.modal-tool-btn:hover {
    background: rgba(255, 255, 255, 0.28);
    transform: scale(1.08);
}
</style>
