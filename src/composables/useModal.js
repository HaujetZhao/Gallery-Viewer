// Modal 交互 composable。搬自源码 js/modal.js 的手势/键盘/复制 + events.js 的翻页/视频键盘。
// scale/translate 用 style 独立属性(源码如此,浏览器更优路径)。LRU 缓存推迟阶段10。
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useModalStore } from '../stores/modal.js';
import { CONFIG } from '../config/index.js';
import { FileTypes } from '../config/file-types.js';
import { convertToPngBlob } from '../utils/file.js';

const { MIN_SCALE, MAX_SCALE, ZOOM_STEP } = CONFIG.UI.MODAL;

// mediaKind 分类(image/svg/video/audio)
function getMediaKind(type) {
  if (FileTypes.image.svg.includes(type)) return 'svg';
  if (FileTypes.video.all.includes(type)) return 'video';
  if (FileTypes.audio.all.includes(type)) return 'audio';
  return 'image'; // standard + gif
}

export function useModal(modalElRef, contentElRef, mediaElRef) {
  const modal = useModalStore();

  const scale = ref(1);
  const pointX = ref(0);
  const pointY = ref(0);
  const minScale = ref(MIN_SCALE);
  const isHoveringVideo = ref(false);
  const loading = ref(false);
  const svgText = ref('');

  const mediaKind = computed(() => (modal.currentFile ? getMediaKind(modal.currentFile.type) : null));

  // 拖拽临时状态(非响应式)
  let panning = false;
  let startX = 0, startY = 0;
  let mouseDownTime = 0, mouseDownX = 0, mouseDownY = 0;
  let initialDistance = 0, initialScale = 1;

  function applyTransform() {
    const el = mediaElRef.value;
    if (!el) return;
    el.style.scale = scale.value;
    el.style.translate = `${pointX.value}px ${pointY.value}px`;
  }

  function resetTransform() {
    scale.value = 1;
    pointX.value = 0;
    pointY.value = 0;
    applyTransform();
  }

  // 图片自适应屏幕:设 natural 像素 + scale 适应 + minScale=初始
  function initializeMediaDisplay() {
    const el = mediaElRef.value;
    if (!el || !el.classList.contains('modal-image')) return;
    el.style.width = `${el.naturalWidth}px`;
    el.style.height = `${el.naturalHeight}px`;
    const vw = window.innerWidth, vh = window.innerHeight;
    const initial = Math.min(vh / el.naturalHeight, vw / el.naturalWidth, 1) * 0.99;
    scale.value = initial;
    pointX.value = 0;
    pointY.value = 0;
    minScale.value = initial;
    applyTransform();
  }

  function onImgLoad() {
    loading.value = false;
    initializeMediaDisplay();
  }

  // ===== 滚轮缩放(以鼠标为中心 + 平移补偿) =====
  function onWheel(e) {
    if (!modal.isOpen) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const ratio = 1 + delta * ZOOM_STEP;
    const newScale = scale.value * ratio;
    if (newScale < minScale.value || newScale > MAX_SCALE) return;
    const el = mediaElRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    pointX.value = pointX.value - offsetX * (ratio - 1);
    pointY.value = pointY.value - offsetY * (ratio - 1);
    scale.value = newScale;
    applyTransform();
  }

  // ===== 鼠标拖拽 =====
  function onMouseDown(e) {
    if (!modal.isOpen || e.button !== 0) return;
    e.preventDefault();
    panning = true;
    startX = e.clientX - pointX.value;
    startY = e.clientY - pointY.value;
    mouseDownTime = Date.now();
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    if (modalElRef.value) modalElRef.value.style.cursor = 'grabbing';
  }

  function onMouseMove(e) {
    if (!panning || !modal.isOpen) return;
    e.preventDefault();
    const moveX = e.clientX - mouseDownX;
    const moveY = e.clientY - mouseDownY;
    if (Math.sqrt(moveX * moveX + moveY * moveY) > 5) {
      pointX.value = e.clientX - startX;
      pointY.value = e.clientY - startY;
      applyTransform();
    }
  }

  function onMouseUp(e) {
    if (!panning) return;
    const dur = Date.now() - mouseDownTime;
    const moveX = e.clientX - mouseDownX;
    const moveY = e.clientY - mouseDownY;
    const dist = Math.sqrt(moveX * moveX + moveY * moveY);
    const isClick = dist < 5 && dur < 300;
    if (isClick) {
      const onMedia = e.target.closest('.modal-media, audio, .modal-audio-player');
      if (!onMedia) modal.close();
    }
    panning = false;
    if (modalElRef.value) modalElRef.value.style.cursor = '';
  }

  // ===== 触摸 =====
  function onTouchStart(e) {
    if (!modal.isOpen) return;
    if (e.touches.length === 1) {
      panning = true;
      startX = e.touches[0].clientX - pointX.value;
      startY = e.touches[0].clientY - pointY.value;
      mouseDownX = e.touches[0].clientX;
      mouseDownY = e.touches[0].clientY;
      mouseDownTime = Date.now();
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialDistance = Math.sqrt(dx * dx + dy * dy);
      initialScale = scale.value;
    }
  }

  function onTouchMove(e) {
    if (!modal.isOpen) return;
    if (e.touches.length === 1 && panning) {
      const moveX = e.touches[0].clientX - mouseDownX;
      const moveY = e.touches[0].clientY - mouseDownY;
      if (Math.sqrt(moveX * moveX + moveY * moveY) > 5) {
        pointX.value = e.touches[0].clientX - startX;
        pointY.value = e.touches[0].clientY - startY;
        applyTransform();
      }
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const cur = Math.sqrt(dx * dx + dy * dy);
      const newScale = initialScale * (cur / initialDistance);
      if (newScale < MIN_SCALE || newScale > MAX_SCALE) return;
      scale.value = newScale;
      applyTransform();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length > 0) return; // 还有手指
    if (!panning) return;
    const dur = Date.now() - mouseDownTime;
    if (dur < 300) {
      const onMedia = e.target.closest('.modal-media, audio, .modal-audio-player');
      if (!onMedia) modal.close();
    }
    panning = false;
  }

  // ===== 键盘 =====
  function onKeydown(e) {
    if (!modal.isOpen) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // 视频悬停:方向键快进退 + 空格暂停
    if (isHoveringVideo.value) {
      const video = mediaElRef.value;
      if (video && video.tagName === 'VIDEO') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const t = e.key === 'ArrowRight' ? 5 : -5;
          video.currentTime = Math.max(0, Math.min(video.currentTime + t, video.duration));
          return;
        }
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          return;
        }
      }
    }

    switch (e.key) {
      case 'Escape':
        modal.close();
        break;
      case 'ArrowRight':
        modal.next();
        break;
      case 'ArrowLeft':
        modal.prev();
        break;
      case 'c':
      case 'C':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          copyCurrent();
        }
        break;
    }
  }

  // ===== Ctrl+C 复制(三 MIME:image/png + text/plain + text/html) =====
  async function copyCurrent() {
    const file = modal.currentFile;
    if (!file || getMediaKind(file.type) !== 'image') {
      console.warn('仅支持复制图片');
      return;
    }
    try {
      const raw = await file.handle.getFile();
      const targetBlob = raw.type === 'image/png' ? raw : await convertToPngBlob(file.blobUrl);
      if (!targetBlob) throw new Error('无法生成图片数据');
      const item = new ClipboardItem({
        'image/png': targetBlob,
        'text/plain': new Blob([file.blobUrl], { type: 'text/plain' }),
        'text/html': new Blob([`<img src="${file.blobUrl}" alt="${file.name}" />`], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      console.log(`已复制: ${file.name}`);
    } catch (err) {
      console.error('复制失败:', err);
    }
  }

  // ===== SVG:fetch blobUrl → text =====
  async function loadSvg() {
    if (mediaKind.value !== 'svg' || !modal.currentFile) return;
    try {
      const r = await fetch(modal.currentFile.blobUrl);
      svgText.value = await r.text();
    } catch (e) {
      console.warn('SVG 加载失败:', e);
    }
  }

  // 切换文件时重置变换 + 按需加载 svg
  watch(
    () => modal.currentFile,
    async (f) => {
      if (!f) return;
      resetTransform();
      loading.value = mediaKind.value !== 'audio';
      svgText.value = '';
      if (mediaKind.value === 'svg') await loadSvg();
    },
  );

  // isOpen 变化时挂/卸键盘
  watch(
    () => modal.isOpen,
    (open) => {
      if (open) {
        window.addEventListener('keydown', onKeydown);
        nextTick(() => resetTransform());
      } else {
        window.removeEventListener('keydown', onKeydown);
      }
    },
  );

  // 手势监听挂 modalEl(passive:false 才能 preventDefault)
  onMounted(() => {
    const el = modalElRef.value;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  onBeforeUnmount(() => {
    const el = modalElRef.value;
    if (el) {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeydown);
  });

  return {
    scale, pointX, pointY, minScale, isHoveringVideo, loading, svgText, mediaKind,
    applyTransform, resetTransform, initializeMediaDisplay, onImgLoad, copyCurrent,
  };
}
