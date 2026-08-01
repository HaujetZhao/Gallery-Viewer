// 缩略图生成策略。搬自源码 js/thumbnail-strategies.js,零改动(仅加 export + import FileTypes)。
// 为不同媒体类型提供缩略图生成和卡片标识。
//
// R3-1:image 策略改用 createImageBitmap 解码(off-main-thread,比 Image+onload 快、不占主线程)。
// 关键等价性:createImageBitmap 默认 imageOrientation:'none'(不正 EXIF),而 <img> 元素默认 from-image。
// 必须传 { imageOrientation: 'from-image' },否则带 EXIF 方向的手机照片缩略图会侧躺/倒置。
import { FileTypes } from '../config/file-types';
import { ensureBlobUrl } from '../models/SmartFile';
import { peek } from './fileResource';

export const ThumbnailStrategies = {
  // 图片策略
  image: {
    types: FileTypes.image.standard,

    createThumbnailElement: () => {
      const canvas = document.createElement('canvas');
      canvas.className = 'thumbnail-canvas';
      return canvas;
    },

    generateThumbnail: async (element, fileData, targetSize) => {
      // R3-1:createImageBitmap 解码(off-main-thread,比 Image+onload 快)。
      // File 来源:复用池里 ensureBlobUrl/peek 已 acquire 的 File(thumbnail.js md5 计算也这么复用),
      // peek 未命中才 fallback handle.getFile()——不二次 IO。
      // imageOrientation:'from-image' 保持 EXIF 方向等价(<img> 默认行为)。
      const file = peek(fileData)?.file ?? await fileData.handle.getFile();
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

      try {
        const canvas = element;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        const ratio = Math.max(targetSize / bitmap.width, targetSize / bitmap.height);
        const centerShift_x = (targetSize - bitmap.width * ratio) / 2;
        const centerShift_y = (targetSize - bitmap.height * ratio) / 2;

        ctx.drawImage(
          bitmap,
          0,
          0,
          bitmap.width,
          bitmap.height,
          centerShift_x,
          centerShift_y,
          bitmap.width * ratio,
          bitmap.height * ratio,
        );

        return new Promise((resolve) => {
          canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
        });
      }
      finally {
        bitmap.close?.(); // 释放位图内存(无论 toBlob 成败)
      }
    },

    getCardBadge: () => null,
  },

  // GIF 策略
  gif: {
    types: FileTypes.image.gif,

    createThumbnailElement: () => {
      const img = document.createElement('img');
      img.className = 'thumbnail-img';
      return img;
    },

    generateThumbnail: async (element, fileData) => {
      // GIF 靠 <img src=blobUrl> 显示动画(不能像 image 解码进 canvas,否则只剩首帧)。
      // 必须先 ensureBlobUrl:切根走 fileFromSnapshot 秒重建后池空、blobUrl=null,
      // 直接 fileData.blobUrl 会把 src 设成 "null" → 空白(无报错,间歇自愈)。返回值即 url,直接用。
      element.src = await ensureBlobUrl(fileData);
      return null; // GIF 不需要缓存
    },

    getCardBadge: () => null,
  },

  // SVG 策略:inline 渲染(fetch 文本 → innerHTML),与 modal 的 SVG 显示完全同机制(v-html 也是 innerHTML)。
  // 为何不用 <img>/<object>:<img> 加载含脚本/外部引用的 SVG 会被安全策略拒绝(onerror,如 EZtools 快键键.svg);
  // <object> 加载像素 width/height 的 SVG 嵌套浏览上下文渲染异常(图形错位,"页面缩小版")。inline 绕开两者——
  // SVG 文本直接进 DOM(innerHTML 注入的 <script> 不执行,安全),配 .thumbnail-svg :deep(svg) 控制尺寸(contain)。
  svg: {
    types: FileTypes.image.svg,

    createThumbnailElement: () => {
      const div = document.createElement('div');
      div.className = 'thumbnail-svg';
      return div;
    },

    generateThumbnail: async (element, fileData) => {
      // 与 image 策略一致:peek 池里 File ?? handle.getFile() 兜底,不依赖 blobUrl。
      // 切根走 fileFromSnapshot 秒重建后池空、blobUrl=null,fetch(null) 会静默注入空/非 SVG
      // 内容 → 空白缩略图(浏览器无报错)。用 File.text() 直接读,无需 blobUrl,也不污染池。
      const file = peek(fileData)?.file ?? await fileData.handle.getFile();
      element.innerHTML = await file.text();
    },

    getCardBadge: () => null,
  },

  // 视频策略
  video: {
    types: FileTypes.video.all,

    createThumbnailElement: () => {
      const canvas = document.createElement('canvas');
      canvas.className = 'thumbnail-canvas';
      return canvas;
    },

    drawVideoFrame: (canvas, video, targetSize) => {
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(targetSize / video.videoWidth, targetSize / video.videoHeight);
      const centerShift_x = (targetSize - video.videoWidth * ratio) / 2;
      const centerShift_y = (targetSize - video.videoHeight * ratio) / 2;
      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        centerShift_x,
        centerShift_y,
        video.videoWidth * ratio,
        video.videoHeight * ratio,
      );
    },

    drawDefaultThumbnail: (canvas, targetSize) => {
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, targetSize, targetSize);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, targetSize, targetSize);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `${targetSize * 0.4}px "Font Awesome 6 Free"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▶', targetSize / 2, targetSize / 2);
    },

    generateThumbnail: async (element, fileData, targetSize) => {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        let captured = false;
        let timeoutId = null;

        function cleanup() {
          if (timeoutId)
            clearTimeout(timeoutId);
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
          video.src = '';
        }

        function finishWithDefault() {
          cleanup();
          ThumbnailStrategies.video.drawDefaultThumbnail(element, targetSize);
          element.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
        }

        function onLoadedMetadata() {
          // R11:顺带抽 duration 存 _meta(仅首次、有效有限值),随快照持久化。ensureBlobUrl 已写 size/lastModified。
          if (fileData._meta && fileData._meta.duration == null && Number.isFinite(video.duration))
            fileData._meta = { ...fileData._meta, duration: video.duration };
          video.currentTime = Math.min(5, video.duration / 2);
        }

        function onSeeked() {
          if (captured)
            return;
          captured = true;
          try {
            ThumbnailStrategies.video.drawVideoFrame(element, video, targetSize);
            element.toBlob((blob) => {
              cleanup();
              resolve(blob);
            }, 'image/jpeg', 0.85);
          }
          catch {
            finishWithDefault();
          }
        }

        function onError() {
          finishWithDefault();
        }

        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);

        timeoutId = setTimeout(() => {
          if (!captured)
            finishWithDefault();
        }, 10000);

        video.src = fileData.blobUrl;
      });
    },

    getCardBadge: () => ({
      icon: 'fa-play-circle',
      text: 'VIDEO',
      className: 'badge-video',
    }),
  },

  // 音频策略
  audio: {
    types: FileTypes.audio.all,

    createThumbnailElement: () => {
      const canvas = document.createElement('canvas');
      canvas.className = 'thumbnail-canvas';
      return canvas;
    },

    generateThumbnail: async (element, fileData, targetSize) => {
      // 顺带抽 duration 存 _meta(镜像 video R11),供卡片右上 badge 显示音频时长。
      if (fileData._meta && fileData._meta.duration == null && fileData.blobUrl)
        await extractAudioDuration(fileData);
      try {
        const coverBlob = await extractAudioCover(fileData);
        if (coverBlob) {
          const img = new Image();
          img.src = URL.createObjectURL(coverBlob);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });

          const canvas = element;
          canvas.width = targetSize;
          canvas.height = targetSize;
          const ctx = canvas.getContext('2d');
          const ratio = Math.max(targetSize / img.width, targetSize / img.height);
          const centerShift_x = (targetSize - img.width * ratio) / 2;
          const centerShift_y = (targetSize - img.height * ratio) / 2;

          ctx.drawImage(
            img,
            0,
            0,
            img.width,
            img.height,
            centerShift_x,
            centerShift_y,
            img.width * ratio,
            img.height * ratio,
          );

          URL.revokeObjectURL(img.src);

          return new Promise((resolve) => {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
          });
        }
      }
      catch (err) {
        console.warn('无法提取音频封面:', err.message);
      }

      // 默认音频图标
      const canvas = element;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');

      const gradient = ctx.createLinearGradient(0, 0, targetSize, targetSize);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, targetSize, targetSize);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `${targetSize * 0.4}px "Font Awesome 6 Free"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎵', targetSize / 2, targetSize / 2);

      return new Promise((resolve) => {
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
      });
    },

    getCardBadge: () => ({
      icon: 'fa-music',
      text: 'AUDIO',
      className: 'badge-audio',
    }),
  },
};

