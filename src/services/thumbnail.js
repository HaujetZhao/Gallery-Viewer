// 缩略图生成主体。搬自源码 js/thumbnails.js 的 generateAndShowThumbnail,去 observer/队列/DOM 耦合。
// 接收 (file: SmartFile, canvas: HTMLCanvasElement, targetSize) → 查缓存→命中画/未命中生成存→画到 canvas。
// IntersectionObserver + 并发队列留到阶段 5 gallery 的 useThumbnail composable。
import { calculateMD5 } from '../utils/file';
import { getThumbnailStrategy } from './thumbnail-strategies';
import { getThumbnailFromDB, saveThumbnailToDB, touchThumbnailInDB, deleteThumbnail } from './db';
import { triggerRedraw } from '../composables/useThumbnail';
import { useFsStore } from '../stores/fs';
import { useUserSettingsStore } from '../stores/userSettings';
import { useToastStore } from '../stores/uiToast';

// 把缓存 blob 画到 canvas(缓存恢复,不做缩放,blob 本就是 targetSize 方图)。
function drawBlobToCanvas(canvas, blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// 生成缩略图并画到 canvas。返回 { cached, strategyName }。
// GIF/SVG 不缓存,直接渲染;image/video/audio 走 IndexedDB 缓存(md5 + targetSize 为键)。
export async function generateThumbnail(file, canvas, targetSize = 400) {
  const strategy = getThumbnailStrategy(file.type);

  // GIF/SVG 快路径:不缓存
  if (strategy.name === 'gif' || strategy.name === 'svg') {
    await strategy.generateThumbnail(canvas, file, targetSize);
    return { cached: false, strategyName: strategy.name };
  }

  // 缓存路径:image/video/audio。md5 懒加载(首次算后存 file.md5)。
  if (!file.md5) {
    const raw = await file.handle.getFile();
    file.md5 = await calculateMD5(raw);
  }
  const cached = await getThumbnailFromDB(file.md5, targetSize);

  if (cached) {
    await drawBlobToCanvas(canvas, cached.blob);
    touchThumbnailInDB(`${file.md5}_${targetSize}`); // 异步刷新 lastAccessed(不阻塞,修源码陷阱)
    return { cached: true, strategyName: strategy.name };
  }

  // 未命中:策略生成(已画到 canvas)→ 存 DB
  const blob = await strategy.generateThumbnail(canvas, file, targetSize);
  if (blob) {
    await saveThumbnailToDB({
      id: `${file.md5}_${targetSize}`,
      md5: file.md5,
      size: file.size,
      width: targetSize,
      timestamp: Date.now(),
      blob,
    });
  }
  return { cached: false, strategyName: strategy.name };
}

// 强制重绘当前视图缩略图:删当前 folder 各文件(已算 md5)的缓存 → triggerRedraw 重挂卡片重生成。
// 搬自源码 js/filesystem.js forceRegenerateCurrentThumbnails。GIF/SVG 无 md5 自动跳过(它们本就不缓存)。
export async function forceRegenerateCurrentThumbnails() {
  const fs = useFsStore();
  const settings = useUserSettingsStore();
  const toast = useToastStore();
  const files = fs.currentFolder?.files || [];
  if (!files.length) {
    toast.info('当前没有文件');
    return;
  }
  const targetSize = settings.settings.thumbnailSize;
  let deleteCount = 0;
  for (const file of files) {
    if (file.md5) {
      deleteThumbnail(`${file.md5}_${targetSize}`);
      deleteCount++;
    }
  }
  toast.success(`已清除 ${deleteCount} 个缩略图缓存,正在重新生成...`);
  triggerRedraw();
}
