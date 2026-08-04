// OffscreenCanvas worker 池。每个 worker 一次处理一张图;POOL_SIZE 对齐缩略图并发上限,
// 8 个在途任务各占一个 worker,解码+降采样+编码在 8 个 worker 线程上真并行,主线程零参与。
//
// renderInWorker(file, targetSize) → Promise<blob>:File 经 structured-clone 进 worker(廉价,共享底层数据),
// worker 内 createImageBitmap + cover-fit drawImage + convertToBlob,回传小 jpeg blob。
// 无 Worker / OffscreenCanvas(如测试环境 jsdom)→ isPoolAvailable()=false,策略走主线程兜底。
import { CONFIG } from '../config/index';
// ?worker&inline 内联进单 HTML,约定见 CLAUDE.md 第 9 条。
import ThumbnailWorker from './thumbnail-worker.js?worker&inline';

const POOL_SIZE = CONFIG.PERFORMANCE.THUMBNAIL_QUEUE_SIZE;

let poolAvailable = false;
const free = []; // 空闲 worker 栈
const queue = []; // 满载时排队:{ file, targetSize, resolve, reject }

function dispatch(worker, task) {
  worker._task = task;
  // task 带 bitmap(视频抓帧路径)则 transfer(零拷贝);否则 File 走 structured-clone(共享底层 blob 引用)。
  // 统一消息形状 {file?, bitmap?, targetSize},worker 端按 bitmap 是否存在二选一。
  worker.postMessage(
    { file: task.file, bitmap: task.bitmap, targetSize: task.targetSize },
    task.bitmap ? [task.bitmap] : [],
  );
}

function release(worker) {
  // 有排队任务则直接顶上,否则归入空闲栈(worker 此刻正忙刚结束,不可能已在 free 中)
  if (queue.length)
    dispatch(worker, queue.shift());
  else
    free.push(worker);
}

function onMsg(worker, e) {
  const task = worker._task;
  worker._task = null;
  if (!task)
    return;
  if (e.data.ok)
    task.resolve(e.data.blob);
  else
    task.reject(new Error(e.data.error));
  release(worker);
}

if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new ThumbnailWorker();
      w.onmessage = e => onMsg(w, e);
      w.onerror = (err) => {
        // worker 崩:reject 其在途任务(若有)。worker 不销毁、回空闲栈复用——崩过的 worker 下次派活
        // 可能仍失败(postMessage 后无 onmessage 回复),届时该任务靠自己的超时/调用方兜底处理。
        const task = w._task;
        w._task = null;
        if (task)
          task.reject(new Error(err?.message || 'thumbnail worker crashed'));
        release(w);
      };
      free.push(w);
    }
    poolAvailable = true;
  }
  catch {
    poolAvailable = false; // 兜底:整池建不起来 → 策略走主线程
  }
}

export function isPoolAvailable() {
  return poolAvailable;
}

function submit(task) {
  return new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
    if (free.length)
      dispatch(free.pop(), task);
    else
      queue.push(task);
  });
}

// 图片:File 进 worker,worker 内 createImageBitmap 解码。
export function renderInWorker(file, targetSize) {
  return submit({ file, targetSize });
}

// 视频帧:主线程 createImageBitmap(video) 抓好的帧,transfer 进 worker 做 cover-fit + 编码。
export function renderBitmapInWorker(bitmap, targetSize) {
  return submit({ bitmap, targetSize });
}
