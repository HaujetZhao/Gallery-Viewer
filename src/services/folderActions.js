import { CONFIG } from '../config/index';
import { collectAllFiles, createFolder, detectMetaChanges, enrichFolder, foldersFromRecordMap, scanFolder, validateFolder } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { useToastStore } from '../stores/uiToast';
import { _setDegraded, isDegradedFSA, isFileSystemAccessSupported } from '../utils/browser';
import { makeCancelToken, runConcurrent } from '../utils/concurrency';
import { kvGet } from './db';
import * as handleStore from './handleStore';
import { cancelPendingPersist, flushPendingPersist, markFolderDirty, persistIfDirty, schedulePersist } from './persistence';
import { handleFolderNotFound } from './recovery';
import { loadScan } from './scanCache';
import { integrateScanResult, resetFoldersData } from './scanIntegration';
import {
  clearDegradedSnapshotSession,
  computeDirectoryFingerprint,
  createDegradedRootFromFileList,
  createDirectoryInput,
  scanDegradedFolder,
  setDegradedSnapshot,
  startDegradedSnapshotSession,
} from './webkitDirectory';

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
// ⚠️ 必须从 store 取 rootFolder(Vue3 reactive:改原始对象不触发 UI)。调用方传来的 root 可能是 initProject 返回的原始对象,
//    故此处一律 useFsStore().rootFolder 取 store 持有的代理,避免响应式陷阱(子目录停留在 isEmpty 半透明态不更新)。
async function scanAndPersist(id) {
  const root = useFsStore().rootFolder; // 代理
  if (!root)
    return;
  const token = newBackgroundToken(); // 取消上一轮在途后台扫描
  await startBackgroundScan(root, token);
  if (token.cancelled)
    return; // 被新切换打断,不存旧快照(避免覆盖更新的树)
  if (id) {
    // 根夹是重建入口(foldersFromRecordMap 从 rootPath 起步),必须有 record。它的 integrateScanResult
    // 在 getFolderData 里发生,而那时 currentRootId 尚未 set(openFolderPicker/switchToRoot 在 initProject
    // 之后才 setCurrent)→ markFolderDirty 提前 return 漏标。此处(currentRootId 已设)补标,保证根夹落盘。
    markFolderDirty(root);
    await persistIfDirty(); // 首次/reload 全树扫后各夹 dirty(integrateScanResult 检测 newFiles 标脏)→ 持久化
  }
}

// R2:切根秒显快照后,后台递归整树做名字集合校验(trust 一致零 IO),变了的对新增文件 enrich。
// 不再只扫 root 一层——深层磁盘增删也即时拾取(不点开也反映)。复用 scanAndPersist(全树 + persistIfDirty)。

// 双模式统一入口:支持 FSA → 完整读写;否则降级只读(webkitdirectory)。
export async function openDirectory() {
  if (!isFileSystemAccessSupported())
    return openDegradedDirectoryPicker();
  return openFolderPicker();
}

// 打开新文件夹(picker)。已保存(handleStore 命中)→ 复用 switchToRoot 秒显+toast,不重建;否则新建扫+记录+切换。
// 仅 FSA 路径;降级由 openDirectory 分流走 openDegradedDirectoryPicker。
export async function openFolderPicker() {
  if (!isFileSystemAccessSupported())
    return null; // 防直接调用(正常已被 openDirectory 分流)
  const toast = useToastStore();
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'photo-viewer-start',
      startIn: 'pictures',
    });
    const { id, existed } = await handleStore.add(handle);
    if (existed) {
      toast.info(`该文件夹已保存,已切换到「${handle.name}」`);
      return await switchToRoot(id); // 复用快照秒显,不 initProject 重建
    }
    const root = await initProject(handle);
    const rootStore = useRootStore();
    rootStore.add(id, handle.name, 0, Date.now());
    rootStore.setCurrent(id);
    scanAndPersist(id); // 后台扫子目录 + 存快照(不阻塞,内部从 store 取 root)
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

