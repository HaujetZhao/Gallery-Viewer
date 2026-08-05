// 缩略图降采样+编码 worker。两种输入:
//  ① { file, targetSize } —— 图片:worker 内 createImageBitmap(file) 解码(走共享解码线程池,off)。
//  ② { bitmap, targetSize } —— 视频:主线程 createImageBitmap(video) 已抓好的帧(transfer 进来,零拷贝)。
// 然后 OffscreenCanvas 原始比例(最短边=targetSize)满幅 drawImage + convertToBlob → 小 jpeg blob 回主线程。
// 全分辨率 bitmap 只在 worker 堆存活,主线程不实例化/不 GC。画布 = 原比例:卡片方形 cover 裁切显示,
// hover「放大」时能露全图(旧方形画布在 worker 内裁切,露不了)。
import { fitOriginalRatioParams } from '../utils/coverFit';

globalThis.onmessage = async (e) => {
  const { file, bitmap: inBitmap, targetSize } = e.data;
  let bitmap = inBitmap;
  try {
    if (!bitmap)
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    // 最短边 = targetSize 的原比例画布;满幅(无裁)draw,保留原始宽高比。
    const { dw, dh } = fitOriginalRatioParams(bitmap.width, bitmap.height, targetSize);
    const canvas = new OffscreenCanvas(dw, dh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, dw, dh);
    bitmap.close?.();
    bitmap = null;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    // Blob 非 transferable,走 structured-clone(400² jpeg ~几十 KB,可忽略)。
    globalThis.postMessage({ ok: true, blob });
  }
  catch (err) {
    // bitmap 可能为 null(成功路径已置空);close?.() 对已关闭/失效位图是安全的空操作。
    bitmap?.close?.();
    globalThis.postMessage({ ok: false, error: err?.message || 'worker render failed' });
  }
};
