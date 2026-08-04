// Modal 交互 composable。搬自源码 js/modal.js 的手势/键盘/复制 + events.js 的翻页/视频键盘。
// scale/translate 用 style 独立属性(源码如此,浏览器更优路径)。
// R12:DOM 缓存(KeepAlive)后,媒体渲染/加载状态(svgText/loading/fitted/imgSrc)下移到 MediaView;
// useModal 只保留手势(挂 modalEl)+ 变换(scale/pointX)+ 键盘(翻页/视频/复制),并通过 mediaApi
// 让 MediaView 在激活时注册当前媒体元素 + 触发图片 fit。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { FileTypes } from '../config/file-types';
import { CONFIG } from '../config/index';
import { peek } from '../services/fileResource';
import { useModalStore } from '../stores/modal';
import { usePropertiesStore } from '../stores/properties';
import { convertToPngBlob } from '../utils/file';

const { MIN_SCALE, MAX_SCALE, ZOOM_STEP } = CONFIG.UI.MODAL;

// mediaKind 分类(image/svg/video/audio)
function getMediaKind(type) {
  if (FileTypes.image.svg.includes(type))
    return 'svg';
  if (FileTypes.video.all.includes(type))
    return 'video';
  if (FileTypes.audio.all.includes(type))
    return 'audio';
  return 'image'; // standard + gif
}

