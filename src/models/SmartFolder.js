import { FileTypes } from '../config/file-types';
import { CONFIG } from '../config/index';
/**
 * SmartFolder 类 - 表示一个文件夹。搬自源码 js/model.SmartFolder.js。
 * scan() 纯列名差集(零 getFile,瞬间出列表);enrich() 后台并发 getFile 补 size/mtime(响应式触发 sort 重排)。
 * appState 通过静态注入访问(保持纯逻辑,不依赖 Pinia)。
 */
import { acquire, peek } from '../services/fileResource';
import { runConcurrent } from '../utils/concurrency';
import { windowsCompareStrings } from '../utils/format';
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

  // 纯列表 scan:values() 单次遍历做差集 + 名字集合信任短路,零 getFile。
  // 新建文件 `new SmartFile` 不 acquire、不 getFile、_meta=null —— size/mtime 缺省,由 enrich() 后台补全。
  // Phase 2 简化:不再 size/mtime 校验(原地同名替换检测不到,文档 §2.3 接受,reload 兜底抓增删改名)。
  // trust 模式(后台重扫):名字集合一致 → 零 IO,沿用缓存对象。
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

    // ④ 文件差集(纯名字比对,零 IO):既有信任保留,新建 SmartFile 不 acquire/getFile
    for (const entry of currentFileEntries) {
      const existing = existingFilesMap.get(entry.name);
      if (existing) {
        filesToKeep.push(existing);
        existingFilesMap.delete(entry.name);
      }
      else {
        const fileObj = new SmartFile({ handle: entry, parent: this }); // 不 acquire / 不 getFile / _meta=null
        filesToKeep.push(fileObj);
        newFiles.push(fileObj);
      }
    }

    // ⑤ 目录差集(无 IO)
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

    // ⑥ 清理"已被删除"的:留在 Map 里没被 delete 的 = 目录里已不存在
    for (const fileObj of existingFilesMap.values())
      fileObj.dispose();
    for (const folderObj of existingFoldersMap.values()) {
      SmartFolder.appState.foldersData.delete(folderObj.path);
      folderObj.treeNode?.destroy(); // 源码是 removeDOMNodes(),退化后改为数据清理
    }

    // ⑦ 排序(Windows 风格)
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

  // 后台补全:并发 getFile 给"待补"文件填 size/mtime(_meta),触发 Vue 响应式让 sort 重排。
  // targets = 池空(peek null)且 _meta 未写的文件 —— 即 scan/listFolder 新建的项。
  // 信任短路后既有项 _meta 有 → targets 空 → 零 getFile(信任路零 IO)。
  // 写 _meta 是响应式关键:_meta 是 SmartFile 实例字段(在 store 的 reactive files 数组里),
  // 属性变更触发 Vue 重渲;peek 读普通 Map 不响应式 —— 不能依赖 peek 触发 sort。
  async enrich({ token } = {}) {
    if (!this.files || this.files.length === 0)
      return;
    const targets = this.files.filter(f => peek(f) == null && f._meta == null);
    if (targets.length === 0)
      return;
    await runConcurrent(
      targets,
      async (f) => {
        if (token?.cancelled)
          return;
        try {
          const file = await f.handle.getFile();
          await acquire(f, f, file); // 建 url + 缓存 size/mtime
          f._meta = { size: file.size, lastModified: file.lastModified }; // 写 _meta 触发响应式
        }
        catch (e) {
          console.warn(`enrich ${f.name} 失败:`, e);
        }
      },
      { concurrency: CONFIG.PERFORMANCE.SCAN_CONCURRENCY, token },
    );
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
