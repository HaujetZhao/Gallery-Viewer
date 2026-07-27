<script setup>
import { watch, ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useContextMenuStore } from '../stores/contextMenu.js';

const menu = useContextMenuStore();
const menuEl = ref(null);

// 边界检测:防止超出右/下
watch(
  () => menu.visible,
  async (v) => {
    if (!v) return;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  },
);

// 点外部/ESC/滚动 关闭
function onDocClick() {
  if (menu.visible) menu.hide();
}
function onKeydown(e) {
  if (e.key === 'Escape' && menu.visible) menu.hide();
}
function onScroll() {
  if (menu.visible) menu.hide();
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('scroll', onScroll, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.visible" ref="menuEl" class="context-menu" @click.stop>
      <template v-for="(item, i) in menu.items" :key="i">
        <div v-if="item.divider" class="context-menu-divider"></div>
        <div
          v-else
          class="context-menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="!item.disabled && (item.action(), menu.hide())"
        >
          <i v-if="item.icon" :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>
