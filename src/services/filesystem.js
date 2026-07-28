import { CONFIG } from '../config/index';
import { scanFolder, SmartFolder } from '../models/SmartFolder';
// 文件系统服务。内部用 useFsStore() 操作状态。多文件夹:switchToRoot 切换(秒显缓存+后台校验)。
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { useToastStore } from '../stores/uiToast';
import { isFileSystemAccessSupported } from '../utils/browser';
import { makeCancelToken, runConcurrent } from '../utils/concurrency';
import * as handleStore from './handleStore';
import { handleFolderNotFound } from './recovery';
import { loadScan, saveScan } from './scanCache';

// 后台扫描的当前取消令牌。每次新开后台扫描前 cancel 上一个、换新令牌;
// 在途遍历在批次间隙检测到取消即退出,不再改旧 store(修原 startBackgroundScan 无取消的竞态)。
let bgToken = makeCancelToken();
function newBackgroundToken() {
  bgToken.cancel();
  bgToken = makeCancelToken();
  return bgToken;
}

// 释放旧 foldersData 各 folder 的池条目(blobUrl/File)+ 清 Map + 重置 ALL_MEDIA。
// 切根/重载用——Phase 1 池化后,clear 不 dispose 会让旧文件 url/File 驻留池泄漏(切文件夹内存增长)。
function resetFoldersData(fs) {
  for (const folder of fs.foldersData.values())
    folder.dispose?.(); // → file.dispose() → destroy 池条目(幂等:ALL_MEDIA 聚合引用与真实 folder 共享 file,重复 destroy 无害)
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
}

// Phase 3 Step 2:fromSnapshot 纯函数化后,递归注册 folder 树到 foldersData 的副作用归 service。
// folder 是 fromSnapshot 新建的原始对象树,set 进 reactive Map 后被代理化(后续 foldersData.get 取代理)。
// 替代旧 SmartFolder.fromSnapshot 内部的 appState.foldersData.set 注册副作用。
function registerFolderTree(folder, fs) {
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
    f.dispose(); // 旧文件 dispose → destroy 池条目(revoke blobUrl)
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

// 从 handle 初始化项目状态(设 rootHandle + loadProject 扫根 + 设 rootFolder/currentFolder)。
// 不启动后台扫描——由调用方在 fs.rootFolder 赋值后从代理起步 + 扫完后存快照(scanAndPersist)。
export async function initProject(handle) {
  const fs = useFsStore();
  fs.rootHandle = handle;
  resetFoldersData(fs);
  const root = await loadProject(handle);
  fs.rootFolder = root;
  fs.currentFolder = root;
  return root;
}

// 后台递归扫描(并发 + 信任 + 可取消)+ 扫完存快照/更新 fileCount。openFolderPicker/switchToRoot/reloadProject 复用。
// ⚠️ 必须从 store 取「代理」root(Vue3 reactive:改原始对象不触发 UI)。调用方传来的 root 可能是 initProject 返回的原始对象,
//    故此处一律 useFsStore().rootFolder 取代理,避免响应式陷阱(子目录停留在 isEmpty 半透明态不更新)。
async function scanAndPersist(id) {
  const root = useFsStore().rootFolder; // 代理
  if (!root)
    return;
  const token = newBackgroundToken(); // 取消上一轮在途后台扫描
  await startBackgroundScan(root, token);
  if (token.cancelled)
    return; // 被新切换打断,不存旧快照(避免覆盖更新的树)
  if (id) {
    await saveScan(id, root.toSnapshot());
    await useRootStore().updateMeta(id, { fileCount: root.getAllFiles().length });
  }
}

// 打开新文件夹(picker)。扫描 + 记录到 handleStore + 存快照 + 切换。
export async function openFolderPicker() {
  if (!isFileSystemAccessSupported()) {
    alert('浏览器不支持文件系统访问 API,请使用 Chrome / Edge / Opera(86+)');
    return null;
  }
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'photo-viewer-start',
      startIn: 'pictures',
    });
    const id = await handleStore.add(handle);
    const root = await initProject(handle);
    const rootStore = useRootStore();
    rootStore.add(id, handle.name, 0, Date.now());
    rootStore.setCurrent(id);
    scanAndPersist(id); // 后台扫子目录 + 存快照(不阻塞,内部取代理 root)
    return root;
  }
  catch (err) {
    if (err.name !== 'AbortError') {
      console.error('打开文件夹失败:', err);
      alert(`打开文件夹失败: ${err.message}`);
    }
    return null;
  }
}

