import { FileTypes } from '../config/file-types';
import { CONFIG } from '../config/index';
import { acquire, peek } from '../services/fileResource';
import { runConcurrent } from '../utils/concurrency';
import { windowsCompareStrings } from '../utils/format';
import { disposeFile, fileFromSnapshot, fileToSnapshot, SmartFile } from './SmartFile';

// SmartFolder:纯数据(handle/parent/name/isVirtual/virtualConfig/files/subFolders/expanded)+ 派生 getter(path/isEmpty)。
// P3:行为方法函数化(消灭 God Object)。模板读 folder.path/isEmpty/files/subFolders 等——
// Vue 响应式追踪属性访问,故 getter/字段保留不函数化。scan/enrich/snapshot/CRUD/validate 均为模块级函数。

// 名字集合比对(信任短路的依据):现有 Map 的 key 集合与当前条目名集合是否完全一致。
// FS Access API 读不到目录 mtime,名字集合比对是最优的免费变更信号。
function sameNameSet(existingMap, currentEntries) {
  if (existingMap.size !== currentEntries.length)
    return false;
  for (const entry of currentEntries) {
    if (!existingMap.has(entry.name))
      return false;
  }
  return true;
}

export class SmartFolder {
  constructor({ handle, parent = null, virtualName = null, virtualConfig = null }) {
    this.handle = handle;
    this.parent = parent;

    if (virtualName) {
      this.name = virtualName;
      this.isVirtual = true;
      this.virtualConfig = virtualConfig || {};
    }
    else if (handle) {
      this.name = handle.name;
      this.isVirtual = false;
      this.virtualConfig = null;
    }
    else {
      throw new Error('必须提供 handle 或 virtualName');
    }

    this.files = [];
    this.subFolders = [];
    this.expanded = true;
  }

  // 实时算空状态:files/subFolders 在 store 的 reactive 数组里,.length 响应式 → getter 读响应式。
  get isEmpty() {
    return this.files.length === 0 && this.subFolders.length === 0;
  }

  get path() {
    if (this.isVirtual && this.virtualConfig?.customPath)
      return this.virtualConfig.customPath;
    const parts = [this.name];
    let current = this.parent;
    while (current) {
      parts.unshift(current.name);
      current = current.parent;
    }
    return parts.join('/');
  }
}

// ===== 行为函数(模块级)=====

export function toggleFolderExpanded(folder) {
  folder.expanded = !folder.expanded;
}

export async function deleteFolder(folder) {
  if (!folder.parent || !folder.parent.handle)
    throw new Error('无法删除根目录或缺少父级引用');
  try {
    await folder.parent.handle.removeEntry(folder.name, { recursive: true });
    const index = folder.parent.subFolders.indexOf(folder);
    if (index > -1)
      folder.parent.subFolders.splice(index, 1);
    return true;
  }
  catch (err) {
    console.error('删除文件夹失败:', err);
    throw err;
  }
}

export function addFileAndSort(folder, file) {
  if (!folder.files.includes(file)) {
    folder.files.push(file);
    file.parent = folder;
    folder.files.sort((a, b) => windowsCompareStrings(a.name, b.name));
  }
}

export function removeFileFromFolder(folder, file) {
  const index = folder.files.indexOf(file);
  if (index > -1)
    folder.files.splice(index, 1);
}

// 递归计数整树文件(不分配数组)。persistIfDirty 算 fileCount 用——
// 原 getAllFiles().length 为取一个数字分配万级数组(O(N) 内存)。
export function countAllFiles(folder) {
  let n = folder.files.length;
  for (const child of folder.subFolders)
    n += countAllFiles(child);
  return n;
}

