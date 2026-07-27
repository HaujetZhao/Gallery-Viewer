// 元数据提取策略。搬自源码 js/metadata-strategies.js。
// image:dimensions + EXIF;video:loadedmetadata;audio:时长 + MP3 ID3;svg:dimensions。
import { FileTypes } from '../config/file-types';
import { extractExif } from './exif';
import { extractID3Tags } from './id3-parser';

export function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '未知';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MetadataStrategies = {
  image: {
    types: [...FileTypes.image.standard, ...FileTypes.image.gif],
    async getMetadata(file) {
      const metadata = {};
      metadata.dimensions = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = file.blobUrl;
      });
      try {
        const fileObj = file.handle ? await file.handle.getFile() : file.file;
        metadata.exif = await extractExif(fileObj);
      } catch (e) {
        console.error('读取EXIF失败', e);
      }
      return metadata;
    },
  },
  video: {
    types: FileTypes.video.all,
    async getMetadata(file) {
      const metadata = {};
      metadata.dimensions = await new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        const cleanup = () => {
          v.removeAttribute('src');
          v.load();
        };
        v.addEventListener(
          'loadedmetadata',
          () => {
            const dim = { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
            if (file.size && v.duration) dim.estimatedBitrate = Math.round((file.size * 8) / v.duration / 1000);
            cleanup();
            resolve(dim);
          },
          { once: true },
        );
        v.addEventListener(
          'error',
          () => {
            cleanup();
            resolve({ width: 0, height: 0, duration: 0 });
          },
          { once: true },
        );
        v.src = file.blobUrl;
      });
      return metadata;
    },
  },
  audio: {
    types: FileTypes.audio.all,
    async getMetadata(file) {
      const metadata = {};
      metadata.dimensions = await new Promise((resolve) => {
        const a = new Audio();
        a.preload = 'metadata';
        const cleanup = () => {
          a.removeAttribute('src');
          a.load();
        };
        a.addEventListener(
          'loadedmetadata',
          () => {
            cleanup();
            resolve({ duration: a.duration });
          },
          { once: true },
        );
        a.addEventListener(
          'error',
          () => {
            cleanup();
            resolve({ duration: 0 });
          },
          { once: true },
        );
        a.src = file.blobUrl;
      });
      if (file.type === 'mp3') {
        try {
          const id3 = await extractID3Tags(file);
          if (id3) metadata.id3 = id3;
        } catch (e) {
          console.error('提取 ID3 失败:', e);
        }
      }
      return metadata;
    },
  },
  svg: {
    types: FileTypes.image.svg,
    async getMetadata(file) {
      const metadata = {};
      metadata.dimensions = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = file.blobUrl;
      });
      return metadata;
    },
  },
};

export function getMetadataStrategy(fileType) {
  for (const strategy of Object.values(MetadataStrategies)) {
    if (strategy.types.includes(fileType)) return strategy;
  }
  return MetadataStrategies.image;
}
