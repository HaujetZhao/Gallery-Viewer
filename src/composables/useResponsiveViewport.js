// 响应式视口基础设施：模块级共享状态 + 单个 rAF 节流 resize 监听。
// 侧栏断点（迟滞双阈值）与图库列数自适应共用，避免散落的瞬时 matchMedia。
// ponytail: 模块级单例 reactive，全应用一个 resize listener。
import { onBeforeUnmount, onMounted, readonly, ref } from 'vue';

// 断点（innerWidth，px）
const SIDEBAR_PIN = 900; // 越过 → 允许 pin
const SIDEBAR_UNPIN = 880; // 跌破 → 强制 overlay 抽屉（20px 迟滞带防抖动）

// 视口允许列数阶梯
function maxColumnsFor(width) {
  if (width < 480)
    return 2;
  if (width < 768)
    return 3;
  if (width < 1100)
    return 4;
  return Infinity; // 桌面不封顶，用用户偏好
}

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const canPinSidebar = ref(viewportWidth.value > SIDEBAR_PIN);
const maxColumns = ref(maxColumnsFor(viewportWidth.value));
// 触屏（无 hover）：pointer:coarse 或 hover:none
const isTouch = ref(typeof window !== 'undefined'
  && (window.matchMedia?.('(hover: none)').matches || window.matchMedia?.('(pointer: coarse)').matches));

let listenerCount = 0;
let rafId = 0;

function recompute() {
  const w = window.innerWidth;
  viewportWidth.value = w;
  // 迟滞双阈值：越过 pin 才允许，跌破 unpin 才禁止
  if (w > SIDEBAR_PIN)
    canPinSidebar.value = true;
  else if (w < SIDEBAR_UNPIN)
    canPinSidebar.value = false;
  maxColumns.value = maxColumnsFor(w);
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
    maxColumns: readonly(maxColumns),
    isTouch: readonly(isTouch),
  };
}
