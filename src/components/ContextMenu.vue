<script setup>
import { nextTick, ref, watch } from 'vue';
import { useOverlay } from '../composables/useOverlay';
import { useContextMenuStore } from '../stores/contextMenu';

const menu = useContextMenuStore();
const menuEl = ref(null);

// 定位:跟随鼠标 + 边界检测。监听 visible/x/y 三者——单 watch(visible) 时,
// 连续右键 visible 始终 true(旧值 true→新值 true)不触发,是"位置不跟随"的根因。
const pos = ref({ left: 0, top: 0 });
watch(
  [() => menu.visible, () => menu.x, () => menu.y],
  async ([v]) => {
    if (!v)
      return;
    pos.value = { left: menu.x, top: menu.y };
    await nextTick();
    const el = menuEl.value;
    if (!el)
      return;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth)
      left = window.innerWidth - rect.width - 10;
    if (top + rect.height > window.innerHeight)
      top = window.innerHeight - rect.height - 10;
    pos.value = { left, top };
  },
);

// 点外部/ESC/滚动 关闭
useOverlay({
  isVisible: () => menu.visible,
  overlayEl: menuEl,
  onClose: () => menu.hide(),
  outsideClick: true,
  closeOnScroll: true,
});
</script>

<template>
  <Teleport to="body">
    <div v-if="menu.visible" ref="menuEl" class="context-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @click.stop>
      <template v-for="(item, i) in menu.items" :key="i">
        <div v-if="item.divider" class="context-menu-divider" />
        <div
          v-else
          class="context-menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="!item.disabled && (item.action(), menu.hide())"
        >
          <i v-if="item.icon" :class="item.icon" />
          <span>{{ item.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>
