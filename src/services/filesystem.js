import { SmartFolder } from '../models/SmartFolder';
// 文件系统服务。内部用 useFsStore() 操作状态。多文件夹:switchToRoot 切换(秒显缓存+后台校验)。
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { useToastStore } from '../stores/uiToast';
import { isFileSystemAccessSupported } from '../utils/browser';
import * as handleStore from './handleStore';
import { handleFolderNotFound } from './recovery';
import { loadScan, saveScan } from './scanCache';

// 从 handle 初始化项目状态(设 rootHandle + loadProject 扫根 + 设 rootFolder/currentFolder)。
// 不启动后台扫描——由调用方在 fs.rootFolder 赋值后从代理起步 + 扫完后存快照(scanAndPersist)。
export async function initProject(handle) {
  const fs = useFsStore();
  fs.rootHandle = handle;
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
  const root = await loadProject(handle);
  fs.rootFolder = root;
  fs.currentFolder = root;
  return root;
}

// 后台递归扫描 + 扫完存快照/更新 fileCount。openFolderPicker/switchToRoot/reloadProject 复用。
async function scanAndPersist(id, root) {
  await startBackgroundScan(root);
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
    scanAndPersist(id, root); // 后台扫子目录 + 存快照(不阻塞)
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
    fs.foldersData.clear();
    fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
    fs.rootHandle = handle;
    if (snap) {
      const root = SmartFolder.fromSnapshot(snap, null); // 秒显(零 IO)
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
  scanAndPersist(id, fs.rootFolder); // 后台校验 + 更新快照
  return fs.rootFolder;
}

// 全局缓存:path → SmartFolder。命中复用对象(更新 handle 防失效),未命中解析父级后 create+scan+注册。
export async function getFolderData(dirHandle) {
  const fs = useFsStore();
  const parts = await fs.rootHandle.resolve(dirHandle);
  const path = [fs.rootHandle.name, ...parts].join('/');

  let folderData = fs.foldersData.get(path);
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

  const scanResult = await SmartFolder.create({ handle: dirHandle, parent });
  folderData = scanResult.folder;
  fs.foldersData.set(path, folderData);
  return folderData;
}

// 建根 SmartFolder(扫根目录)。后台递归扫描由调用方在设 fs.rootFolder 后触发。
export async function loadProject(handle) {
  return await getFolderData(handle);
}

// 后台递归扫描子目录(串行,深度优先)。
// ⚠️ 必须从「代理」folder 起步(调用方传 fs.rootFolder):scan 改代理才触发响应式。
export async function startBackgroundScan(parentFolder) {
  if (!parentFolder || !parentFolder.subFolders)
    return;
  for (const subFolderData of parentFolder.subFolders) {
    try {
      if (!subFolderData.scanned) {
        await subFolderData.scan();
      }
      await startBackgroundScan(subFolderData);
    }
    catch (e) {
      console.warn('后台扫描子文件夹失败:', subFolderData.name, e);
    }
  }
}

// 重载当前根(绕过缓存,重新扫描)+ 更新快照。设置面板"重载项目"用。
export async function reloadProject() {
  const fs = useFsStore();
  const rootStore = useRootStore();
  if (!fs.rootHandle)
    return null;
  const id = rootStore.currentRootId;
  const root = await initProject(fs.rootHandle);
  scanAndPersist(id, root);
  return root;
}

// 重扫单文件夹。失败(NotFoundError)时从 foldersData 删 + treeNode 数据清理。
export async function refreshFolder(folder) {
  try {
    await folder.scan();
    folder.treeNode?.refreshState();
  }
  catch (err) {
    if (err.name === 'NotFoundError') {
      const fs = useFsStore();
      fs.foldersData.delete(folder.path);
      folder.treeNode?.destroy();
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