// 按 path 在 folder 树里查 folder(T05:取代 foldersData.get(path) 的查询用途,为 T06 删 Map 铺路)。
// 纯函数:不改入参,递归 subFolders 匹配 folder.path。返回 folder 或 null。
// ⚠️ ALL_MEDIA 是虚拟文件夹(不在 rootFolder 树),不经此函数查询(switchToAllPhotos 直接用 allMediaFolder)。
export function findFolderByPath(root, path) {
  if (!root || !path)
    return null;
  if (root.path === path)
    return root;
  for (const sub of root.subFolders) {
    const found = findFolderByPath(sub, path);
    if (found)
      return found;
  }
  return null;
}

// 序列化为可持久化快照(整棵树 plain,handle 可克隆进 IDB)。不含 parent(重建时接回)。
export function folderToSnapshot(folder) {
  return {
    handle: folder.handle,
    name: folder.name,
    files: folder.files.map(f => fileToSnapshot(f)),
    subFolders: folder.subFolders.map(f => folderToSnapshot(f)),
    expanded: folder.expanded,
  };
}

// 从快照重建整棵树(sync,零 IO,纯函数)。parent 按传参接回。不注册 foldersData(注册归 service 层)。
export function folderFromSnapshot(snap, parent) {
  const folder = new SmartFolder({ handle: snap.handle, parent });
  folder.expanded = snap.expanded;
  folder.files = snap.files.map(f => fileFromSnapshot(f, folder));
  folder.subFolders = snap.subFolders.map(s => folderFromSnapshot(s, folder));
  return folder;
}

export function disposeFolder(folder) {
  for (const file of folder.files)
    disposeFile(file);
  folder.files = [];
}

// 后台补全:并发 getFile 给"待补"文件,收齐后同步批量写 _meta(Vue 批成一次 flush → sort 一次重排)。
// targets = 池空(peek null)且 _meta 未写的文件。信任短路后既有项 _meta 有 → targets 空 → 零 getFile。
export async function enrichFolder(folder, { token } = {}) {
  if (!folder.files || folder.files.length === 0)
    return;
  const targets = folder.files.filter(f => peek(f) == null && f._meta == null);
  if (targets.length === 0)
    return;
  const results = await runConcurrent(
    targets,
    async (f) => {
      if (token?.cancelled)
        return null;
      try {
        const file = await f.handle.getFile();
        await acquire(f, file); // 建 url(池,不响应式);size/mtime 由 _meta 单源(收齐后批量写)
        return { f, size: file.size, lastModified: file.lastModified };
      }
      catch (e) {
        console.warn(`enrich ${f.name} 失败:`, e);
        return null;
      }
    },
    { concurrency: CONFIG.PERFORMANCE.SCAN_CONCURRENCY, token },
  );
  if (token?.cancelled)
    return; // 取消则不批量写 _meta(acquire 已建 url 无害)
  // 同步批量写 _meta:Vue 把多次响应式变更批成一次 flush → sort computed 只重排一次
  for (const r of results) {
    if (r)
      r.f._meta = { size: r.size, lastModified: r.lastModified };
  }
}

export async function validateFolder(folder) {
  if (!folder.handle)
    return false;
  try {
    const permission = await folder.handle.queryPermission({ mode: 'read' });
    if (permission === 'denied')
      return false;
    await folder.handle.values().next();
    return true;
  }
  catch (err) {
    if (err.name === 'NotFoundError')
      return false;
    console.warn(`文件夹 ${folder.name} 验证失败:`, err);
    return false;
  }
}

export async function findValidFolderAncestor(folder) {
  let current = folder;
  while (current) {
    const isValid = await validateFolder(current);
    if (isValid)
      return current;
    current = current.parent;
  }
  return null;
}

// 工厂:建 SmartFolder + scanFolder(纯函数,不改 folder 入参、不碰 foldersData)。
export async function createFolder({ handle, parent = null }) {
  const folder = new SmartFolder({ handle, parent });
  const result = await scanFolder(folder);
  return { folder, ...result };
}

export function createVirtualFolder({ virtualName, virtualConfig = {} }) {
  return new SmartFolder({ handle: null, virtualName, virtualConfig });
}

