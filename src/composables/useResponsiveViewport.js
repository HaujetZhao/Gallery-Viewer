// 响应式视口基础设施：模块级共享状态 + 单个 rAF 节流 resize 监听。
// 提供 viewportWidth / canPinSidebar（侧栏迟滞断点）/ isTouch（设备能力）共享 ref。
// （列数档位改由 Gallery 按 container 宽度自行算,见 Gallery.bracketFor。）
// ponytail: 模块级单例 reactive，全应用一个 resize listener。
import { onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { BREAKPOINTS } from '../utils/breakpoints';

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const canPinSidebar = ref(viewportWidth.value > BREAKPOINTS.sidebarPin);
// 触屏（无 hover）：pointer:coarse 或 hover:none
const isTouch = ref(typeof window !== 'undefined'
  && (window.matchMedia?.('(hover: none)').matches || window.matchMedia?.('(pointer: coarse)').matches));

let listenerCount = 0;
let rafId = 0;

function recompute() {
  const w = window.innerWidth;
  viewportWidth.value = w;
  // 迟滞双阈值：越过 pin 才允许，跌破 unpin 才禁止
  if (w > BREAKPOINTS.sidebarPin)
    canPinSidebar.value = true;
  else if (w < BREAKPOINTS.sidebarUnpin)
    canPinSidebar.value = false;
}

function onResize() {
  if (rafId)
    return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    recompute();
  });
}

function bind() {
  if (listenerCount === 0 && typeof window !== 'undefined') {
    window.addEventListener('resize', onResize, { passive: true });
    recompute();
  }
  listenerCount++;
}

function unbind() {
  listenerCount = Math.max(0, listenerCount - 1);
  if (listenerCount === 0 && typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
}

export function useResponsiveViewport() {
  onMounted(bind);
  onBeforeUnmount(unbind);
  return {
    viewportWidth: readonly(viewportWidth),
    canPinSidebar: readonly(canPinSidebar),
    isTouch: readonly(isTouch),
  };
}
