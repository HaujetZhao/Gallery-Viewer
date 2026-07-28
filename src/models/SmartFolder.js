import { FileTypes } from '../config/file-types';
import { CONFIG } from '../config/index';
import { runConcurrent } from '../utils/concurrency';
import { windowsCompareStrings } from '../utils/format';
/**
 * SmartFolder 类 - 表示一个文件夹。搬自源码 js/model.SmartFolder.js。
 * scan() 增量算法 + 并发 getFile + 信任快照短路(性能关键);appState 通过静态注入访问(保持纯逻辑,不依赖 Pinia)。
 */
import { SmartFile } from './SmartFile';
import { TreeNode } from './TreeNode';

// 名字集合比对(信任短路的依据):现有 Map 的 key 集合与当前条目名集合是否完全一致。
// FS Access API 读不到目录 mtime(见设计文档),名字集合比对是最优的免费变更信号。
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
  // 静态注入:由 fsStore 初始化时设为 { get rootHandle(), get foldersData() }
  static appState = null;

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
    this.scanned = false;
    this.treeNode = new TreeNode(this);
  }

  static async create({ handle, parent = null }) {
    const folder = new SmartFolder({ handle, parent });
    return await folder.scan();
  }

  static createVirtual({ virtualName, virtualConfig = {} }) {
    return new SmartFolder({ handle: null, virtualName, virtualConfig });
  }

  get path() {
    if (this.isVirtual && this.virtualConfig?.customPath) {
      return this.virtualConfig.customPath;
    }
    const parts = [this.name];
    let current = this.parent;
    while (current) {
      parts.unshift(current.name);
      current = current.parent;
    }
    return parts.join('/');
  }

  async delete() {
    if (!this.parent || !this.parent.handle) {
      throw new Error('无法删除根目录或缺少父级引用');
    }
    try {
      await this.parent.handle.removeEntry(this.name, { recursive: true });
      const index = this.parent.subFolders.indexOf(this);
      if (index > -1)
        this.parent.subFolders.splice(index, 1);
      return true;
    }
    catch (err) {
      console.error('删除文件夹失败:', err);
      throw err;
    }
  }

  async move(_targetFolder) {
    throw new Error('文件夹移动功能暂未实现');
  }

  addFile(file) {
    if (!this.files.includes(file)) {
      this.files.push(file);
      file.parent = this;
    }
  }

  addFileAndSort(file) {
    if (!this.files.includes(file)) {
      this.files.push(file);
      file.parent = this;
      this.files.sort((a, b) => windowsCompareStrings(a.name, b.name));
    }
  }

  removeFile(file) {
    const index = this.files.indexOf(file);
    if (index > -1)
      this.files.splice(index, 1);
  }

  findFile(fileName) {
    return this.files.find(f => f.name === fileName) || null;
  }

  getFileCount() {
    return this.files.length;
  }

  // 递归获取所有文件(含子文件夹)。源码原写 this.children(不存在),已修为 this.subFolders。
  getAllFiles() {
    let allFiles = [...this.files];
    for (const child of this.subFolders) {
      allFiles = allFiles.concat(child.getAllFiles());
    }
    return allFiles;
  }

  // 序列化为可持久化快照(整棵树 plain,handle 可克隆进 IDB)。不含 parent/treeNode(重建时接回/新建)。
  toSnapshot() {
    return {
      handle: this.handle,
      name: this.name,
      files: this.files.map(f => f.toSnapshot()),
      subFolders: this.subFolders.map(f => f.toSnapshot()),
      expanded: this.treeNode?.expanded ?? true,
      scanned: this.scanned,
    };
  }

  // 从快照重建整棵树(sync,零 IO)。parent 按传参接回;每节点注册 appState.foldersData(切换后 handleFolderClick/getFolderData 按 path 查)。
  static fromSnapshot(snap, parent) {
    const folder = new SmartFolder({ handle: snap.handle, parent });
    folder.scanned = snap.scanned;
    folder.files = snap.files.map(f => SmartFile.fromSnapshot(f, folder));
    folder.subFolders = snap.subFolders.map(s => SmartFolder.fromSnapshot(s, folder));
    if (folder.treeNode)
      folder.treeNode.expanded = snap.expanded;
    folder.treeNode?.refreshState();
    if (SmartFolder.appState)
      SmartFolder.appState.foldersData.set(folder.path, folder);
    return folder;
  }

  dispose() {
    for (const file of this.files) {
      file.dispose();
    }
    this.files = [];
  }

  // 增量扫描算法,性能关键。
  // 两阶段思想:① values() 单次遍历做差集(免费,无 per-file IO);② 需要元数据的项并发 getFile。
  // trust 模式(后台重扫):名字集合与缓存一致 → 零 getFile,直接信快照;有差异 → 只对新增项 getFile,既有项信任保留。
  // 非 trust 模式(首次/手动重载):既有项也 getFile 校验 size/mtime,变了就地刷新(用已 fetch 的 file,不二次 IO)。
  async scan({ trust = false } = {}) {
    if (!this.handle)
      throw new Error('scan 需要有效的 handle');
    const dirHandle = this.handle;

    // ① 现有 files/subFolders 的 name→obj 映射(用于差集)
    const existingFilesMap = new Map(this.files.map(f => [f.name, f]));
    const existingFoldersMap = new Map(this.subFolders.map(f => [f.name, f]));

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

    // ③ 信任短路:文件名 + 目录名集合都与缓存一致 → 零 IO,沿用缓存对象
    if (trust && sameNameSet(existingFilesMap, currentFileEntries) && sameNameSet(existingFoldersMap, currentDirEntries)) {
      this.scanned = true;
      this.treeNode?.refreshState();
      return { folder: this, newFiles: [], newSubFolders: [], removedFileCount: 0, removedFolderCount: 0 };
    }

    const filesToKeep = [];
    const foldersToKeep = [];
    const newFiles = [];
    const newSubFolders = [];
    const needGetFile = []; // { entry, existing? } 并发取元数据

    // ④ 文件差集:既有项信任保留(trust)或排进校验队列(非 trust);新项一律取元数据
    for (const entry of currentFileEntries) {
      const existing = existingFilesMap.get(entry.name);
      if (existing) {
        filesToKeep.push(existing);
        existingFilesMap.delete(entry.name);
        if (!trust)
          needGetFile.push({ entry, existing });
      }
      else {
        needGetFile.push({ entry, existing: null });
      }
    }

    // ⑤ 并发 getFile(SCAN_CONCURRENCY 上限,错误隔离)
    await runConcurrent(
      needGetFile,
      async ({ entry, existing }) => {
        try {
          const file = await entry.getFile();
          if (existing) {
            // 非 trust 校验:变了就用已 fetch 的 file 就地刷新(不二次 IO,不依赖 existing.handle)
            if (existing.size !== file.size || existing.lastModified !== file.lastModified) {
              if (existing.blobUrl)
                URL.revokeObjectURL(existing.blobUrl);
              existing.file = file;
              existing.blobUrl = URL.createObjectURL(file);
              existing._size = file.size;
              existing._lastModified = file.lastModified;
              existing.md5 = null;
            }
          }
          else {
            const fileObj = new SmartFile({ handle: entry, file, parent: this });
            filesToKeep.push(fileObj);
            newFiles.push(fileObj);
          }
        }
        catch (e) {
          console.warn(`文件 ${entry.name} 读取失败,已跳过:`, e);
        }
      },
      { concurrency: CONFIG.PERFORMANCE.SCAN_CONCURRENCY },
    );

    // ⑥ 目录差集(无 IO)
    for (const entry of currentDirEntries) {
      const existing = existingFoldersMap.get(entry.name);
      if (existing) {
        foldersToKeep.push(existing);
        existingFoldersMap.delete(entry.name);
      }
      else {
        const subFolderData = new SmartFolder({ handle: entry, parent: this });
        const subPath = `${this.path}/${entry.name}`;
        SmartFolder.appState.foldersData.set(subPath, subFolderData); // 全局注册
        foldersToKeep.push(subFolderData);
        newSubFolders.push(subFolderData);
      }
    }

    // ⑦ 清理"已被删除"的:留在 Map 里没被 delete 的 = 目录里已不存在
    for (const fileObj of existingFilesMap.values())
      fileObj.dispose();
    for (const folderObj of existingFoldersMap.values()) {
      SmartFolder.appState.foldersData.delete(folderObj.path);
      folderObj.treeNode?.destroy(); // 源码是 removeDOMNodes(),退化后改为数据清理
    }

    // ⑧ 排序(Windows 风格)
    filesToKeep.sort((a, b) => windowsCompareStrings(a.name, b.name));
    foldersToKeep.sort((a, b) => windowsCompareStrings(a.name, b.name));

    this.files = filesToKeep;
    this.subFolders = foldersToKeep;
    this.scanned = true;
    this.treeNode?.refreshState();

    return {
      folder: this,
      newFiles,
      newSubFolders,
      removedFileCount: existingFilesMap.size,
      removedFolderCount: existingFoldersMap.size,
    };
  }

  async validate() {
    if (!this.handle)
      return false;
    try {
      const permission = await this.handle.queryPermission({ mode: 'read' });
      if (permission === 'denied')
        return false;
      await this.handle.values().next();
      return true;
    }
    catch (err) {
      if (err.name === 'NotFoundError')
        return false;
      console.warn(`文件夹 ${this.name} 验证失败:`, err);
      return false;
    }
  }

  async findValidAncestor() {
    let current = this;
    while (current) {
      const isValid = await current.validate();
      if (isValid)
        return current;
      current = current.parent;
    }
    return null;
  }
}

// 工厂:创建 ALL_MEDIA 虚拟文件夹(聚合所有已扫描文件夹的文件)。
// 源码原本在模块加载时建单例 + 注入 foldersData(副作用),现挪到 fsStore 初始化,避免 import 时序问题。
export function createAllMediaFolder() {
  return SmartFolder.createVirtual({
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
