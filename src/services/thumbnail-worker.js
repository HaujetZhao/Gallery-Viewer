// 缩略图解码+降采样+编码 worker(方案B)。收主线程传来的 File(structured-clone,廉价),
// 在 worker 内 createImageBitmap 解码 → OffscreenCanvas cover-fit drawImage + convertToBlob → jpeg blob 回传。
//
// 全分辨率 bitmap(50MP≈200MB)从头到尾只在 worker 堆里存活——主线程不实例化、不 GC,
// 治方案A 残留的尾部 longtask(50MP bitmap 在主线程实例化+回收造成的 ~400ms 突发)。
// createImageBitmap 解码仍走浏览器共享解码线程池(off),并行度与主线程调用一致,不拖慢。
// bitmap 宽高已是解码后真实尺寸(含 EXIF 方向),cover-fit 天然保持比例,无压扁。
globalThis.onmessage = async (e) => {
  const { file, targetSize } = e.data;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = new OffscreenCanvas(targetSize, targetSize);
    const ctx = canvas.getContext('2d');
    const ratio = Math.max(targetSize / bitmap.width, targetSize / bitmap.height);
    const dx = (targetSize - bitmap.width * ratio) / 2;
    const dy = (targetSize - bitmap.height * ratio) / 2;
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, dx, dy, bitmap.width * ratio, bitmap.height * ratio);
    bitmap.close?.();
    bitmap = null;
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    // Blob 非 transferable(只有 ArrayBuffer/ImageBitmap/OffscreenCanvas 等才是),走 structured-clone 复制;
    // 400² jpeg ~几十 KB,复制开销可忽略。
    globalThis.postMessage({ ok: true, blob });
  }
  catch (err) {
    try {
      bitmap?.close?.();
    }
    catch {
      // bitmap 可能已失效
    }
    globalThis.postMessage({ ok: false, error: err?.message || 'worker render failed' });
  }
};
