// 扫描快照持久化(每根一份 FolderSnapshot,存 IDB)。切换根时 fromSnapshot 秒重建。
import { del, get, set } from 'idb-keyval';

export async function loadScan(rootId) {
  return await get(`scan-${rootId}`);
}

export async function saveScan(rootId, snapshot) {
  await set(`scan-${rootId}`, snapshot);
}

export async function clearScan(rootId) {
  await del(`scan-${rootId}`);
}
