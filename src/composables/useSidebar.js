// 侧边栏 composable。钉住 + 右边缘拖拽调宽(自定义 mousedown/move/up,替代源码幽灵 resize-helper)。
// pinned/width 持久化到 userSettings;--sidebar-width 设到 :root(全局可访问,如 .settings-btn 的 left)。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CONFIG } from '../config/index';
import { useUserSettingsStore } from '../stores/userSettings';

export function useSidebar(resizeElRef) {
  const settings = useUserSettingsStore();
  const pinned = ref(!!settings.settings.sidebarPinned);
  const width = ref(settings.settings.sidebarWidth || CONFIG.UI.SIDEBAR.DEFAULT_WIDTH);

  function togglePin() {
    pinned.value = !pinned.value;
    settings.set('sidebarPinned', pinned.value);
  }

  function applyWidthVar(w) {
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  }
  watch(width, w => applyWidthVar(w));

  // 拖拽调宽:mousedown handle → mousemove 改 width(限 200~80vw)→ mouseup 解绑
  let dragging = false;
  function onMove(e) {
    if (!dragging)
      return;
    const min = CONFIG.UI.SIDEBAR.MIN_WIDTH || 200;
    const max = window.innerWidth * 0.8;
    const w = Math.max(min, Math.min(e.clientX, max));
    width.value = w;
    settings.set('sidebarWidth', w);
  }
  function onUp() {
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  function onDown(e) {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  onMounted(() => {
    applyWidthVar(width.value);
    resizeElRef.value?.addEventListener('mousedown', onDown);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  });

  return { pinned, width, togglePin };
}
