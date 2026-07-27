// 文件系统服务。搬自源码 js/filesystem.js,剥 DOM/UI 耦合,service 内部用 useFsStore() 操作状态。
// syncTreeStructure(源码 sidebar)阶段5 接入;Vue 响应式渲染 subFolders,可能不需要它。
import { useFsStore } from '../stores/fs.js';
import { SmartFolder } from '../models/SmartFolder.js';
import { isFileSystemAccessSupported } from '../utils/browser.js';

// 打开根目录入口。权限在 picker 阶段一次性拿(mode:readwrite),后续不再调 verifyHandlePermission。
export async function openFolderPicker() {
  if (!isFileSystemAccessSupported()) {
    // 阶段4 暂用 alert,阶段7 settings/toast 组件做好后替换
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
    fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder); // ALL_MEDIA 已在 store 初始化时建,这里重新挂回清空后的 map
    const root = await loadProject(handle);
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

// 建根 SmartFolder + 后台递归扫描。源码有 treeNode.createRoot/addToUI(DOM),Vue 后剥离(组件渲染)。
export async function loadProject(handle) {
  const root = await getFolderData(handle);
  startBackgroundScan(root); // fire-and-forget,后台递归
  return root;
}

// 深度优先递归后台扫描。scan 已把 subFolder 加到 parent.subFolders 数组,TreeNode 是数据投影,
// Vue 组件 v-for 渲染 subFolders,无需手动 treeNode.addChild。
export async function startBackgroundScan(parentFolder) {
  if (!parentFolder || !parentFolder.subFolders) return;
  for (const subFolderData of parentFolder.subFolders) {
    try {
      if (!subFolderData.scanned) {
        await subFolderData.scan();
      }
      await startBackgroundScan(subFolderData);
    } catch (e) {
      console.warn('后台扫描子文件夹失败:', subFolderData.name, e);
    }
  }
}

// 清状态后重载整个项目。
export async function reloadProject() {
  const fs = useFsStore();
  fs.foldersData.clear();
  fs.foldersData.set('ALL_MEDIA', fs.allMediaFolder);
  if (!fs.rootHandle) return null;
  const root = await loadProject(fs.rootHandle);
  fs.currentFolder = root;
  return root;
}

// 重扫单文件夹。源码有 syncTreeStructure(阶段5)+toast,这里剥离。
// 失败(NotFoundError)时从 foldersData 删 + treeNode 数据清理。
export async function refreshFolder(folder) {
  try {
    await folder.scan();
    folder.treeNode?.refreshState();
    // 阶段5: 接入 syncTreeStructure(folder) —— Vue 响应式可能让此步多余,届时评估
  } catch (err) {
    if (err.name === 'NotFoundError') {
      const fs = useFsStore();
      fs.foldersData.delete(folder.path);
      folder.treeNode?.destroy();
    }
    throw err;
  }
}