export function useModal(modalElRef, contentElRef, mediaElRef) {
  const modal = useModalStore();
  const properties = usePropertiesStore();

  const scale = ref(1);
  const pointX = ref(0);
  const pointY = ref(0);
  const minScale = ref(MIN_SCALE);

  // 拖拽临时状态(非响应式)
  let panning = false;
  let startX = 0;
  let startY = 0;
  let mouseDownTime = 0;
  let mouseDownX = 0;
  let mouseDownY = 0;
  let initialDistance = 0;
  let initialScale = 1;

  function applyTransform() {
    const el = mediaElRef.value;
    if (!el)
      return;
    el.style.scale = scale.value;
    el.style.translate = `${pointX.value}px ${pointY.value}px`;
  }

  function resetTransform() {
    scale.value = 1;
    pointX.value = 0;
    pointY.value = 0;
    applyTransform();
  }

  // 图片自适应屏幕:设 natural 像素 + scale 适应;minScale=initial×MIN_SCALE(动态下限:大图也能缩到适应的 1/10,小图不致看不见)
  function initializeMediaDisplay() {
    const el = mediaElRef.value;
    if (!el || !el.classList.contains('modal-image'))
      return;
    el.style.width = `${el.naturalWidth}px`;
    el.style.height = `${el.naturalHeight}px`;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const initial = Math.min(vh / el.naturalHeight, vw / el.naturalWidth, 1) * 0.99;
    scale.value = initial;
    pointX.value = 0;
    pointY.value = 0;
    minScale.value = initial * MIN_SCALE; // 动态下限:缩到适应的 1/10
    applyTransform();
  }

  // R12:MediaView 激活时调,注册当前媒体元素 + 重置变换(图片若已 loaded 顺带 fit)。
  function setMediaEl(el) {
    mediaElRef.value = el;
  }

  // ===== 滚轮缩放(以鼠标为中心 + 平移补偿) =====
  function onWheel(e) {
    if (!modal.isOpen)
      return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const ratio = 1 + delta * ZOOM_STEP;
    const newScale = scale.value * ratio;
    if (newScale < minScale.value || newScale > MAX_SCALE)
      return;
    const el = mediaElRef.value;
    if (!el)
      return;
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
    if (!modal.isOpen || e.button !== 0)
      return;
    // 音频播放器内(音量滑块/按钮)及其他交互控件放行原生行为,否则 preventDefault 会拦住滑块拖动
    if (e.target.closest('.modal-audio-player, input, button, select, textarea'))
      return;
    e.preventDefault();
    panning = true;
    startX = e.clientX - pointX.value;
    startY = e.clientY - pointY.value;
    mouseDownTime = Date.now();
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    if (modalElRef.value)
      modalElRef.value.style.cursor = 'grabbing';
  }

  function onMouseMove(e) {
    if (!panning || !modal.isOpen)
      return;
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
    if (!panning)
      return;
    const dur = Date.now() - mouseDownTime;
    const moveX = e.clientX - mouseDownX;
    const moveY = e.clientY - mouseDownY;
    const dist = Math.sqrt(moveX * moveX + moveY * moveY);
    const isClick = dist < 5 && dur < 300;
    if (isClick) {
      const onMedia = e.target.closest('.modal-media, audio, .modal-audio-player');
      if (!onMedia)
        modal.close();
    }
    panning = false;
    if (modalElRef.value)
      modalElRef.value.style.cursor = '';
  }

  // ===== 触摸 =====
  function onTouchStart(e) {
    if (!modal.isOpen)
      return;
    // 交互控件放行(音频播放器内滑块/按钮等),保留原生 touch
    if (e.target.closest('.modal-audio-player, input, button, select, textarea'))
      return;
    if (e.touches.length === 1) {
      e.preventDefault(); // 阻止合成 click 穿透到背后元素 + 页面滚动
      panning = true;
      startX = e.touches[0].clientX - pointX.value;
      startY = e.touches[0].clientY - pointY.value;
      mouseDownX = e.touches[0].clientX;
      mouseDownY = e.touches[0].clientY;
      mouseDownTime = Date.now();
    }
    else if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialDistance = Math.sqrt(dx * dx + dy * dy);
      initialScale = scale.value;
    }
  }

  function onTouchMove(e) {
    if (!modal.isOpen)
      return;
    if (e.touches.length === 1 && panning) {
      e.preventDefault();
      const moveX = e.touches[0].clientX - mouseDownX;
      const moveY = e.touches[0].clientY - mouseDownY;
      if (Math.sqrt(moveX * moveX + moveY * moveY) > 5) {
        pointX.value = e.touches[0].clientX - startX;
        pointY.value = e.touches[0].clientY - startY;
        applyTransform();
      }
    }
    else if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const cur = Math.sqrt(dx * dx + dy * dy);
      const newScale = initialScale * (cur / initialDistance);
      if (newScale < minScale.value || newScale > MAX_SCALE)
        return;
      scale.value = newScale;
      applyTransform();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length > 0)
      return; // 还有手指
    if (!panning)
      return;
    const dur = Date.now() - mouseDownTime;
    if (dur < 300 && e.changedTouches[0]) {
      // tap 判定:短按 + 几乎没移动(<10px) + 不在媒体上 → 关闭
      const t = e.changedTouches[0];
      const moveX = t.clientX - mouseDownX;
      const moveY = t.clientY - mouseDownY;
      const onMedia = e.target.closest('.modal-media, audio, .modal-audio-player');
      if (Math.sqrt(moveX * moveX + moveY * moveY) < 10 && !onMedia)
        modal.close();
    }
    panning = false;
  }

  // ===== 键盘 =====
  function onKeydown(e) {
    if (!modal.isOpen)
      return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA')
      return;

    // R7:↑/↓/PageUp/PageDown 无条件翻图(所有媒体)。PageUp/Down、方向键会触发页面滚动,preventDefault 拦之。
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      modal.prev();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      modal.next();
      return;
    }

    // 视频音频:←/→ 调进度、空格 暂停/播放(不再切卡片)。mediaElRef 对视频/音频都注册了对应元素。
    const kind = modal.currentFile ? getMediaKind(modal.currentFile.type) : null;
    if (kind === 'video' || kind === 'audio') {
      const el = mediaElRef.value;
      // 视频:回车切换全屏播放。
      if (kind === 'video' && e.key === 'Enter') {
        e.preventDefault();
        if (el) {
          if (document.fullscreenElement)
            document.exitFullscreen?.().catch?.(() => {});
          else
            el.requestFullscreen?.().catch?.(() => {});
        }
        return;
      }
      // 视频/音频:Home 跳开头、End 跳结尾。
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (el)
          el.currentTime = e.key === 'Home' ? 0 : (el.duration || 0);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (el) {
          const t = e.key === 'ArrowRight' ? 5 : -5;
          el.currentTime = Math.max(0, Math.min(el.currentTime + t, el.duration || Infinity));
        }
        return;
      }
      if ((e.key === ' ' || e.key === 'Spacebar')) {
        // 焦点在按钮(如播放键)上时让原生点击生效,避免双触发。
        if (tag === 'BUTTON')
          return;
        e.preventDefault();
        if (el)
          el.paused ? el.play() : el.pause();
        return;
      }
    }

    switch (e.key) {
      case 'Escape':
        // R16-b:属性面板打开时 Esc 先关属性面板、不关 modal(由 PropertiesPanel 的 useOverlay 处理关闭,
        // 这里仅让出——不调 modal.close)。再按一次 Esc(属性面板已关)才关 modal。
        if (properties.visible)
          return;
        modal.close();
        break;
      case 'ArrowRight':
        modal.next(); // 仅图片(svg/image)到达此分支
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
      // Modal 已 ensureBlobUrl,peek 有 File → 复用,省一次 getFile
      const raw = peek(file)?.file ?? await file.handle.getFile();
      const targetBlob = raw.type === 'image/png' ? raw : await convertToPngBlob(file.blobUrl);
      if (!targetBlob)
        throw new Error('无法生成图片数据');
      const item = new ClipboardItem({
        'image/png': targetBlob,
        'text/plain': new Blob([file.blobUrl], { type: 'text/plain' }),
        'text/html': new Blob([`<img src="${file.blobUrl}" alt="${file.name}" />`], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      console.warn(`已复制: ${file.name}`);
    }
    catch (err) {
      console.error('复制失败:', err);
    }
  }

  // ===== 事件挂载:必须在 modal 显示后(modalEl 已渲染)挂,不能在 onMounted 挂 =====
  // (初始 isOpen=false,modal v-if 不渲染,modalEl.value 为 null)
  function attachGestures() {
    const el = modalElRef.value;
    if (!el)
      return;
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function detachGestures() {
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
  }

  // isOpen 变化:open 时 nextTick 挂事件(modalEl 此时已渲染),close 时卸。
  watch(
    () => modal.isOpen,
    (open) => {
      if (open) {
        window.addEventListener('keydown', onKeydown);
        nextTick(() => attachGestures());
      }
      else {
        window.removeEventListener('keydown', onKeydown);
        detachGestures();
      }
    },
  );

  onBeforeUnmount(() => {
    detachGestures();
    window.removeEventListener('keydown', onKeydown);
  });

  return {
    scale,
    pointX,
    pointY,
    minScale,
    applyTransform,
    resetTransform,
    initializeMediaDisplay,
    setMediaEl,
    copyCurrent,
  };
}
