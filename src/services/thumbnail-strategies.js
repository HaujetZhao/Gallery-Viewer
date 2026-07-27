// 缩略图生成策略。搬自源码 js/thumbnail-strategies.js,零改动(仅加 export + import FileTypes)。
// 为不同媒体类型提供缩略图生成和卡片标识。
import { FileTypes } from '../config/file-types';

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
      const img = new Image();
      img.src = fileData.blobUrl;
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

      return new Promise((resolve) => {
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
      });
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
      element.src = fileData.blobUrl;
      return null; // GIF 不需要缓存
    },

    getCardBadge: () => null,
  },

  // SVG 策略
  svg: {
    types: FileTypes.image.svg,

    createThumbnailElement: () => {
      const object = document.createElement('object');
      object.className = 'thumbnail-svg';
      object.type = 'image/svg+xml';
      return object;
    },

    generateThumbnail: async (element, fileData) => {
      element.data = fileData.blobUrl;
      return new Promise((resolve, reject) => {
        element.onload = () => resolve(null);
        element.onerror = () => reject(new Error('SVG 加载失败'));
      });
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
