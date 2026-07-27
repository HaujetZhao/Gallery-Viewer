// 文件处理工具。搬自源码 js/utils.js。
// calculateMD5 只 hash 前 2MB——必须保留此语义,否则与老版本 IndexedDB 缓存 key 不一致。
import SparkMD5 from 'spark-md5';

export function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

// 只 hash 前 2MB(性能换碰撞率)。chunkSize 必须保持 2097152,不可改全文件分片。
export function calculateMD5(file) {
  return new Promise((resolve, reject) => {
    const chunkSize = 2097152; // 2MB
    const chunk = file.slice(0, chunkSize);
    const fileReader = new FileReader();
    fileReader.onload = e => resolve(SparkMD5.ArrayBuffer.hash(e.target.result));
    fileReader.onerror = reject;
    fileReader.readAsArrayBuffer(chunk);
  });
}

// 文件头魔数识别,返回 [width, height, type] 或 null。位运算逐字符照搬源码,勿改。
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

export async function verifyHandlePermission(handle) {
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted')
    return true;
  if ((await handle.requestPermission({ mode: 'read' })) === 'granted')
    return true;
  throw new Error('权限被拒绝');
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
