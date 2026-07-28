// 文件处理工具。搬自源码 js/utils.js。
// calculateMD5 只 hash 前 2MB——必须保留此语义,否则与老版本 IndexedDB 缓存 key 不一致。
import SparkMD5 from 'spark-md5';

// 只 hash 前 2MB(性能换碰撞率)。chunkSize 必须保持 2097152,不可改全文件分片(老 IDB key 兼容)。
export async function calculateMD5(file) {
  const chunkSize = 2097152; // 2MB
  const buffer = await file.slice(0, chunkSize).arrayBuffer();
  return SparkMD5.ArrayBuffer.hash(buffer);
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
