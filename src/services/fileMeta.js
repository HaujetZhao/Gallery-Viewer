// file-meta store(md5 索引)的门面:文件固有媒体属性(duration/width/height/bitrate)。
// 懒加载——视窗触发时 ensureFileMetaLoaded 填 file._meta(与缩略图同流程,无可见延迟)。
// saveFileMeta:抽到时 put + 同步填 _meta(运行时缓存,SmartFile.duration getter 读得到)。
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
