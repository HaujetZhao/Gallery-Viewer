// 卡片媒体生命周期 composable。全局共享单例(负载观察器 + 队列,并发上限由 CONFIG 定)。
// 统一规则:
//  - 所有卡片(含视频预览)由「负载观察器」(threshold 0 + 100px margin)进视口前即载元数据(loadCardMetadata);
//    非预览卡片顺带渲染缩略图(renderThumbnail)。→ 爱心/时长角标/缩略图同一视口条件,不再分叉。
//  - 视频预览额外由「播放观察器」(threshold 1.0,整卡完全进入)追踪 isVisible,PhotoCard 据此播/停。
//  - 预览视频的 loaded 由首帧就绪(loadeddata)驱动;其余卡片由缩略图画上元素(onDrawn)驱动。
// 元素可随预览模式切换在 canvas↔video 间替换,故用 watch(mediaElRef) 而非 onMounted 绑定。
import { onBeforeUnmount, ref, watch } from 'vue';
import { CONFIG } from '../config/index';
import { clearMemBitmapCache, loadCardMetadata, renderThumbnail } from '../services/thumbnail';

// 模块级单例
let observer = null;
const queue = { waiting: [], activeCount: 0 };
// 模块首次 import 时读一次(CONFIG.PERFORMANCE.THUMBNAIL_QUEUE_SIZE,现 8);改值需刷新页面。
const MAX_CONCURRENT = CONFIG.PERFORMANCE.THUMBNAIL_QUEUE_SIZE;

// 重绘信号:forceRegenerateCurrentThumbnails 删缓存后 ++,Gallery watch 触发卡片重挂载重新生成。
export const redrawSignal = ref(0);

// 播放观察器(threshold 1.0 + 无 margin):视频预览专用,整卡完全进入视口才算"可见"(播放)。
let playObserver = null;
function handlePlayIntersect(entries) {
  for (const entry of entries) {
    const t = entry.target.__thumb;
    if (t)
      t.isVisible.value = entry.isIntersecting;
  }
}
function ensurePlayObserver() {
  if (playObserver)
    return playObserver;
  playObserver = new IntersectionObserver(handlePlayIntersect, {
    rootMargin: '0px',
    threshold: 1.0,
  });
  return playObserver;
}

function handleIntersect(entries) {
  for (const entry of entries) {
    const el = entry.target;
    const t = el.__thumb;
    // 已「媒体加载且元数据就绪」才跳过。⚠️ hover 预览视频的 loaded 由 loadeddata 驱动(metadata 预载即触发),
    // 早于 loadCardMetadata 完成;若只看 loaded 会误跳过 md5/爱心/备注的加载(备注栏一直显示"需先加载文件")。
    if (!t || (t.loaded.value && t.metaDone.value)) {
      observer.unobserve(el);
      continue;
    }
    if (entry.isIntersecting) {
      // 已 loaded 不再重复入队(FLIP scale/位移会触发 IO 重新 enter,避免缩略图重载闪)
      if (!t.loading.value && !t.loaded.value) {
        t.loading.value = true;
        queue.waiting.push({ el, file: t.file, targetSize: t.targetSize, loaded: t.loaded, loading: t.loading, isVideo: t.isVideo, metaDone: t.metaDone });
        schedule();
      }
    }
    else if (t.loading.value) {
      t.loading.value = false; // 软取消:出视口,调度时跳过
    }
  }
}

function ensureObserver() {
  if (observer)
    return observer;
  observer = new IntersectionObserver(handleIntersect, {
    rootMargin: CONFIG.PERFORMANCE.INTERSECTION_MARGIN, // '100px' 预加载 margin
    threshold: 0,
  });
  return observer;
}

