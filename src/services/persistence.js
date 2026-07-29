import { countAllFiles, folderToSnapshot } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { saveScan } from './scanCache';

// 持久化调度:仅树脏时落盘 + debounced 合并写,避免写放大。

// R3:仅树脏时持久化(W2/W3:未变则零 saveScan / 零 getAllFiles)。
export async function persistIfDirty(id) {
  const fs = useFsStore();
  if (!id || !fs.rootDirty)
    return;
  const root = fs.rootFolder;
  if (!root)
    return;
  await saveScan(id, folderToSnapshot(root));
  await useRootStore().updateMeta(id, { fileCount: countAllFiles(root) }); // 递归计数,不分配万级数组(P0-1)
  fs.rootDirty = false;
}

// R3-2 + R3-3:debounced 持久化调度。连续变更(改名/增删/扫描命中)合并成「最后一次后 1s」的一次写,
// 避免写放大(每次变更不再全树 toSnapshot + 大 IDB write)。不阻塞调用方(handleFolderClick 点完即显示)。
// 竞态防线:
// ① 切根入口(switchToRoot)调 flushPendingPersist → 先落盘旧根在途写(防根切换静默丢改动),再换树;
//    重载入口(reloadProject)调 cancelPendingPersist → 丢弃在途写(重扫从盘重建,改动已即时落盘);
// ② trailing 执行时校验 id === currentRootId → 双保险(defense in depth),切根后跳过;
// ③ trailing:每次 clearTimeout 重置 → 多次变更合并成一次写;
// ④ dirty 清除:persistIfDirty 写完置 false;debounce 窗口内若又来变更会被再次置 true(integrateScanResult/history),下次 trailing 覆盖。
//    flushPendingPersist 也走 persistIfDirty → 顺带清 dirty,治「旧根 dirty 串到新根」。
let persistTimer = null;
// 折中:1s 窗口内若用户立即关浏览器,在途 debounce 会丢(未 flush 落 IDB)。彻底解需 beforeunload flush,
// 但 IDB async 写在 beforeunload 不可靠(浏览器不等 promise),故接受此窗口——连续改名/扫描的写放大收益 > 极端关闭场景的丢改动风险。
// (注:根切换的丢改动窗口已由 flushPendingPersist 关闭;此处仅剩"关浏览器"窗口。)
const PERSIST_DEBOUNCE_MS = 1000;

export function schedulePersist(id) {
  if (!id)
    return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // 切根后 id 可能已非当前根,跳过避免写错根 / 误清新根 dirty(defense in depth,配合切根入口 cancel)。
    if (id !== useRootStore().currentRootId)
      return;
    persistIfDirty(id);
  }, PERSIST_DEBOUNCE_MS);
}

// 语义入口:树变更后调用(置脏 + debounced 持久化)。history 等改树处调它,不直接碰 rootDirty/schedulePersist。
export function afterTreeMutation(id) {
  const fs = useFsStore();
  fs.rootDirty = true;
  schedulePersist(id);
}

// 切根 / 重载时取消在途的 debounced 写,避免旧根写晚到(竞态防线①)。
// 用于 reloadProject(重扫从盘重建树,丢弃的 in-memory 改动本就已即时落盘 handle.move/removeEntry,rescan 会重新拾取)。
export function cancelPendingPersist() {
  clearTimeout(persistTimer);
  persistTimer = null;
}

// 切根前:若有在途 debounced 写,先落盘旧根再换树(避免根切换静默丢改动——
// rename 后 1s 内切根,旧 timer 被 cancel 会丢旧根改动;flush 先写旧根 snapshot)。
// 此刻 currentRootId 还是旧根(switchToRoot 在 setCurrent 之前调),flush 写的是旧根。
// 顺带治 rootDirty 串根:persistIfDirty 写完置 false,旧根 dirty 不带到新根。
// 与 cancelPendingPersist 的区别:cancel=丢弃(reload 用,重扫重建);flush=落盘(switch 用,旧根树被弃需先存)。
export async function flushPendingPersist() {
  if (persistTimer === null)
    return; // 无在途写,常见快路径
  clearTimeout(persistTimer);
  persistTimer = null;
  await persistIfDirty(useRootStore().currentRootId);
}
