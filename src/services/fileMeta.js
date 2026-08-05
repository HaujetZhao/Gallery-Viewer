// file-meta store(md5 索引)的门面:文件固有媒体属性(duration/width/height/bitrate/capturedAt/gps)。
// 懒加载——视窗触发时 ensureFileMetaLoaded 填 file._meta(与缩略图同流程,无可见延迟)。
// saveFileMeta:抽到时 put + 同步填 _meta(运行时缓存,SmartFile.duration getter 读得到)。
import { runConcurrent } from '../utils/concurrency';
import { getFileMeta, putFileMeta } from './db';

// 视窗加载:若 file.md5 有且 _meta.duration 未填,查 store 填入(幂等)。
// 用 _meta.duration 是否已有作为"已加载"标志——duration 是 file-meta 的主字段,
// 其存在即代表该 md5 的 file-meta 已取回(其他字段 width/height 也会一并取回)。
export async function ensureFileMetaLoaded(file) {
  if (!file?.md5)
    return;
  if (file._meta?.duration != null)
    return; // 已加载(或已抽到)
  const meta = await getFileMeta(file.md5);
  if (!meta)
    return;
  file._meta = { ...file._meta, ...meta };
  delete file._meta.md5; // md5 不进 _meta(避免冗余)
}

// 抽到媒体属性时调:put store(合并)+ 填 _meta 运行时缓存。
export async function saveFileMeta(file, patch) {
  if (!file?.md5)
    return;
  file._meta = { ...file._meta, ...patch };
  await putFileMeta(file.md5, patch);
}

// 批量把持久化的 EXIF 拍摄时间/GPS(md5 索引 file-meta)读进各文件 _meta。
// 供 date 排序 settle 前用——让冻结序能用 EXIF 时间,而不是等视窗懒加载(那时排序早已冻结,回退到文件时间)。
// 只读 store、不重抽 EXIF(快);仅 md5 有且 capturedAt 缺失的文件(md5 随快照持久化,重进文件夹即可用)。
export async function loadCapturedAtForFiles(files) {
  const todo = files.filter(f => f.md5 && f._meta?.capturedAt == null);
  if (todo.length === 0)
    return;
  await runConcurrent(
    todo,
    async (f) => {
      const meta = await getFileMeta(f.md5);
      if (meta?.capturedAt != null) {
        const patch = { capturedAt: meta.capturedAt };
        if (meta.gps != null)
          patch.gps = meta.gps;
        f._meta = { ...f._meta, ...patch };
      }
    },
    { concurrency: 32 },
  );
}
