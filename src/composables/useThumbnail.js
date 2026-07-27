// 缩略图懒加载 composable。搬自源码 js/thumbnails.js 的 observer + 队列。
// 全局共享单例(observer + queue,并发上限 4);每卡片 useThumbnail 只 observe 自己的 mediaEl。
// 软取消用响应式 loading ref 代替源码 dataset;loaded/loading 状态绑到 el.__thumb。
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { CONFIG } from '../config/index';
import { generateThumbnail } from '../services/thumbnail';

// 模块级单例
let observer = null;
const queue = { waiting: [], activeCount: 0 };
const MAX_CONCURRENT = CONFIG.PERFORMANCE.THUMBNAIL_QUEUE_SIZE; // 4

function handleIntersect(entries) {
  for (const entry of entries) {
    const el = entry.target;
    const t = el.__thumb;
    if (!t || t.loaded.value) {
      observer.unobserve(el);
      continue;
    }
    if (entry.isIntersecting) {
      if (!t.loading.value) {
        t.loading.value = true;
        queue.waiting.push({ el, file: t.file, targetSize: t.targetSize, loaded: t.loaded, loading: t.loading });
        schedule();
      }
    } else if (t.loading.value) {
      t.loading.value = false; // 软取消:出视口,调度时跳过
    }
  }
}

function ensureObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(handleIntersect, {
    rootMargin: CONFIG.PERFORMANCE.INTERSECTION_MARGIN, // '100px'
    threshold: 0,
  });
  return observer;
}

async function schedule() {
  if (queue.activeCount >= MAX_CONCURRENT) return;
  if (queue.waiting.length === 0) return;

  // 出队时跳过已软取消(loading=false)的任务
  let task = null;
  while (queue.waiting.length > 0) {
    const candidate = queue.waiting.shift();
    if (candidate.loading.value) {
      task = candidate;
      break;
    }
  }
  if (!task) return;

  queue.activeCount++;
  try {
    await generateThumbnail(task.file, task.el, task.targetSize);
    task.loaded.value = true;
    task.loading.value = false;
    observer.unobserve(task.el);
  } catch (e) {
    console.warn('缩略图生成失败:', task.file.name, e);
    task.loading.value = false;
  } finally {
    queue.activeCount--;
    schedule();
  }
}

// 全量重置(切换文件夹/清缓存时调):disconnect + 清队列。
export function unobserveAll() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  queue.waiting = [];
}

// 每卡片 composable。mediaElRef 指向 canvas/img/object 元素。
export function useThumbnail(mediaElRef, file, targetSize = 400) {
  const loaded = ref(false);
  const loading = ref(false);

  onMounted(() => {
    const el = mediaElRef.value;
    if (!el) return;
    // 状态绑到元素,observer 回调读
    el.__thumb = { file, targetSize, loaded, loading };
    ensureObserver().observe(el);
  });

  onBeforeUnmount(() => {
    const el = mediaElRef.value;
    if (el) observer?.unobserve(el);
  });

  return { loaded, loading };
}
