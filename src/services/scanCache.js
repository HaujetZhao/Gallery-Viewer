// 扫描快照持久化——per-folder 粒度。GalleryDB 'scans' store(KV, out-of-line key)。
// key = `${rootId}::${folder.path}`,value = 该文件夹的 record(非递归:本夹 files + 子夹 path 引用)。
// 写粒度 = 文件夹:改一个文件只重写它所属的文件夹 record,不重写整库(治写放大)。
// 切根:loadScan 一次前缀拉回该根所有 record → Map<path, record> → foldersFromRecordMap 重建(秒切)。
import { CONFIG } from '../config/index';
import { folderToRecord } from '../models/SmartFolder';
import { kvDelByPrefix, kvGetByPrefix, kvSet } from './db';

const SCANS_STORE = CONFIG.DATABASE.STORES.SCANS;
const SEP = '::';
const folderKey = (rootId, path) => `${rootId}${SEP}${path}`;

// 切根/恢复:前缀拉回该根所有文件夹 record → Map<path, record>。空 → Map size 0(调用方走重扫)。
export async function loadScan(rootId) {
  const entries = await kvGetByPrefix(SCANS_STORE, `${rootId}${SEP}`);
  const map = new Map();
  for (const { value } of entries) {
    if (value?.path)
      map.set(value.path, value);
  }
  return map;
}

// 写单个文件夹 record(per-folder)。persistIfDirty 遍历 dirtyFolders 调它。
export async function saveFolderRecord(rootId, folder) {
  await kvSet(SCANS_STORE, folderKey(rootId, folder.path), folderToRecord(folder));
}

// 移除根:前缀删该根所有 record(RootSwitcher 删根时调,不残留孤儿)。
export async function clearScan(rootId) {
  await kvDelByPrefix(SCANS_STORE, `${rootId}${SEP}`);
}
