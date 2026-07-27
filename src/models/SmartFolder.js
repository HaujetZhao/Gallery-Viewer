import { FileTypes } from '../config/file-types';
import { windowsCompareStrings } from '../utils/format';
/**
 * SmartFolder 类 - 表示一个文件夹。搬自源码 js/model.SmartFolder.js。
 * scan() 增量算法原样保留(性能关键);appState 通过静态注入访问(保持纯逻辑,不依赖 Pinia)。
 */
import { SmartFile } from './SmartFile';
import { TreeNode } from './TreeNode';

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

  dispose() {
    for (const file of this.files) {
      file.dispose();
    }
    this.files = [];
  }

  // 增量扫描算法,性能关键,逻辑一字不改照搬源码(仅删 performance 调试日志 + removeDOMNodes→destroy)。
  async scan() {
    if (!this.handle)
      throw new Error('scan 需要有效的 handle');
    const dirHandle = this.handle;

    // ① 现有 files/subFolders 的 name→obj 映射(用于差集)
    const existingFilesMap = new Map(this.files.map(f => [f.name, f]));
    const existingFoldersMap = new Map(this.subFolders.map(f => [f.name, f]));

    const filesToKeep = [];
    const foldersToKeep = [];
    const newFiles = [];
    const newSubFolders = [];

    // ② 单次遍历目录
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (!FileTypes.allMedia.includes(ext))
          continue; // 仅媒体

        const existingFile = existingFilesMap.get(entry.name);
        if (existingFile) {
          try {
            const file = await entry.getFile();
            if (existingFile.size !== file.size || existingFile.lastModified !== file.lastModified) {
              await existingFile.refresh(); // 复用对象,只刷新
            }
            filesToKeep.push(existingFile);
            existingFilesMap.delete(entry.name);
          }
          catch {
            console.warn(`文件 ${entry.name} 的 handle 已失效，将被移除`);
          }
        }
        else {
          try {
            const file = await entry.getFile();
            const fileObj = new SmartFile({ handle: entry, file, parent: this });
            filesToKeep.push(fileObj);
            newFiles.push(fileObj);
          }
          catch (e) {
            console.warn('无法读取文件:', entry.name, e);
          }
        }
      }
      else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.'))
          continue; // 跳过隐藏目录

        const existingFolder = existingFoldersMap.get(entry.name);
        if (existingFolder) {
          foldersToKeep.push(existingFolder);
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
    }

    // ③ 清理"已被删除"的:留在 Map 里没被 delete 的 = 目录里已不存在
    for (const fileObj of existingFilesMap.values()) {
      fileObj.dispose();
    }
    for (const folderObj of existingFoldersMap.values()) {
      const deletedPath = folderObj.path;
      SmartFolder.appState.foldersData.delete(deletedPath);
      folderObj.treeNode?.destroy(); // 源码是 removeDOMNodes(),退化后改为数据清理
    }

    // ④ 排序(Windows 风格)
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