// 抽取音频时长(创建 <audio preload=metadata> 读 duration),写回 fileData._meta.duration。
// 4s 超时兜底(损坏文件/jsdom 不触发 loadedmetadata 也不卡住);镜像 video 抽帧时的时长提取。
function extractAudioDuration(fileData) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let done = false;
    let timer = null;
    function finish() {
      if (done)
        return;
      done = true;
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('error', finish);
      audio.src = '';
      resolve();
    }
    function onMeta() {
      if (fileData._meta && fileData._meta.duration == null && Number.isFinite(audio.duration))
        fileData._meta = { ...fileData._meta, duration: audio.duration };
      finish();
    }
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error', finish);
    timer = setTimeout(finish, 4000);
    audio.src = fileData.blobUrl;
  });
}

// 从音频文件(MP3 ID3v2 APIC 帧)提取封面图片。
export async function extractAudioCover(fileData) {
  try {
    const file = await fileData.handle.getFile();
    const maxSize = Math.min(file.size, 5 * 1024 * 1024); // 只读前 5MB
    const arrayBuffer = await file.slice(0, maxSize).arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // ID3v2 头: 'I','D','3'
    if (!(uint8Array[0] === 0x49 && uint8Array[1] === 0x44 && uint8Array[2] === 0x33)) {
      return null;
    }

    const version = uint8Array[3]; // 3 = v2.3, 4 = v2.4

    // synchsafe integer 标签大小
    const tagSize
      = ((uint8Array[6] & 0x7F) << 21)
        | ((uint8Array[7] & 0x7F) << 14)
        | ((uint8Array[8] & 0x7F) << 7)
        | (uint8Array[9] & 0x7F);

    let offset = 10;
    const tagEnd = 10 + tagSize;

    while (offset < tagEnd - 10) {
      const frameId = String.fromCharCode(
        uint8Array[offset],
        uint8Array[offset + 1],
        uint8Array[offset + 2],
        uint8Array[offset + 3],
      );

      if (frameId === '\0\0\0\0')
        break;

      // v2.4 帧 size 是 synchsafe,v2.3 是普通 32-bit int
      let frameSize;
      if (version === 4) {
        frameSize
          = ((uint8Array[offset + 4] & 0x7F) << 21)
            | ((uint8Array[offset + 5] & 0x7F) << 14)
            | ((uint8Array[offset + 6] & 0x7F) << 7)
            | (uint8Array[offset + 7] & 0x7F);
      }
      else {
        frameSize
          = (uint8Array[offset + 4] << 24)
            | (uint8Array[offset + 5] << 16)
            | (uint8Array[offset + 6] << 8)
            | uint8Array[offset + 7];
      }

      if (frameId === 'APIC') {
        const frameDataOffset = offset + 10;
        let pos = frameDataOffset;
        pos++; // textEncoding(1)

        let mimeType = '';
        while (pos < frameDataOffset + frameSize && uint8Array[pos] !== 0) {
          mimeType += String.fromCharCode(uint8Array[pos]);
          pos++;
        }
        pos++; // null 终止符
        pos++; // pictureType(1)
        while (pos < frameDataOffset + frameSize && uint8Array[pos] !== 0) pos++; // 描述
        pos++; // null 终止符

        const imageData = uint8Array.slice(pos, frameDataOffset + frameSize);
        return new Blob([imageData], { type: mimeType || 'image/jpeg' });
      }

      offset += 10 + frameSize;
    }

    return null;
  }
  catch {
    return null;
  }
}

// 根据文件类型(扩展名)获取缩略图策略,无匹配 fallback 到 image。
export function getThumbnailStrategy(fileType) {
  for (const [strategyName, strategy] of Object.entries(ThumbnailStrategies)) {
    if (strategy.types.includes(fileType)) {
      return { name: strategyName, ...strategy };
    }
  }
  return { name: 'image', ...ThumbnailStrategies.image };
}