// 切换到历史根。有缓存秒显(fromSnapshot)+后台校验;无缓存则重扫。
export async function switchToRoot(id) {
  const fs = useFsStore();
  const rootStore = useRootStore();
  const toast = useToastStore();
  const handle = await handleStore.getHandle(id);
  if (!handle) {
    rootStore.remove(id);
    toast.error('文件夹记录已失效');
    return null;
  }
  if (!(await handleStore.verifyPermission(handle))) {
    toast.error('未获得文件夹访问权限');
    return null;
  }
  try {
    const snap = await loadScan(id);
    resetFoldersData(fs);
    fs.rootHandle = handle;
    if (snap) {
      const root = SmartFolder.fromSnapshot(snap, null); // 秒显(零 IO,纯函数不注册 foldersData)
      registerFolderTree(root, fs); // 递归注册 folder 树(替代 fromSnapshot 内的 appState 注册副作用)
      fs.rootFolder = root;
      fs.currentFolder = root;
    }
    else {
      const root = await loadProject(handle);
      fs.rootFolder = root;
      fs.currentFolder = root;
    }
  }
  catch (e) {
    console.warn('快照恢复失败,回退重扫:', e);
    await initProject(handle);
  }
  rootStore.setCurrent(id);
  await rootStore.updateMeta(id, { lastUsed: Date.now() });
  scanAndPersist(id); // 后台校验 + 更新快照(内部取代理 root)
  return fs.rootFolder;
}

// 全局缓存:path → SmartFolder。命中复用对象(更新 handle 防失效),未命中解析父级后 create+scan+注册。
// ⚠️ 响应式根治(be2ffe3):未命中 → 先 foldersData.set 把 folder 放进 reactive Map(代理化)→ get 取代理
//    → scanFolder(代理) → integrateScanResult(写回代理)。写回原始对象不触发 UI 更新(子目录停半透明)。
export async function getFolderData(dirHandle) {
  const fs = useFsStore();
  const parts = await fs.rootHandle.resolve(dirHandle);
  const path = [fs.rootHandle.name, ...parts].join('/');

  const folderData = fs.foldersData.get(path);
  if (folderData) {
    folderData.handle = dirHandle; // 更新 handle(防旧句柄失效)
    return folderData;
  }

  // 推导父级
  const pathParts = path.split('/');
  let parent = null;
  if (pathParts.length > 1) {
    const parentPath = pathParts.slice(0, -1).join('/');
    parent = fs.foldersData.get(parentPath) || null;
  }

  // create 内部 scanFolder(纯函数,不改 folder 入参、不碰 foldersData)。
  // 不用 create 返回的原始 folder 直接写回 —— 先 set 进 reactive Map 取代理,integrateScanResult 写代理。
  const createResult = await SmartFolder.create({ handle: dirHandle, parent });
  const plainFolder = createResult.folder;
  fs.foldersData.set(path, plainFolder); // 放进 reactive Map(代理化)
  const proxy = fs.foldersData.get(path); // 取代理
  integrateScanResult(proxy, createResult, fs); // 写回代理(Vue 响应式)
  return proxy;
}

// 建根 SmartFolder(扫根目录)。后台递归扫描由调用方在设 fs.rootFolder 后触发。
export async function loadProject(handle) {
  return await getFolderData(handle);
}