// 纯列表 scan:values() 单次遍历做差集 + 名字集合信任短路,零 getFile。
// 纯函数——不改 folder 入参、不碰 foldersData、不调 dispose。返回 {files, subFolders, newFiles, newSubFolders, removedFiles, removedFolders}。
// trust 模式(后台重扫):名字集合一致 → 零 IO,result.files 沿用 folder.files 缓存引用。
export async function scanFolder(folder, { trust = false } = {}) {
  if (!folder.handle)
    throw new Error('scanFolder 需要有效的 handle');
  const dirHandle = folder.handle;

  // ① 现有 files/subFolders 的 name→obj 映射(用于差集)
  const existingFilesMap = new Map(folder.files.map(f => [f.name, f]));
  const existingFoldersMap = new Map(folder.subFolders.map(f => [f.name, f]));

  // ② 单次遍历目录,收齐当前条目(不 IO)
  const currentFileEntries = [];
  const currentDirEntries = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const ext = entry.name.split('.').pop().toLowerCase();
      if (!FileTypes.allMedia.includes(ext))
        continue; // 仅媒体
      currentFileEntries.push(entry);
    }
    else if (entry.kind === 'directory') {
      if (entry.name.startsWith('.'))
        continue; // 跳过隐藏目录
      currentDirEntries.push(entry);
    }
  }

  // ③ 信任短路:文件名 + 目录名集合都与缓存一致 → 零 IO,result.files 直接引用 folder.files
  if (trust && sameNameSet(existingFilesMap, currentFileEntries) && sameNameSet(existingFoldersMap, currentDirEntries)) {
    return {
      files: folder.files,
      subFolders: folder.subFolders,
      newFiles: [],
      newSubFolders: [],
      removedFiles: [],
      removedFolders: [],
    };
  }

  const filesToKeep = [];
  const foldersToKeep = [];
  const newFiles = [];
  const newSubFolders = [];

  // ④ 文件差集(纯名字比对,零 IO):既有信任保留,新建 SmartFile 不 acquire/getFile
  for (const entry of currentFileEntries) {
    const existing = existingFilesMap.get(entry.name);
    if (existing) {
      filesToKeep.push(existing);
      existingFilesMap.delete(entry.name);
    }
    else {
      const fileObj = new SmartFile({ handle: entry, parent: folder });
      filesToKeep.push(fileObj);
      newFiles.push(fileObj);
    }
  }

  // ⑤ 目录差集(无 IO):既有信任保留;新建 SmartFolder(纯函数,不注册 foldersData)
  for (const entry of currentDirEntries) {
    const existing = existingFoldersMap.get(entry.name);
    if (existing) {
      foldersToKeep.push(existing);
      existingFoldersMap.delete(entry.name);
    }
    else {
      const subFolderData = new SmartFolder({ handle: entry, parent: folder });
      foldersToKeep.push(subFolderData);
      newSubFolders.push(subFolderData);
    }
  }

  // ⑥ 删除项 = 差集后还在 Map 里的(目录已不存在)。不 dispose,交给 integrateScanResult。
  const removedFiles = [...existingFilesMap.values()];
  const removedFolders = [...existingFoldersMap.values()];

  // ⑦ 排序(Windows 风格)
  filesToKeep.sort((a, b) => windowsCompareStrings(a.name, b.name));
  foldersToKeep.sort((a, b) => windowsCompareStrings(a.name, b.name));

  return {
    files: filesToKeep,
    subFolders: foldersToKeep,
    newFiles,
    newSubFolders,
    removedFiles,
    removedFolders,
  };
}

// 工厂:创建 ALL_MEDIA 虚拟文件夹(聚合所有已扫描文件夹的文件)。
export function createAllMediaFolder() {
  return createVirtualFolder({
    virtualName: 'ALL_MEDIA',
    virtualConfig: {
      customPath: 'ALL_MEDIA',
      uiConfig: {
        iconHTML: '<i class="fas fa-layer-group"></i>',
        text: '所有媒体 (All Media)',
        id: 'allPhotosNode',
      },
    },
  });
}
