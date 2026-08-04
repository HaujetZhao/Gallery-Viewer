// 扫描快照持久化(每根一份 FolderSnapshot,存 GalleryDB 'scans' store)。
// KV 风格:key=`scan-<rootId>`。切换根时 fromSnapshot 秒重建。
import { CONFIG } from '../config/index';
import { kvDel, kvGet, kvSet } from './db';

const SCANS_STORE = CONFIG.DATABASE.STORES.SCANS;
const scanKey = rootId => `scan-${rootId}`;

export function loadScan(rootId) {
  return kvGet(SCANS_STORE, scanKey(rootId));
}

export async function saveScan(rootId, snapshot) {
  await kvSet(SCANS_STORE, scanKey(rootId), snapshot);
}

export async function clearScan(rootId) {
  await kvDel(SCANS_STORE, scanKey(rootId));
}
