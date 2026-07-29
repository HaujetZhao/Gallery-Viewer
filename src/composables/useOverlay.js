// 浮层 dismiss 收口(ESC / 点外 / 滚动)+ 焦点陷阱/归还(T13 a11y)。
// 替换 RootSwitcher/ContextMenu/SettingsPanel/ConfirmDialog 各自的 document.addEventListener 重复。
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';

// @param isVisible    () => boolean       浮层是否打开
// @param overlayEl    Ref<HTMLElement>    浮层根元素(点外检测 + 焦点陷阱范围)
// @param onClose      () => void          关闭回调
// @param outsideClick bool=false          点外关闭(ContextMenu/RootSwitcher 用)
// @param closeOnScroll bool=false         滚动关闭(ContextMenu 用)
// @param trapFocus    bool=false          焦点陷阱 + 归还(dialog 用)
export function useOverlay({ isVisible, overlayEl, onClose, outsideClick = false, closeOnScroll = false, trapFocus = false }) {
  let lastFocused = null;

  function close() {
    onClose?.();
  }

  function onKeydown(e) {
    if (!isVisible())
      return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (trapFocus && e.key === 'Tab')
      trapTab(e);
  }

  function trapTab(e) {
    const el = overlayEl?.value;
    if (!el)
      return;
    const focusable = el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length)
      return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
    else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onDocClick(e) {
    if (!isVisible() || !outsideClick)
      return;
    const el = overlayEl?.value;
    if (el && !el.contains(e.target))
      close();
  }

  function onScroll() {
    if (isVisible() && closeOnScroll)
      close();
  }

  // 焦点:打开时记上次焦点 + 聚焦浮层;关闭时归还
  watch(
    () => isVisible(),
    (v) => {
      if (v) {
        if (trapFocus) {
          lastFocused = document.activeElement;
          nextTick(() => {
            const el = overlayEl?.value;
            if (!el)
              return;
            const first = el.querySelector('button, [href], input, [tabindex="-1"]');
            (first || el).focus?.();
          });
        }
      }
      else if (trapFocus && lastFocused) {
        lastFocused.focus?.();
        lastFocused = null;
      }
    },
  );

  onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    if (outsideClick)
      document.addEventListener('click', onDocClick);
    if (closeOnScroll)
      window.addEventListener('scroll', onScroll, true);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('scroll', onScroll, true);
  });
}