// 降级只读:webkitdirectory 选单目录 → FileList 建整棵树(零 IO)。无句柄 → 不落 roots、不调 handleStore;
// `_setDegraded(true)` 切到只读语义(UI 置灰写回 + history 总闸 + validateFolder 短路)。
async function openDegradedDirectoryPicker() {
  const toast = useToastStore();
  const input = createDirectoryInput();
  const files = await new Promise((resolve) => {
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
  if (!files.length)
    return null;
  // 目录指纹秒开:同目录重选命中「指纹→md5快照」→ 预填 md5 免重算;miss 则懒算 + 会话内增量收集落快照。
  clearDegradedSnapshotSession();
  const fp = computeDirectoryFingerprint(files);
  const prev = await kvGet('scans', `degraded:${fp}`);
  const md5Map = prev?.files ? new Map(Object.entries(prev.files)) : null;
  const root = createDegradedRootFromFileList(files, md5Map);
  if (!root)
    return null;
  startDegradedSnapshotSession(fp);
  _setDegraded(true);
  setDegradedSnapshot(files);
  const fs = useFsStore();
  resetFoldersData(fs); // 清撤销栈 + dispose 旧树 + 清 ALL_MEDIA/dirty
  fs.rootHandle = null;
  fs.rootFolder = root;
  fs.currentFolder = root;
  fs.allMediaFolder.files = collectAllFiles(root);
  toast.info(`以只读模式打开「${root.name}」(重命名/删除/回收站不可用)`);
  return root;
}

// 切换到历史根。有缓存秒显(fromSnapshot)+后台校验;无缓存则重扫。
export async function switchToRoot(id) {
  if (isDegradedFSA()) {
    useToastStore().error('只读模式不支持切换文件夹');
    return null;
  }
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
    const recordMap = await loadScan(id);
    // 切到新根前:先 flush 旧根在途的 debounced 写(落盘旧根改动,防根切换静默丢改动——rename 后 1s 内切根,
    // 旧 timer 被弃会丢旧根改动)。必须紧贴 resetFoldersData 之前:flush 后旧根已存,reset 才安全清 store。
    // 此刻 currentRootId 还是旧根(setCurrent 在 try 之后),flush 写的是旧根。
    await flushPendingPersist();
    resetFoldersData(fs);
    fs.rootHandle = handle;
    if (recordMap.size) {
      // 秒显:从 recordMap 重建整棵树(零 IO 纯函数)。根 path = 根 handle.name(根文件夹 path 即根名)。
      const root = foldersFromRecordMap(handle.name, recordMap, null);
      if (root) {
        fs.rootFolder = root; // 挂到 ref → 整棵树深代理
        fs.currentFolder = root;
      }
      else {
        // recordMap 非空但缺根 record(异常)→ 回退重扫
        const root = await loadProject(handle);
        fs.rootFolder = root;
        fs.currentFolder = root;
      }
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
  // R2:有 snap → 秒显后后台递归整树校验(深层增删也拾取);无 snap/恢复失败 → 全树扫建快照。两者都走 scanAndPersist。
  scanAndPersist(id);
  return fs.rootFolder;
}

// 建根 SmartFolder(扫根一层)。只被 loadProject ← initProject/switchToRoot 以根 handle 调用。
// T06(单 ref 持树):createFolder 返回原始 folder,integrate 写回后由调用方 fs.rootFolder = root 挂树代理化。
export async function getFolderData(dirHandle) {
  const createResult = await createFolder({ handle: dirHandle, parent: null });
  integrateScanResult(createResult.folder, createResult); // 写回 files/subFolders(此时 folder 未挂树,UI 未显示,无响应式要求)
  return createResult.folder;
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
        integrateScanResult(subFolderData, result); // 写回代理 + dispose removedFiles
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
  if (isDegradedFSA()) {
    useToastStore().info('只读模式无持久句柄,重载 = 重新选择文件夹');
    return null;
  }
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
  scanAndPersist(id); // 内部从 store 取 root
  return root;
}

// 重扫单文件夹(scanFolder + integrateScanResult + enrich)。小文件夹点击:秒显 + enrich 补全 size/mtime。
// 失败(NotFoundError)时从父节点 subFolders 移除。
// ⚠️ folder 必须是代理(rootFolder 树里的引用);integrateScanResult 写回代理才触发响应式。
export async function refreshFolder(folder) {
  const fs = useFsStore();
  try {
    const result = await scanFolder(folder); // 纯函数(不信任:reload 抓增删改名)
    integrateScanResult(folder, result); // 写回代理 + dispose removedFiles
    await enrichFolder(folder);
    await detectMetaChanges(folder); // 读全部元数据,size/mtime 变→清 md5
  }
  catch (err) {
    if (err.name === 'NotFoundError') {
      // T06:从父节点的 subFolders 移除;folder 脱离树即被 GC。
      if (folder.parent) {
        const idx = folder.parent.subFolders.indexOf(folder);
        if (idx > -1)
          folder.parent.subFolders.splice(idx, 1);
      }
      if (fs.currentFolder === folder)
        fs.currentFolder = folder.parent || fs.allMediaFolder;
    }
    throw err;
  }
}

// 侧栏右键"刷新":递归重扫该文件夹及其下所有子文件夹,更新各层文件数(增删/改名)。
// 与 startBackgroundScan 同策略(子夹信任名字集合短路零 getFile,仍抓文件数变化),只是从任意文件夹
// 起步、且入口夹自身也非信任重扫(抓该层增删改名)。每层 integrateScanResult 写回代理 → 文件数响应式
// 更新 + markFolderDirty;收口 persistIfDirty 一次把全树 dirty 落盘(治写放大)。
export async function refreshFolderTree(folder) {
  const token = makeCancelToken();
  await refreshSubtree(folder, token);
  if (!token.cancelled)
    await persistIfDirty();
}

// 递归刷新一棵子树的单层。入口夹(folder.parent 为 null)非信任全扫,其余子夹信任短路。
async function refreshSubtree(folder, token) {
  if (!folder || token.cancelled)
    return;
  try {
    const result = await scanFolder(folder, { trust: folder.parent != null });
    integrateScanResult(folder, result); // 写回代理 → 文件数/增删更新
    await enrichFolder(folder); // 新文件补 size/mtime
  }
  catch (err) {
    if (err.name === 'NotFoundError') {
      // 该夹已被外部删除:从父节点移除,不再下钻。
      if (folder.parent) {
        const idx = folder.parent.subFolders.indexOf(folder);
        if (idx > -1)
          folder.parent.subFolders.splice(idx, 1);
      }
      return;
    }
    console.warn('刷新子文件夹失败:', folder.name, err);
    return;
  }
  if (!folder.subFolders?.length)
    return;
  await runConcurrent(
    [...folder.subFolders],
    sub => refreshSubtree(sub, token),
    { concurrency: CONFIG.PERFORMANCE.SCAN_FOLDER_CONCURRENCY, token },
  );
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

// 聚合 rootFolder 整树文件到 ALL_MEDIA,切到聚合视图(collectAllFiles 遍历整树)。
export async function switchToAllPhotos() {
  const fs = useFsStore();
  fs.allMediaFolder.files = fs.rootFolder ? collectAllFiles(fs.rootFolder) : [];
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
  // 降级只读:树已由 FileList 全量建好,点击仅做 trust 校验(名字集合一致零 IO)+ 展示,不落盘。
  if (isDegradedFSA()) {
    const result = await scanDegradedFolder(folder, { trust: true });
    integrateScanResult(folder, result); // markFolderDirty 在降级下 currentRootId null 自动短路,不落盘
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
    integrateScanResult(folder, result);
    await enrichFolder(folder);
    schedulePersist();
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
