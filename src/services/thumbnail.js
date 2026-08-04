import { triggerRedraw } from '../composables/useThumbnail';
import { ensureBlobUrl } from '../models/SmartFile';
import { useFavoritesStore } from '../stores/favorites';
import { useFsStore } from '../stores/fs';
import { useNotesStore } from '../stores/notes';
import { useToastStore } from '../stores/uiToast';
import { useUserSettingsStore } from '../stores/userSettings';
// 缩略图生成主体。搬自源码 js/thumbnails.js 的 generateAndShowThumbnail,去 observer/队列/DOM 耦合。
// 接收 (file: SmartFile, canvas: HTMLCanvasElement, targetSize) → 查缓存→命中画/未命中生成存→画到 canvas。
// IntersectionObserver + 并发队列留到阶段 5 gallery 的 useThumbnail composable。
import { calculateMD5 } from '../utils/file';
import { deleteThumbnail, getThumbnailFromDB, saveThumbnailToDB, touchThumbnailInDB } from './db';
import { ensureFileMetaLoaded } from './fileMeta';
import { peek } from './fileResource';
import { refreshFolder } from './folderActions';
import { afterFolderMutation } from './persistence';
import { extractAudioDuration, getThumbnailStrategy } from './thumbnail-strategies';

// 把缓存 blob 画到 canvas(缓存恢复,不做缩放,blob 本就是 targetSize 方图)。
// R3-1:createImageBitmap 解码(与 image 策略同型热路径,缓存命中也走解码,首切提速同样受益)。
// cached.blob 是之前 canvas.toBlob 存的"已正向" jpeg,但 createImageBitmap 默认 imageOrientation:'none',
// 为与原 <img> 行为保持一致(防御性,即使 jpeg 已正向也无害),仍传 'from-image'。
async function drawBlobToCanvas(canvas, blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
  }
  finally {
    bitmap.close?.(); // 释放位图内存
  }
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

  // listFolder 零 getFile 后,新文件 blobUrl 为 null。先 ensureBlobUrl 懒 acquire(复用 enrich 的池,不重复 IO)。
  await ensureBlobUrl(file);

  // 缓存路径:image/video/audio。md5 懒加载(首次算后存 file.md5)。
  if (!file.md5) {
    // 复用 ensureBlobUrl 已 acquire 的 File(peek 命中,不二次 getFile)。
    // 为何 md5(前 2MB)而非 size+mtime 当缓存键:
    //   ① 内容寻址——同一张照片在不同文件夹(不同 handle/路径,如父/子文件夹或复制副本),
    //      md5 相同即可共享同一份缩略图缓存;size+mtime 对「不同物理文件」必然 miss(mtime 随复制变)。
    //   ② md5 随快照持久化,切回时 file.md5 已恢复 → 直接查缓存,零 md5 计算、零 2MB 读(秒切零重算)。
    // 代价:首切每张可见图读 2MB 算 md5(按需、视窗触发,非万张预扫)。chunkSize=2097152 锁定(旧 IDB key 兼容)。
    const raw = peek(file)?.file ?? await file.handle.getFile();
    file.md5 = await calculateMD5(raw);
    // R16-a:首次算出 md5(null→有值)即落盘——md5 随该文件夹 record 持久化后,切根/重载直接命中缓存、
    // 全局收藏/备注筛选也能覆盖未进视窗的文件。per-folder:只标此夹脏(不动整库)。本分支只在 null→有值进入,幂等。
    afterFolderMutation(file.parent);
  }
  // file-meta 懒加载:md5 就绪后与缩略图同流程取回 duration/dim 填 _meta(缓存命中/未命中都需——
  // 缓存命中分支不再抽帧,否则副本的 duration 拿不到)。幂等:_meta.duration 已有则 skip。
  await ensureFileMetaLoaded(file);
  // audio duration 不依赖缩略图抽帧(独立 createAudio)——file-meta miss 时补抽,
  // 与缓存命中与否无关(否则缓存命中的音频永远拿不到 duration)。extractAudioDuration 内部 saveFileMeta。
  if (strategy.name === 'audio' && file._meta?.duration == null)
    await extractAudioDuration(file);
  // userData 懒加载:与 file-meta 同流程,填 favorites/notes 镜像(卡片爱心/备注即时显示)。
  // 仅 image/video/audio 走此分支(GIF/SVG 无 md5,现状不支持收藏/备注)。幂等:已加载则 skip。
  await Promise.all([
    useFavoritesStore().ensureLoaded(file.md5),
    useNotesStore().ensureLoaded(file.md5),
  ]);
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
      deleteThumbnail(`${file.md5}_${targetSize}`);
    deleteCount++;
  }
  toast.success(`已清除 ${deleteCount} 个缩略图缓存,正在重新生成...`);
  triggerRedraw();
}
