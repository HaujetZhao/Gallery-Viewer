import { disposeFile } from '../models/SmartFile';
import { disposeFolder } from '../models/SmartFolder';
import { useHistoryStore } from '../stores/history';

// scan 整合 + 树注册:把 scanFolder 纯函数结果写回代理 folder + 递归注册树。

// 切根/重载的运行时重置:清撤销栈 + 释放旧树池条目 + 清 Map + 重置 ALL_MEDIA。
// 清撤销栈:撤销栈是 store 级单例,切根不清则旧根操作可被 Ctrl+Z 跨根回放——
// FileDeleteOperation.undo 会拿新根 rootHandle 去新根找 .trash 越界动错磁盘(T02 Bug1)。
// 收口在此:switchToRoot / openFolderPicker(经 initProject)/ reloadProject(经 initProject)切根必经此处。
export function resetFoldersData(fs) {
  useHistoryStore().clear();
  for (const folder of fs.foldersData.values())
    disposeFolder(folder); // → disposeFile → destroy 池条目(幂等:ALL_MEDIA 聚合引用与真实 folder 共享 file,重复 destroy 无害)
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
}

// Phase 3 Step 2:fromSnapshot 纯函数化后,递归注册 folder 树到 foldersData 的副作用归 service。
// folder 是 fromSnapshot 新建的原始对象树,set 进 reactive Map 后被代理化(后续 foldersData.get 取代理)。
// 替代旧 SmartFolder.fromSnapshot 内部的 appState.foldersData.set 注册副作用。
export function registerFolderTree(folder, fs) {
  fs.foldersData.set(folder.path, folder);
  for (const sub of folder.subFolders)
    registerFolderTree(sub, fs);
}

// Phase 3 Step 1 整合副作用:把 scanFolder 纯函数结果写回「代理」folder(Vue 响应式)。
// 集中:① 写回 folder.files/subFolders(isEmpty getter 实时算,无需 refreshState)② 注册 newSubFolders 到 foldersData
// ③ 删 removedFolders ④ dispose removedFiles(destroy 池条目)。
// ⚠️ folder 必须是「代理」(从 store 取或 foldersData.get);SmartFolder.create 返回的原始 folder 写回不触发响应式。
export function integrateScanResult(folder, result, fs) {
  folder.files = result.files; // 写回代理 folder(Vue3 reactive 触发重渲)
  folder.subFolders = result.subFolders;
  // result.newSubFolders 是 scanFolder 新建的「原始」对象,set 进 reactive Map 后被代理化。
  // 后续若要写回某 sub,必须 foldersData.get(sub.path) 取代理(recovery.js startBackgroundScan 即如此),勿直接用原始 sub 写回(不响应式)。
  for (const sub of result.newSubFolders)
    fs.foldersData.set(sub.path, sub); // 注册新子目录(path→folder)
  for (const sub of result.removedFolders)
    fs.foldersData.delete(sub.path);
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

// 收口 Vue3 reactive 代理陷阱(P0-2):新 scan 的原始 folder 不能直接 integrateScanResult
// (写原始对象不触发响应式——子目录停半透明不更新)。标准姿势:set 进 reactive Map 代理化 → get 取代理 → integrate 写回。
// 新建 folder 必走这里,避免"set→get 取代理"手法散落各处被未来调用点漏写。
export function registerAndIntegrate(plainFolder, scanResult, fs) {
  fs.foldersData.set(plainFolder.path, plainFolder);
  const proxy = fs.foldersData.get(plainFolder.path);
  integrateScanResult(proxy, scanResult, fs);
  return proxy;
}
