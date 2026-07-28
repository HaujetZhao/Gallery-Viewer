import { FileTypes } from '../config/file-types';
import { CONFIG } from '../config/index';
/**
 * SmartFolder 类 - 表示一个文件夹。搬自源码 js/model.SmartFolder.js。
 * scanFolder()(模块级纯函数,Phase 3 Step 1)纯列名差集(零 getFile,瞬间出列表,不改入参);
 * enrich() 后台并发 getFile 补 size/mtime(响应式触发 sort 重排)。
 * Phase 3 Step 2:删 static appState 静态注入 —— fromSnapshot 改纯函数(不注册 foldersData),
 * foldersData 注册归 service 层(switchToRoot 的 registerFolderTree),彻底去掉 model→store 反向依赖。
 */
import { acquire, peek } from '../services/fileResource';
import { runConcurrent } from '../utils/concurrency';
import { windowsCompareStrings } from '../utils/format';
import { SmartFile } from './SmartFile';

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
    this.expanded = true; // 侧栏树展开态(原 TreeNode 字段,Vue3 化后并入 folder)
  }

  // 实时算空状态(原 TreeNode.refreshState 的逻辑,改成 getter 免手动调用):
  // files/subFolders 在 store 的 reactive 数组里,.length 响应式 → getter 读响应式(SidebarTreeItem 自动更新)。
  get isEmpty() {
    return this.files.length === 0 && this.subFolders.length === 0;
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
  }

  // 工厂:建 SmartFolder + scanFolder(纯函数,不改 this/不注册 foldersData)。
  // 调用方拿 result 自己 integrateScanResult(写回代理 folder —— Vue 响应式关键)。
  static async create({ handle, parent = null }) {
    const folder = new SmartFolder({ handle, parent });
    const result = await scanFolder(folder);
    return { folder, ...result };
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

  // 递归计数整树文件(不分配数组)。persistIfDirty 算 fileCount 用——
  // 原 getAllFiles().length 为取一个数字分配万级数组(O(N) 内存),1 万+ 图每次 dirty 都付。
  countAllFiles() {
    let n = this.files.length;
    for (const child of this.subFolders)
      n += child.countAllFiles();
    return n;
  }

  // 序列化为可持久化快照(整棵树 plain,handle 可克隆进 IDB)。不含 parent(重建时接回)。
  toSnapshot() {
    return {
      handle: this.handle,
      name: this.name,
      files: this.files.map(f => f.toSnapshot()),
      subFolders: this.subFolders.map(f => f.toSnapshot()),
      expanded: this.expanded,
    };
  }

  // 从快照重建整棵树(sync,零 IO,纯函数)。parent 按传参接回。
  // Phase 3 Step 2:不注册 foldersData(纯函数)—— 注册副作用移到 switchToRoot 的 registerFolderTree(service 层),
  // 切换后 handleFolderClick/getFolderData 按 path 查 foldersData 取到 folder。
  static fromSnapshot(snap, parent) {
    const folder = new SmartFolder({ handle: snap.handle, parent });
    folder.expanded = snap.expanded;
    folder.files = snap.files.map(f => SmartFile.fromSnapshot(f, folder));
    folder.subFolders = snap.subFolders.map(s => SmartFolder.fromSnapshot(s, folder));
    return folder;
  }

  dispose() {
    for (const file of this.files) {
      file.dispose();
    }
    this.files = [];
  }

  // 后台补全:并发 getFile 给"待补"文件,收齐后同步批量写 _meta(Vue 批成一次 flush → sort 一次重排)。
  // R5:worker 只 getFile + acquire(池缓存 size/mtime,不响应式),返回结果;不再逐个写 _meta(避免 N 次 sort 重排)。
  // targets = 池空(peek null)且 _meta 未写的文件 —— 即 scanFolder 新建的项。
  // 信任短路后既有项 _meta 有 → targets 空 → 零 getFile(信任路零 IO)。
  // 写 _meta 是响应式关键:_meta 是 SmartFile 实例字段(在 store 的 reactive files 数组里);
  // 批量同步写让 Vue 合并成一次 flush,sort computed 只重排一次(修 size/date 排序 O(N²) 风暴)。
  async enrich({ token } = {}) {
    if (!this.files || this.files.length === 0)
      return;
    const targets = this.files.filter(f => peek(f) == null && f._meta == null);
    if (targets.length === 0)
      return;
    const results = await runConcurrent(
      targets,
      async (f) => {
        if (token?.cancelled)
          return null;
        try {
          const file = await f.handle.getFile();
          await acquire(f, file); // R4:建 url(池,不响应式);size/mtime 由 _meta 单源(收齐后批量写)
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
      return; // 取消则不批量写 _meta(getter 此时返回 undefined,留待下次 enrich 补;acquire 已建 url 无害)
    // 同步批量写 _meta:Vue 把多次响应式变更批成一次 flush → sort computed 只重排一次
    for (const r of results) {
      if (r)
        r.f._meta = { size: r.size, lastModified: r.lastModified };
    }
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

// 纯列表 scan:values() 单次遍历做差集 + 名字集合信任短路,零 getFile。
// Phase 3 Step 1:纯函数化 —— 不改 folder 入参(files/subFolders 原样保留)、不碰 foldersData、不调 dispose。
// 新建 SmartFile/SmartFolder(parent=folder)是建对象(允许)。
// removedFiles/removedFolders 暴露给调用方,integrateScanResult(service 层)统一处理副作用。
// Phase 2 简化:不再 size/mtime 校验(原地同名替换检测不到,文档 §2.3 接受);reload 抓增删改名(含同名替换:
// reload 走 initProject 清 foldersData + 重建树 + enrich 重 getFile,故 reload 能抓同名内容替换,扫描则不能)。
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
  //    (零拷贝;integrateScanResult 自赋值 no-op。勿改浅拷贝——会退化。)
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
      const fileObj = new SmartFile({ handle: entry, parent: folder }); // 不 acquire / 不 getFile / _meta=null
      filesToKeep.push(fileObj);
      newFiles.push(fileObj);
    }
  }

  // ⑤ 目录差集(无 IO):既有信任保留;新建 SmartFolder(**不注册 foldersData**,纯函数)
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
