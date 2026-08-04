import { countAllFiles, findFolderByPath } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { saveFolderRecord } from './scanCache';

// per-folder 持久化调度。dirty 单位 = 文件夹(`Set<${rootId}::${path}>`):改一个文件只标它所属
// 文件夹脏;persistIfDirty 只重写 dirty 集合里的文件夹 record(治「整树写放大」)。1s debounce 合并。

const SEP = '::';
const folderKey = (rootId, path) => `${rootId}${SEP}${path}`;
function parseKey(key) {
  const i = key.indexOf(SEP);
  return { rootId: key.slice(0, i), path: key.slice(i + SEP.length) };
}

// 标单文件夹脏(不 schedule)。scan 流程用:integrateScanResult 标脏,由调用方 schedulePersist/persistIfDirty。
export function markFolderDirty(folder) {
  if (!folder)
    return;
  const rootId = useRootStore().currentRootId;
  if (!rootId)
    return;
  useFsStore().dirtyFolders.add(folderKey(rootId, folder.path));
}

// 标脏 + debounced schedule。ad-hoc 改树处用(history / thumbnail md5 / MediaView duration / SidebarTreeItem expand)。
export function afterFolderMutation(folder) {
  markFolderDirty(folder);
  schedulePersist();
}

// 写 dirty 集合里的文件夹 record。每个 key 自带 rootId;非当前根的(理论被 flush 清,双保险)跳过。
// fileCount 仅变化时写 roots store(避免 md5-only persist 也触发 roots 写)。
export async function persistIfDirty() {
  const fs = useFsStore();
  const rootStore = useRootStore();
  const dirty = fs.dirtyFolders;
  if (!dirty.size)
    return;
  const root = fs.rootFolder;
  if (!root) {
    dirty.clear();
    return;
  }
  // 快照 dirty 清单后立即清 store:本轮处理这些;期间新 dirty 进下一轮(不丢、不与本轮混合)。
  const keys = [...dirty];
  dirty.clear();
  for (const key of keys) {
    const { rootId, path } = parseKey(key);
    if (rootId !== rootStore.currentRootId)
      continue; // defense in depth:切根后旧根残留 key 跳过(正常 flush 已清)
    const folder = findFolderByPath(root, path);
    if (folder)
      await saveFolderRecord(rootId, folder);
  }
  // root meta fileCount:仅变化时更新(md5/duration-only persist 不触发 roots 写)。
  const count = countAllFiles(root);
  const cur = rootStore.roots.find(r => r.id === rootStore.currentRootId)?.fileCount;
  if (count !== cur)
    await rootStore.updateMeta(rootStore.currentRootId, { fileCount: count });
}

// R3-2 + R3-3:debounced 持久化调度。连续变更合并成「最后一次后 1s」的一次写,避免写放大。
// 竞态防线:
// ① 切根入口(switchToRoot)调 flushPendingPersist → 先落盘旧根在途写(各 key 自带旧 rootId,flush 时 currentRootId 仍旧),
//    再 reset 清 dirty Set;reloadProject 调 cancelPendingPersist → 丢弃在途(重扫从盘重建)。
// ② persistIfDirty 内 per-key 校验 rootId === currentRootId(双保险)。
// ③ trailing:每次 clearTimeout 重置 → 多次变更合并成一次写。
let persistTimer = null;
const PERSIST_DEBOUNCE_MS = 1000;

export function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistIfDirty();
  }, PERSIST_DEBOUNCE_MS);
}

// 切根 / 重载时取消在途的 debounced 写,避免旧根写晚到。
export function cancelPendingPersist() {
  clearTimeout(persistTimer);
  persistTimer = null;
}

// 切根前:若有在途写(或 dirty 非空),立即落盘再换树。此刻 currentRootId 还是旧根。
export async function flushPendingPersist() {
  const fs = useFsStore();
  if (persistTimer === null && !fs.dirtyFolders.size)
    return; // 无在途写且无 dirty,常见快路径
  clearTimeout(persistTimer);
  persistTimer = null;
  await persistIfDirty();
}
