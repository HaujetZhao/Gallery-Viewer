// 侧边栏 composable。钉住 + 拖拽缩放(保留源码幽灵 resize-helper + ResizeObserver 方案)。
// pinned/width 持久化到 userSettings;--sidebar-width 设到 :root(全局可访问,如 .settings-btn 的 left)。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CONFIG } from '../config/index';
import { useUserSettingsStore } from '../stores/userSettings';

export function useSidebar(resizeElRef) {
  const settings = useUserSettingsStore();
  const pinned = ref(!!settings.settings.sidebarPinned);
  const width = ref(settings.settings.sidebarWidth || CONFIG.UI.SIDEBAR.DEFAULT_WIDTH);
  let ro = null;

  function togglePin() {
    pinned.value = !pinned.value;
    settings.set('sidebarPinned', pinned.value);
  }

  // 把 --sidebar-width 设到 :root(全局可访问,如 .settings-btn 的 left 计算)
  function applyWidthVar(w) {
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  }
  watch(width, w => applyWidthVar(w));

  onMounted(() => {
    applyWidthVar(width.value);
    const el = resizeElRef.value;
    if (!el)
      return;
    el.style.width = `${width.value}px`; // 恢复持久化宽度
    ro = new ResizeObserver(() => {
      const w = el.offsetWidth;
      // min-width:200/max-width:80vw 由 CSS 强制,这里只记录有效值
      if (w > 0 && w !== width.value) {
        width.value = w;
        settings.set('sidebarWidth', w);
      }
    });
    ro.observe(el);
  });

  onBeforeUnmount(() => ro?.disconnect());

  return { pinned, width, togglePin };
}
