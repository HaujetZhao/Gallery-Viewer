// 侧边栏 composable。钉住 + 右边缘拖拽调宽 + 窄屏 overlay 抽屉。
// 模块级单例状态：App（FAB/scrim）与 Sidebar 共享同一份 ref。
// pinnedPref/width 持久化到 userSettings；--sidebar-width 设到 :root（全局可访问）。
// 响应式：宽屏（>900）pinnedPref 推挤内容；窄屏（<880）overlay 抽屉 + scrim，由 FAB 唤出。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CONFIG } from '../config/index';
import { useUserSettingsStore } from '../stores/userSettings';
import { useResponsiveViewport } from './useResponsiveViewport';

// —— 模块级单例状态 ——
const pinnedPref = ref(false);
const width = ref(CONFIG.UI.SIDEBAR.DEFAULT_WIDTH);
const overlayOpen = ref(false);
let initialized = false;

function init(settings) {
  if (initialized)
    return;
  initialized = true;
  pinnedPref.value = !!settings.settings.sidebarPinned;
  width.value = settings.settings.sidebarWidth || CONFIG.UI.SIDEBAR.DEFAULT_WIDTH;

  const applyWidthVar = w => document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  applyWidthVar(width.value);
  // width 仅实时同步 CSS 变量(拖拽中跟手);持久化在 onUp 落盘一次,免 pointermove 每帧写 localStorage。
  watch(width, w => applyWidthVar(w));
  watch(pinnedPref, v => settings.set('sidebarPinned', v));
}

export function useSidebar(resizeElRef) {
  const settings = useUserSettingsStore();
  const { canPinSidebar } = useResponsiveViewport();
  init(settings);

  // 实际钉住 = 宽屏允许且用户偏好开
  const pinned = computed(() => canPinSidebar.value && pinnedPref.value);

  // FAB 唤出/收起：宽屏 toggle pinnedPref；窄屏 toggle overlay 抽屉
  function toggleSidebar() {
    if (canPinSidebar.value)
      pinnedPref.value = !pinnedPref.value;
    else
      overlayOpen.value = !overlayOpen.value;
  }
  function closeOverlay() {
    overlayOpen.value = false;
  }
  // 收起侧栏(照抄英语学习 collapse):overlay 开则关抽屉,否则(宽屏 pin)收起 pinnedPref。
  function collapseSidebar() {
    if (overlayOpen.value)
      overlayOpen.value = false;
    else
      pinnedPref.value = false;
  }

  // 跨断点：宽屏时关掉窄屏抽屉（避免两态并存）
  watch(canPinSidebar, (can) => {
    if (can)
      overlayOpen.value = false;
  });

  // 拖拽调宽：pointerdown handle → pointermove 改 width（限 min~80vw）→ pointerup 解绑。
  // 用 Pointer Events 统一鼠标/触屏;setPointerCapture 让指针移出 handle 仍持续收到 move。
  let dragging = false;
  function onMove(e) {
    if (!dragging)
      return;
    const min = CONFIG.UI.SIDEBAR.MIN_WIDTH || 200;
    const max = window.innerWidth * 0.8;
    const w = Math.max(min, Math.min(e.clientX, max));
    width.value = w;
  }
  function onUp() {
    if (dragging)
      settings.set('sidebarWidth', width.value); // 拖拽结束落盘一次
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
  }
  function onDown(e) {
    dragging = true;
    e.preventDefault();
    resizeElRef?.value?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  onMounted(() => {
    resizeElRef?.value?.addEventListener('pointerdown', onDown);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
  });

  return {
    pinned,
    width,
    overlayOpen,
    toggleSidebar,
    closeOverlay,
    collapseSidebar,
  };
}
