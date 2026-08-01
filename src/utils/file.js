// 文件处理工具。搬自源码 js/utils.js。
// calculateMD5 只 hash 前 2MB——必须保留此语义,否则与老版本 IndexedDB 缓存 key 不一致。
// R15:SparkMD5 哈希搬到 Web Worker(消除快速滚动多卡进视窗算 md5 的主线程掉帧)。
import SparkMD5 from 'spark-md5';

// 单 worker + 队列(够用;想榨多核再上池)。worker 崩溃 → 回退主线程。
// 测试环境(jsdom 无法加载模块 worker)→ 直接走主线程,避免 calculateMD5 用例挂起。
let worker = null;
let workerBroken = import.meta.env?.MODE === 'test';
let msgId = 0;
const pending = new Map(); // id → { resolve, reject }
const inflight = new WeakMap(); // file → Promise(同文件在途去重,防快速滚动重复算)

function getWorker() {
  if (worker || workerBroken)
    return worker;
  try {
    worker = new Worker(new URL('./md5.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, hash, error } = e.data || {};
      const p = pending.get(id);
      if (!p)
        return;
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(hash);
    };
    worker.onerror = (e) => {
      // worker 崩:reject 全部在途 + 标记回退主线程。
      for (const { reject } of pending.values())
        reject(new Error(e.message || 'md5 worker error'));
      pending.clear();
      worker = null;
      workerBroken = true;
    };
  }
  catch {
    workerBroken = true;
  }
  return worker;
}

function hashInWorker(buffer) {
  const w = getWorker();
  if (!w)
    return Promise.resolve(SparkMD5.ArrayBuffer.hash(buffer)); // 兜底:主线程同步算
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, buffer }, [buffer]); // transfer 零拷贝(buffer 之后失效)
  });
}

// 只 hash 前 2MB(性能换碰撞率)。chunkSize 必须保持 2097152,不可改全文件分片(老 IDB key 兼容)。
export async function calculateMD5(file) {
  // 同文件在途去重:命中复用同一 Promise,避免快速滚动重复算。
  if (inflight.has(file))
    return inflight.get(file);
  const p = (async () => {
    const chunkSize = 2097152; // 2MB
    const buffer = await file.slice(0, chunkSize).arrayBuffer();
    try {
      return await hashInWorker(buffer);
    }
    finally {
      inflight.delete(file);
    }
  })();
  inflight.set(file, p);
  return p;
}

// 文件头魔数识别,返回 [width, height, type] 或 null(不支持格式)。位运算逐字符照搬源码,勿改。
// T18:接入 metadata image strategy 读 dimensions(零解码,替代 new Image 整图解码)。
export async function getImageInfoFromHeader(file) {
  if (file.size < 30)
    return null;
  let view = new DataView(await file.slice(0, 30).arrayBuffer());
  const sign = view.getUint32(0);

  if (sign === 0x89504E47)
    return [view.getUint32(16), view.getUint32(20), 'png'];
  if (sign === 0x47494638)
    return [view.getUint16(6, true), view.getUint16(8, true), 'gif'];
  if ((sign >>> 16) === 0x424D)
    return [Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)), 'bmp'];
  if ((sign >>> 8) === 0xFFD8FF) {
    const jpegData = await file.slice(0, 128 * 1024).arrayBuffer();
    view = new DataView(jpegData);
    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset);
      offset += 2;
      if (marker === 0xFFC0 || marker === 0xFFC2)
        return [view.getUint16(offset + 3), view.getUint16(offset + 1), 'jpg'];
      offset += view.getUint16(offset);
    }
  }
  else if (sign === 0x52494646) {
    view = new DataView(await file.slice(0, 40).arrayBuffer());
    const vp8 = view.getUint32(12);
    if (vp8 === 0x56503820)
      return [view.getUint16(26, true), view.getUint16(28, true), 'webp'];
    if (vp8 === 0x56503858) {
      return [
        (view.getUint32(24, true) & 0x00FFFFFF) + 1,
        ((view.getUint32(27, true) >> 8) & 0x00FFFFFF) + 1,
        'webp',
      ];
    }
    if (vp8 === 0x5650384C) {
      const b1 = view.getUint16(21, true);
      const b2 = view.getUint16(22, true);
      return [(b1 & 0x3FFF) + 1, ((b2 >> 6) & 0x3FFF) + 1, 'webp'];
    }
  }
  return null;
}

export function convertToPngBlob(blobUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (blob)
              resolve(blob);
            else reject(new Error('Canvas 导出失败'));
          },
          'image/png',
          1.0,
        );
      }
      catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败，无法转码'));
    img.src = blobUrl;
  });
}
