import { SmartFolder } from '../models/SmartFolder';
// 文件系统服务。搬自源码 js/filesystem.js,剥 DOM/UI 耦合,service 内部用 useFsStore() 操作状态。
// syncTreeStructure(源码 sidebar)Vue 后不需要(响应式自动同步 subFolders)。
// 注意:与 recovery.js 循环依赖(handleFolderClick 调 handleFolderNotFound,recovery 调 startBackgroundScan),
// 函数体内调用,ES module 安全。
import { useFsStore } from '../stores/fs';
import { isFileSystemAccessSupported } from '../utils/browser';
import { handleFolderNotFound } from './recovery';

// 打开根目录入口。权限在 picker 阶段一次性拿(mode:readwrite)。
export async function openFolderPicker() {
  if (!isFileSystemAccessSupported()) {
    alert('浏览器不支持文件系统访问 API,请使用 Chrome / Edge / Opera(86+)');
    return null;
  }
  const fs = useFsStore();
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'photo-viewer-start',
      startIn: 'pictures',
    });
    fs.rootHandle = handle;
    fs.foldersData.clear();
    fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
    const root = await loadProject(handle);
    fs.rootFolder = root;
    fs.currentFolder = root;
    // ⚠️ 必须在 fs.rootFolder 赋值后、从「代理」fs.rootFolder 起步启动后台扫描。
    // 若传原始 root,scan 改的是原始 SmartFolder,不触发 reactive 代理的响应式,Sidebar 子目录不更新。
    startBackgroundScan(fs.rootFolder);
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

// 建根 SmartFolder(扫根目录)。后台递归扫描由调用方在设 fs.rootFolder 后、从代理起步触发(见 openFolderPicker)。
export async function loadProject(handle) {
  return await getFolderData(handle);
}

// 后台递归扫描子目录(串行,深度优先)。
// ⚠️ 必须从「代理」folder 起步(调用方传 fs.rootFolder):scan 会改子 SmartFolder 的 files/subFolders,
// 改代理才触发响应式让 Sidebar 实时更新;改原始对象则 UI 不刷新(子目录一直灰,直到点击)。
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

// 清状态后重载整个项目。
export async function reloadProject() {
  const fs = useFsStore();
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
  if (!fs.rootHandle)
    return null;
  const root = await loadProject(fs.rootHandle);
  fs.rootFolder = root;
  fs.currentFolder = root;
  startBackgroundScan(fs.rootFolder); // 同 openFolderPicker,赋值后从代理起步
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
      // 失效的若是当前文件夹,切到父级/全部媒体,避免 Gallery 停在幽灵文件夹
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
    // 只对小文件夹(<200 文件)即时刷新,大的等用户手动刷新
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
