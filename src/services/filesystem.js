// 文件系统服务。搬自源码 js/filesystem.js,剥 DOM/UI 耦合,service 内部用 useFsStore() 操作状态。
// syncTreeStructure(源码 sidebar)Vue 后不需要(响应式自动同步 subFolders)。
// 注意:与 recovery.js 循环依赖(handleFolderClick 调 handleFolderNotFound,recovery 调 startBackgroundScan),
// 函数体内调用,ES module 安全。
import { useFsStore } from '../stores/fs';
import { useToastStore } from '../stores/uiToast';
import { SmartFolder } from '../models/SmartFolder';
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
    return root;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('打开文件夹失败:', err);
      alert('打开文件夹失败: ' + err.message);
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

// 建根 SmartFolder + 后台递归扫描。
export async function loadProject(handle) {
  const root = await getFolderData(handle);
  console.log(`[loadProject] 根扫完,根有 ${root.subFolders.length} 个子目录,启动后台扫描`);
  // [调试] startBackgroundScan 完成 toast,用于判断"没扫"还是"扫了没更新 UI"。验证后可去 toast/log。
  startBackgroundScan(root)
    .then(({ folderCount, fileCount }) => {
      console.log(`[loadProject] 后台扫描结束:扫了 ${folderCount} 个子目录,共 ${fileCount} 个文件`);
      useToastStore().info(`后台扫描完成:扫了 ${folderCount} 个子目录,共 ${fileCount} 个文件`);
    })
    .catch((e) => {
      console.error('[loadProject] 后台扫描出错:', e);
      useToastStore().error('后台扫描出错: ' + (e?.message || e));
    });
  return root;
}

// 后台递归扫描子目录(串行,原版行为)。返回 { folderCount, fileCount } 供 loadProject toast。
// [调试] 每个 subFolder scan 前后 console.log,排查"没扫 vs 没更新 UI"。
export async function startBackgroundScan(parentFolder) {
  let folderCount = 0;
  let fileCount = 0;
  async function walk(folder) {
    if (!folder || !folder.subFolders || folder.subFolders.length === 0) {
      console.log(`[后台扫描] ${folder?.path || folder?.name || '(空)'} 无子目录,跳过`);
      return;
    }
    console.log(`[后台扫描] 进入 ${folder.path || folder.name},子目录 ${folder.subFolders.length} 个`);
    for (const subFolderData of folder.subFolders) {
      try {
        if (!subFolderData.scanned) {
          console.log(`[后台扫描] ▶ 开始扫 ${subFolderData.path}`);
          await subFolderData.scan();
          console.log(`[后台扫描] ✓ 完成 ${subFolderData.path}: ${subFolderData.files.length} 文件, ${subFolderData.subFolders.length} 子目录`);
        } else {
          console.log(`[后台扫描] ⊙ 已扫过 ${subFolderData.path},跳过`);
        }
        folderCount++;
        fileCount += subFolderData.files.length;
        await walk(subFolderData);
      } catch (e) {
        console.warn(`[后台扫描] ✗ 失败 ${subFolderData.path}:`, e);
      }
    }
  }
  await walk(parentFolder);
  return { folderCount, fileCount };
}

// 清状态后重载整个项目。
export async function reloadProject() {
  const fs = useFsStore();
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
  if (!fs.rootHandle) return null;
  const root = await loadProject(fs.rootHandle);
  fs.rootFolder = root;
  fs.currentFolder = root;
  return root;
}

// 重扫单文件夹。失败(NotFoundError)时从 foldersData 删 + treeNode 数据清理。
export async function refreshFolder(folder) {
  try {
    await folder.scan();
    folder.treeNode?.refreshState();
  } catch (err) {
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
  if (!folder) return;
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
  } catch (err) {
    if (err.name === 'NotFoundError' || err.message?.includes('not found')) {
      await handleFolderNotFound(folder);
    } else {
      console.error('文件夹点击处理失败:', err);
    }
  }
}
