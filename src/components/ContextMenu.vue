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

// 暴露菜单根元素,供 App 排除区(鼠标在右键菜单上不触发感应滚动)。
defineExpose({ menuEl });
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

<style scoped>
/* 右键菜单(原 src/styles/context-menu.css,T14b 纯搬家,视觉零变化) */
.context-menu {
    position: fixed;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 8px 0;
    min-width: 180px;
    z-index: var(--z-popover);
    font-size: 14px;
    display: block;
    /* 确保菜单可见 */
}

.context-menu.hidden {
    display: none;
}

.context-menu-item {
    padding: 10px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background-color 0.2s ease;
    user-select: none;
}

.context-menu-item:hover {
    background-color: #f5f5f5;
}

.context-menu-item i {
    width: 16px;
    text-align: center;
    color: #666;
}

.context-menu-item span {
    flex: 1;
    color: #333;
}

.context-menu-item.disabled {
    opacity: 0.4;
    pointer-events: none;
}

.context-menu-item.danger:hover {
    background-color: #fee;
}

.context-menu-item.danger i,
.context-menu-item.danger span {
    color: #e74c3c;
}

.context-menu-divider {
    height: 1px;
    background-color: #e0e0e0;
    margin: 4px 0;
}

/* 暗色主题适配(theme=dark 触发,不再受系统暗色影响) */
[data-theme="dark"] {
    .context-menu {
        background: #2c3e50;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }

    .context-menu-item:hover {
        background-color: #34495e;
    }

    .context-menu-item i {
        color: #bbb;
    }

    .context-menu-item span {
        color: #ecf0f1;
    }

    .context-menu-item.danger:hover {
        background-color: #3d2a2a;
    }

    .context-menu-divider {
        background-color: #34495e;
    }
}
</style>
