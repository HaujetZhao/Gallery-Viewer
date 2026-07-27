// 屏幕边缘感应滚动。鼠标进入顶/底 150px 区域,按距边缘距离线性变速度,rAF 循环 window.scrollBy。
// 排除区域(sidebar/modal/settings/topbar)用 ref 数组传入。
import { onMounted, onBeforeUnmount } from 'vue';
import { useUserSettingsStore } from '../stores/userSettings.js';
import { useModalStore } from '../stores/modal.js';

const ZONE_HEIGHT = 150;

export function useScrollZone(excludeRefs = []) {
  const settings = useUserSettingsStore();
  let rafId = null;
  let active = false;
  let direction = 0;
  let intensity = 0;

  function isInExcluded(x, y) {
    for (const r of excludeRefs) {
      const el = r?.value;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }

  function onMouseMove(e) {
    if (!settings.settings.scrollZoneEnabled) return;
    if (useModalStore().isOpen) return; // modal 打开时暂停感应滚动(避免全屏遮罩下触发看不见的滚动)
    if (isInExcluded(e.clientX, e.clientY)) {
      stop();
      return;
    }
    if (e.clientY <= ZONE_HEIGHT) {
      // 顶区:越靠上 intensity→1
      start(-1, 1 - e.clientY / ZONE_HEIGHT);
    } else if (e.clientY >= window.innerHeight - ZONE_HEIGHT) {
      // 底区:越靠下 intensity→1
      const fromBottom = window.innerHeight - e.clientY;
      start(1, 1 - fromBottom / ZONE_HEIGHT);
    } else {
      stop();
    }
  }

  function start(dir, inten) {
    if (active && direction === dir) {
      intensity = inten; // 同向只更新强度
      return;
    }
    stop();
    active = true;
    direction = dir;
    intensity = inten;
    const loop = () => {
      if (!active || !settings.settings.scrollZoneEnabled) {
        stop();
        return;
      }
      const amount = 5 * intensity * settings.settings.scrollSpeed * direction;
      window.scrollBy({ top: amount, behavior: 'instant' });
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    active = false;
    intensity = 0;
    direction = 0;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  onMounted(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', stop);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseleave', stop);
    stop();
  });
}
