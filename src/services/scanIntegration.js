import { disposeFile } from '../models/SmartFile';
import { disposeFolder } from '../models/SmartFolder';
import { useHistoryStore } from '../stores/history';

// scan 整合(T06:rootFolder 单 ref 深代理持整棵树,folder 挂树即被代理化,不再 set/get Map)。

// 递归 dispose 整棵 folder 树的 file 池条目(切根/重载防泄漏)。
function disposeFolderTree(folder) {
  if (!folder)
    return;
  disposeFolder(folder); // dispose 当前 folder.files(池条目)
  for (const sub of folder.subFolders)
    disposeFolderTree(sub);
}

// 切根/重载的运行时重置:清撤销栈 + 递归 dispose 旧树池条目 + 清 ALL_MEDIA 聚合。
// 清撤销栈:撤销栈是 store 级单例,切根不清则旧根操作可被 Ctrl+Z 跨根回放——
// FileDeleteOperation.undo 会拿新根 rootHandle 去新根找 .trash 越界动错磁盘(T02 Bug1)。
// 收口在此:switchToRoot / openFolderPicker(经 initProject)/ reloadProject(经 initProject)切根必经此处。
// rootFolder 由调用方 initProject/switchToRoot 覆盖(reset 只清撤销栈 + dispose 旧树 + 清 ALL_MEDIA)。
export function resetFoldersData(fs) {
  useHistoryStore().clear();
  disposeFolderTree(fs.rootFolder); // 递归释放旧树池条目
  fs.allMediaFolder.files = []; // ALL_MEDIA 聚合清空(共享 file 已由上面 dispose 释放,幂等)
}

// T06 整合副作用:把 scanFolder 纯函数结果写回「代理」folder(Vue 响应式)。
// folder 必须是「代理」(rootFolder 树里的引用:作 root 或某 parent.subFolders 元素)。
// 新 sub 写到 folder.subFolders → 挂代理数组 → Vue 自动代理化(挂树即代理,无需手动注册)。
// removedFolders 不在新 subFolders 里 → 自然脱离树,无需手动删。
export function integrateScanResult(folder, result, fs) {
  folder.files = result.files; // 写回代理 folder(Vue3 reactive 触发重渲)
  folder.subFolders = result.subFolders; // 新 sub 挂到代理 folder 的数组 → Vue 自动代理化
  for (const f of result.removedFiles)
    disposeFile(f); // 旧文件 dispose → destroy 池条目(revoke blobUrl)
  // R3:有增删 → 标树脏(persistIfDirty 据此决定是否持久化)
  if (
    result.newFiles.length
    || result.removedFiles.length
    || result.newSubFolders.length
    || result.removedFolders.length
  ) {
    fs.rootDirty = true;
  }
}
