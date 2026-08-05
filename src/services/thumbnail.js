import { triggerRedraw } from '../composables/useThumbnail';
import { ensureBlobUrl, getFile } from '../models/SmartFile';
import { useFavoritesStore } from '../stores/favorites';
import { useFsStore } from '../stores/fs';
import { useNotesStore } from '../stores/notes';
import { useToastStore } from '../stores/uiToast';
import { useUserSettingsStore } from '../stores/userSettings';
import { isDegradedFSA } from '../utils/browser';
// 缩略图生成主体。搬自源码 js/thumbnails.js 的 generateAndShowThumbnail,去 observer/队列/DOM 耦合。
// 接收 (file: SmartFile, canvas: HTMLCanvasElement, targetSize) → 查缓存→命中画/未命中生成存→画到 canvas。
// IntersectionObserver + 并发队列留到阶段 5 gallery 的 useThumbnail composable。
import { calculateMD5 } from '../utils/file';
import { deleteThumbnail, getThumbnailFromDB, saveThumbnailToDB, thumbnailKey, touchThumbnailInDB } from './db';
import { extractExifEssentials } from './exif';
import { ensureFileMetaLoaded, saveFileMeta } from './fileMeta';
import { peek } from './fileResource';
import { refreshFolder } from './folderActions';
import { afterFolderMutation } from './persistence';
import { drawBlobToCanvas, extractAudioDuration, getThumbnailStrategy } from './thumbnail-strategies';
import { collectDegradedMd5 } from './webkitDirectory';

// drawBlobToCanvas(缓存命中 + worker 回传 blob 共用)从 thumbnail-strategies.js 导入。

// 卡片媒体元数据统一加载器:md5 + file-meta(时长/dim) + audio duration + favorites/notes。
// 幂等(md5 已有则跳,ensureLoaded 重复无害)。所有卡片(含视频预览)进视口(100px)时统一调一次,
// 爱心/时长角标/备注即有数据。原 generateThumbnail/ensureVideoPreviewMeta 里的三份重复序列合并于此。
export async function loadCardMetadata(file) {
  await ensureBlobUrl(file); // listFolder 零 getFile 后 blobUrl=null,懒 acquire(复用 enrich 池)
  if (!file.md5) {
    // 内容寻址缓存键 + favorites/notes 索引键。前 2MB,chunkSize 锁死(旧 IDB key 兼容)。
    const raw = await getFile(file);
    file.md5 = await calculateMD5(raw);
    if (isDegradedFSA())
      collectDegradedMd5(file.path, file.md5); // 降级:增量收集 → 目录指纹快照(免下次重算)
    // md5 随快照持久化 → 切根/重载零重算;全局收藏/备注筛选也覆盖未进视窗的文件。幂等(null→有值)。
    afterFolderMutation(file.parent);
  }
  await ensureFileMetaLoaded(file); // duration/dim 填 _meta(缓存命中分支不抽帧也能拿)
  if (file.type?.startsWith('audio/') && file._meta?.duration == null)
    await extractAudioDuration(file); // 音频时长独立抽(不依赖缩略图抽帧);extractAudioDuration 内部 saveFileMeta
  // —— 图片 EXIF 核心字段(capturedAt 拍摄时间 + GPS)懒抽,与 md5 同属"读内容"重活,汇聚于此 ——
  // exifChecked 哨兵(已查过,含"无 EXIF")→ 跳过,避免反复抽;存量 md5 已缓存但从未抽过的首次视窗自动回填。
  // 非 image 策略(GIF/SVG/视频)不抽(EXIF 主要属 JPEG/PNG 等位图);saveFileMeta 内部无 md5 则跳过(此处 md5 已算)。
  if (getThumbnailStrategy(file.type).name === 'image' && file._meta?.exifChecked !== true) {
    const ess = await extractExifEssentials(peek(file)?.file);
    await saveFileMeta(file, ess ? { ...ess, exifChecked: true } : { exifChecked: true }); // 无 EXIF 也打哨兵,不再重抽
  }
  await Promise.all([
    useFavoritesStore().ensureLoaded(file.md5), // 爱心
    useNotesStore().ensureLoaded(file.md5), // 备注
  ]);
}

// 缩略图渲染/缓存:假定 loadCardMetadata 已跑(md5 就绪)。GIF/SVG 不缓存直接渲染;
// image/video(缩略图模式)/audio 走 IDB 缓存(md5+targetSize)。返回 { cached, strategyName }。
// onDrawn:缩略图「已画到元素(可见)」时调,useThumbnail 据此即刻翻 loaded(移除转场遮罩)。
// image 策略整条管线在 worker 池跑,主线程零参与;onDrawn 在 worker 回传 blob 画上可见 canvas 后才翻。
export async function renderThumbnail(file, element, targetSize = 400, onDrawn) {
  const strategy = getThumbnailStrategy(file.type);

  // GIF/SVG:不缓存,直接渲染(动画/内联)。
  if (strategy.name === 'gif' || strategy.name === 'svg') {
    await strategy.generateThumbnail(element, file, targetSize);
    return { cached: false, strategyName: strategy.name };
  }

  const cached = await getThumbnailFromDB(file.md5, targetSize);
  if (cached) {
    await drawBlobToCanvas(element, cached.blob);
    onDrawn?.();
    touchThumbnailInDB(thumbnailKey(file.md5, targetSize)); // 异步刷新 lastAccessed(不阻塞,修源码陷阱)
    return { cached: true, strategyName: strategy.name };
  }

  // 未命中:策略生成(image 策略整条管线在 worker 池跑,主线程零参与)→ 存 DB(fire-and-forget)。
  const blob = await strategy.generateThumbnail(element, file, targetSize, onDrawn);
  if (blob) {
    saveThumbnailToDB({
      id: thumbnailKey(file.md5, targetSize),
      md5: file.md5,
      size: file.size,
      width: targetSize,
      timestamp: Date.now(),
      blob,
    });
  }
  return { cached: false, strategyName: strategy.name };
}

// 强制重绘当前视图缩略图:先 refreshFolder(读全部元数据 + 清变 md5)→ 删当前 folder 各文件缓存 → triggerRedraw 重挂卡片重生成。
// 搬自源码 js/filesystem.js forceRegenerateCurrentThumbnails。GIF/SVG 无 md5 自动跳过(它们本就不缓存)。
// ALL_MEDIA / 无 handle 跳过刷新(只删缓存),普通 folder 先刷新(内容变的图 md5 被清 → 删缓存重生 → 缩略图更新)。
export async function forceRegenerateCurrentThumbnails() {
  const fs = useFsStore();
  const settings = useUserSettingsStore();
  const toast = useToastStore();
  const folder = fs.currentFolder;
  // 先刷新(读全部元数据 + 清变 md5);ALL_MEDIA 无 handle 跳过
  if (folder && folder !== fs.allMediaFolder && folder.handle) {
    try {
      await refreshFolder(folder);
    }
    catch (e) {
      console.warn('重绘前刷新失败:', e);
    }
  }
  const files = folder?.files || []; // refresh 后取(增删改已反映)
  if (!files.length) {
    toast.info('当前没有文件');
    return;
  }
  const targetSize = settings.settings.thumbnailSize;
  let deleteCount = 0;
  for (const file of files) {
    if (file.md5)
      deleteThumbnail(thumbnailKey(file.md5, targetSize));
    deleteCount++;
  }
  toast.success(`已清除 ${deleteCount} 个缩略图缓存,正在重新生成...`);
  triggerRedraw();
}