async function schedule() {
  if (queue.activeCount >= MAX_CONCURRENT)
    return;
  if (queue.waiting.length === 0)
    return;

  // 出队时跳过已软取消(loading=false)的任务
  let task = null;
  while (queue.waiting.length > 0) {
    const candidate = queue.waiting.shift();
    if (candidate.loading.value) {
      task = candidate;
      break;
    }
  }
  if (!task)
    return;

  queue.activeCount++;
  // onDrawn:缩略图画到元素(可见)即刻翻 loaded + 移遮罩,不等 toBlob 编码/IDB 存盘。三行赋值幂等。
  const onDrawn = () => {
    task.loaded.value = true;
    task.loading.value = false;
    observer.unobserve(task.el);
  };
  try {
    await loadCardMetadata(task.file);
    task.metaDone.value = true; // 元数据(md5/时长/爱心/备注)就绪;loaded 由 onDrawn(非视频)/loadeddata(视频)另驱动
    if (task.isVideo) {
      // 预览视频:只载元数据(爱心/时长),不渲染静态帧;loaded 由视频首帧(loadeddata)驱动。
      task.loading.value = false;
      observer.unobserve(task.el);
    }
    else {
      await renderThumbnail(task.file, task.el, task.targetSize, onDrawn);
      onDrawn();
    }
  }
  catch (e) {
    console.warn('缩略图生成失败:', task.file.name, e);
    task.loading.value = false;
  }
  finally {
    queue.activeCount--;
    schedule();
  }
}

// 全量重置(切换文件夹时调):disconnect + 清队列 + 清内存 bitmap 缓存(释放 + 防陈旧)。
export function unobserveAll() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  queue.waiting = [];
  clearMemBitmapCache();
}

// 强制重绘当前视图:unobserveAll + 递增 redrawSignal → Gallery 重挂卡片重新生成。
// forceRegenerateCurrentThumbnails 删缓存后调。
export function triggerRedraw() {
  unobserveAll();
  redrawSignal.value++;
}

// 每卡片 composable。mediaElRef 指向 canvas/img/video/object 元素;cardElRef 指向卡片根(供播放观察器)。
// 播放观察器观察「卡片」(稳定元素)而非媒体元素——媒体(视频/缩略图)拓展后出视口不会让 isVisible 翻转:
// 视频播放与媒体展开统一由「卡片是否整卡在视口」驱动,避免媒体元素拓展的边界问题。所有媒体都挂(图片也
// 需 isVisible 做展开 gate)。mediaElRef 只用于负载观察器(载元数据/缩略图)。
export function useThumbnail(mediaElRef, file, targetSize = 400, cardElRef = null) {
  const loaded = ref(false);
  const loading = ref(false);
  const isVisible = ref(false);
  let boundEl = null;
  let boundCard = null;

  function onVideoReady() {
    loaded.value = true; // 视频首帧就绪或加载失败都翻 loaded,loading 指示不再卡
  }

  function bind() {
    const el = mediaElRef.value;
    if (!el || el === boundEl)
      return;
    if (boundEl) {
      observer?.unobserve(boundEl);
      if (boundEl.tagName === 'VIDEO') {
        boundEl.removeEventListener('loadeddata', onVideoReady);
        boundEl.removeEventListener('error', onVideoReady);
      }
    }
    if (boundCard)
      playObserver?.unobserve(boundCard);
    boundEl = el;
    boundCard = null;
    loaded.value = false;
    loading.value = false;
    // 状态绑到元素,observer 回调读
    // metaDone:loadCardMetadata(算 md5/载时长/爱心/备注)完成标记,与 loaded(媒体渲染/播放就绪)解耦——
    // hover 视频的 loaded 可能早于元数据就绪,跳过判定须二者兼有(见 handleIntersect)。
    el.__thumb = { file, targetSize, loaded, loading, isVisible, isVideo: el.tagName === 'VIDEO', metaDone: ref(false) };
    // 所有卡片:负载观察器(100px)载元数据;非预览卡片顺带渲染缩略图。
    ensureObserver().observe(el);
    // 播放观察器观察卡片根(threshold 1.0,整卡完全进入才 isVisible)。所有媒体都挂(图片也用于展开 gate)。
    const card = cardElRef?.value;
    if (card) {
      card.__thumb = { isVisible };
      ensurePlayObserver().observe(card);
      boundCard = card;
    }
    if (el.tagName === 'VIDEO') {
      // 预览视频:loaded 由首帧就绪驱动(播/停由卡片可见性 isVisible 控制,见 PhotoCard.updatePlayback)。
      el.addEventListener('loadeddata', onVideoReady);
      el.addEventListener('error', onVideoReady);
    }
  }

  watch(mediaElRef, bind, { flush: 'post' });

  onBeforeUnmount(() => {
    if (boundEl)
      observer?.unobserve(boundEl);
    if (boundCard)
      playObserver?.unobserve(boundCard);
  });

  return { loaded, loading, isVisible };
}
