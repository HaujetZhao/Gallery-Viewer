<script setup>
// R12:modal DOM 缓存(KeepAlive LRU 10)。MediaModal 只剩 backdrop + 事件挂载 + KeepAlive 包 MediaView。
// v-show(非 v-if)让 KeepAlive 缓存跨「关掉再打开」存活;mediaKey=file.path 会话内稳定,LRU 10 淘汰最旧。
import { provide, ref } from 'vue';
import { useModal } from '../composables/useModal';
import { useModalStore } from '../stores/modal';
import MediaView from './MediaView.vue';

const modal = useModalStore();
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
</script>

<template>
  <Teleport to="body">
    <div v-show="modal.isOpen" ref="modalEl" class="modal" role="dialog" aria-modal="true">
      <div ref="contentEl" class="modal-content">
        <KeepAlive :max="10">
          <MediaView :key="mediaKey()" :file="modal.currentFile" />
        </KeepAlive>
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
</style>
