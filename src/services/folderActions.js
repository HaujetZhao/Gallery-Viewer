import { CONFIG } from '../config/index';
import { createFolder, enrichFolder, folderFromSnapshot, scanFolder, validateFolder } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { useToastStore } from '../stores/uiToast';
import { isFileSystemAccessSupported } from '../utils/browser';
import { makeCancelToken, runConcurrent } from '../utils/concurrency';
import * as handleStore from './handleStore';
import { cancelPendingPersist, flushPendingPersist, persistIfDirty, schedulePersist } from './persistence';
import { handleFolderNotFound } from './recovery';
import { loadScan } from './scanCache';
import { integrateScanResult, registerAndIntegrate, registerFolderTree, resetFoldersData } from './scanIntegration';

// 文件夹 CRUD / 编排 / 入口流程:init / picker / switch / load / reload / click。

// 后台扫描的当前取消令牌。每次新开后台扫描前 cancel 上一个、换新令牌;
// 在途遍历在批次间隙检测到取消即退出,不再改旧 store(修原 startBackgroundScan 无取消的竞态)。
let bgToken = makeCancelToken();
function newBackgroundToken() {
  bgToken.cancel();
  bgToken = makeCancelToken();
  return bgToken;
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
  if (id)
    await persistIfDirty(id); // 首次/reload 全树扫后必 dirty(integrateScanResult 检测 newFiles)→ 持久化
}

// R2:只扫 root 一层(顶层增删即时),不递归深层(深层点开才校验)。
// trust:true → 顶层名字集合一致则零 IO(integrateScanResult 检测增删置 dirty)。
async function rootEagerScan(root, token) {
  if (!root?.handle)
    return;
  const fs = useFsStore();
  const result = await scanFolder(root, { trust: true });
  integrateScanResult(root, result, fs);
  await enrichFolder(root, { token });
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
  let restoredFromSnap = false;
  try {
    const snap = await loadScan(id);
    // 切到新根前:先 flush 旧根在途的 debounced 写(落盘旧根改动,防根切换静默丢改动——rename 后 1s 内切根,
    // 旧 timer 被弃会丢旧根改动)。必须紧贴 resetFoldersData 之前:flush 后旧根已存,reset 才安全清 store。
    // 此刻 currentRootId 还是旧根(setCurrent 在 try 之后),flush 写的是旧根。
    await flushPendingPersist();
    resetFoldersData(fs);
    fs.rootHandle = handle;
    if (snap) {
      const root = folderFromSnapshot(snap, null); // 秒显(零 IO,纯函数不注册 foldersData)
      registerFolderTree(root, fs); // 递归注册 folder 树(替代 fromSnapshot 内的 appState 注册副作用)
      fs.rootFolder = root;
      fs.currentFolder = root;
      restoredFromSnap = true;
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
  // R2:有 snap → root 一层 eager(替代全树后台扫);R3:仅 dirty 才持久化。无 snap/恢复失败 → 全树扫建快照
  if (restoredFromSnap)
    rootEagerScan(fs.rootFolder).then(() => persistIfDirty(id));
  else
    scanAndPersist(id);
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
  // 原始 folder 不能直接写回——registerAndIntegrate 内部 set 进 reactive Map 取代理再 integrate(收口代理陷阱)。
  const createResult = await createFolder({ handle: dirHandle, parent });
  return registerAndIntegrate(createResult.folder, createResult, fs);
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
  await enrichFolder(parentFolder, { token });
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
  // 重载绕过缓存重扫:取消在途 debounced 写。reload 不换根 → id 仍 = currentRootId,防线②(id 校验)拦不住,
  // 故 cancel 是此处唯一防线,防旧 dirty 的 saveScan 覆盖刚扫出的新 snapshot(竞态防线①)。
  // 用 cancel(丢弃)而非 flush:reload 走 initProject+scanAndPersist 从盘重建树,丢弃的 in-memory 改动
  // 本就已即时落盘(handle.move/removeEntry),rescan 会重新拾取;flush 反而多一次冗余写。
  cancelPendingPersist();
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
    await enrichFolder(folder);
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
  const rootStore = useRootStore();
  if (folder === fs.allMediaFolder) {
    await loadFolder(folder);
    return;
  }
  try {
    const isValid = await validateFolder(folder);
    if (!isValid) {
      await handleFolderNotFound(folder);
      return;
    }
    // R2:对所有点击 trust 校验(深层按需;短路零 IO)+ enrich 新增 + dirty 才持久化
    // R3-2+R3-3:enrich(await,补 size/mtime 给 sort)→ schedulePersist(不 await,后台 debounce 合并写,不阻塞点击)
    //           → loadFolder(await,先显示)。持久化晚 1s 触发;切根时由 flushPendingPersist 落盘旧根改动(reload 则 cancel)。
    const result = await scanFolder(folder, { trust: true });
    integrateScanResult(folder, result, fs);
    await enrichFolder(folder);
    schedulePersist(rootStore.currentRootId);
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
