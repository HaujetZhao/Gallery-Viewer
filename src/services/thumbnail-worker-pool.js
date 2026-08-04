// OffscreenCanvas worker 池。每个 worker 一次处理一张图;POOL_SIZE 对齐缩略图并发上限,
// 8 个在途任务各占一个 worker,解码+降采样+编码在 8 个 worker 线程上真并行,主线程零参与。
//
// renderInWorker(file, targetSize) → Promise<blob>:File 经 structured-clone 进 worker(廉价,共享底层数据),
// worker 内 createImageBitmap + cover-fit drawImage + convertToBlob,回传小 jpeg blob。
// 无 Worker / OffscreenCanvas(如测试环境 jsdom)→ isPoolAvailable()=false,策略走主线程兜底。
import { CONFIG } from '../config/index';

const POOL_SIZE = CONFIG.PERFORMANCE.THUMBNAIL_QUEUE_SIZE;

let poolAvailable = false;
const free = []; // 空闲 worker 栈
const queue = []; // 满载时排队:{ file, targetSize, resolve, reject }

function dispatch(worker, task) {
  worker._task = task;
  // File 非 transferable 但可 structured-clone(共享底层 blob 数据引用),无需转移列表。
  worker.postMessage({ file: task.file, targetSize: task.targetSize });
}

function release(worker) {
  // 有排队任务则直接顶上,否则归入空闲栈
  if (queue.length)
    dispatch(worker, queue.shift());
  else if (!free.includes(worker))
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
    const url = new URL('./thumbnail-worker.js', import.meta.url);
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(url, { type: 'module' });
      w.onmessage = e => onMsg(w, e);
      w.onerror = (err) => {
        // worker 崩:reject 其在途任务(若有),worker 仍可复用(下次 onmessage 失败再 reject)
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

export function renderInWorker(file, targetSize) {
  return new Promise((resolve, reject) => {
    const task = { file, targetSize, resolve, reject };
    if (free.length)
      dispatch(free.pop(), task);
    else
      queue.push(task);
  });
}