// 后台递归扫描(并发遍历 + 信任 + 可取消)。
// Phase 3 Step 1:进入节点先 enrich 当前层 files(补 size/mtime,响应式触发 sort 重排),
//   再遍历子目录 scanFolder(trust:true) + integrateScanResult(写回代理 subFolder)+ 递归。
// ponytail: 并发为每节点上限(SCAN_FOLDER_CONCURRENCY),整棵树嵌套 fan-out 可能瞬时在途较多,
//           但 getFile 受各 enrich 的 SCAN_CONCURRENCY 约束、且 trust 使多数文件夹零 IO;若超大树需收紧,加全局信号量。
// ⚠️ 必须从「代理」folder 起步(调用方传 fs.rootFolder):subFolderData 是代理(parentFolder.subFolders 元素),
//    integrateScanResult 写回代理才触发响应式。
export async function startBackgroundScan(parentFolder, token = bgToken) {
  if (!parentFolder)
    return;
  const fs = useFsStore();
  // Phase 2/3:先补当前层 files 的 size/mtime(scanFolder 零 getFile 后,新文件 _meta=null)
  await parentFolder.enrich({ token });
  if (!parentFolder.subFolders)
    return;
  await runConcurrent(
    [...parentFolder.subFolders], // 子目录是代理元素(integrateScanResult 写回代理 → Vue 响应式)
    async (subFolderData) => {
      if (token.cancelled)
        return;
      try {
        const result = await scanFolder(subFolderData, { trust: true }); // 纯列名(零 getFile)
        integrateScanResult(subFolderData, result, fs); // 写回代理 + 注册/清理
        await startBackgroundScan(subFolderData, token); // 递归:enrich sub + 遍历
      }
      catch (e) {
        console.warn('后台扫描子文件夹失败:', subFolderData.name, e);
      }
    },
    { concurrency: CONFIG.PERFORMANCE.SCAN_FOLDER_CONCURRENCY, token },
  );
}

// 重载当前根(绕过缓存,重新扫描)+ 更新快照。设置面板"重载项目"用。
// Phase 2:initProject(listFolder 根,纯名字集合)+ scanAndPersist(enrich 由 startBackgroundScan 触发)。
export async function reloadProject() {
  const fs = useFsStore();
  const rootStore = useRootStore();
  if (!fs.rootHandle)
    return null;
  const id = rootStore.currentRootId;
  const root = await initProject(fs.rootHandle);
  scanAndPersist(id); // 内部取代理 root
  return root;
}

// 重扫单文件夹(scanFolder + integrateScanResult + enrich)。小文件夹点击:秒显 + enrich 补全 size/mtime。
// 失败(NotFoundError)时从 foldersData 删。
// ⚠️ folder 必须是代理(从 store 取);integrateScanResult 写回代理才触发响应式。
export async function refreshFolder(folder) {
  const fs = useFsStore();
  try {
    const result = await scanFolder(folder); // 纯函数(不信任:reload 抓增删改名)
    integrateScanResult(folder, result, fs); // 写回代理 + 注册/清理
    await folder.enrich();
  }
  catch (err) {
    if (err.name === 'NotFoundError') {
      fs.foldersData.delete(folder.path);
      if (fs.currentFolder === folder) {
        fs.currentFolder = folder.parent || fs.allMediaFolder;
      }
    }
    throw err;
  }
}

// 加载并显示指定文件夹。Vue 后只需设 currentFolder(Gallery 自动响应)。
export async function loadFolder(folder) {
  const fs = useFsStore();
  if (folder === fs.allMediaFolder) {
    await switchToAllPhotos();
    return;
  }
  fs.currentFolder = folder;
}

// 聚合所有 foldersData 的文件到 ALL_MEDIA,切到聚合视图。
export async function switchToAllPhotos() {
  const fs = useFsStore();
  const allFiles = [];
  for (const [path, data] of fs.foldersData.entries()) {
    if (path !== 'ALL_MEDIA' && data?.files?.length) {
      allFiles.push(...data.files);
    }
  }
  fs.allMediaFolder.files = allFiles;
  fs.currentFolder = fs.allMediaFolder;
}

// 文件夹点击:validate → 失效恢复 → 小文件夹即时刷新 → loadFolder。
export async function handleFolderClick(folder) {
  if (!folder)
    return;
  const fs = useFsStore();
  if (folder === fs.allMediaFolder) {
    await loadFolder(folder);
    return;
  }
  try {
    const isValid = await folder.validate();
    if (!isValid) {
      await handleFolderNotFound(folder);
      return;
    }
    if (folder.files.length < 200) {
      await refreshFolder(folder);
    }
    await loadFolder(folder);
  }
  catch (err) {
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      await handleFolderNotFound(folder);
    }
    else {
      console.error('文件夹点击处理失败:', err);
    }
  }
}
