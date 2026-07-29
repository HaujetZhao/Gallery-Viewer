// SmartFile:媒体文件。纯数据(handle/parent/_meta/md5)+ 派生 getter(name/size/lastModified/type/path/blobUrl)+ 对象行为(rename/move)。
// T08:对象行为(rename/move)从模块函数回 class(消灭半半设计 + moveFile 绕门面 splice 的循环依赖尴尬——
// file.move 调 this.parent.removeFile + target.addFile,不再内联 splice,也消除旧 moveFile 反向 import SmartFolder 的循环依赖)。
// 模板读 getter——Vue 响应式追踪属性访问,勿函数化。_meta 是快照槽(零 IO 重建);md5 懒加载槽。
// 纯算法(fileToSnapshot/fileFromSnapshot/ensureBlobUrl/disposeFile)仍留模块级。
import { acquire, destroy, peek } from '../services/fileResource';

export class SmartFile {
  constructor({ handle, parent = null }) {
    this.handle = handle;
    this.parent = parent;
    this._meta = null; // 快照槽 { size, lastModified }(fromSnapshot 用)
    this.md5 = null; // 懒加载,外部计算后赋值
  }

  _extractType(filename) {
    const parts = filename.split('.');
    if (parts.length < 2)
      return '';
    return parts.pop().toLowerCase();
  }

  get name() {
    return this.handle.name;
  }

  // _meta 是 size/mtime 单一数据源(只读 _meta,响应式字段)。
  get size() {
    return this._meta?.size;
  }

  get lastModified() {
    return this._meta?.lastModified;
  }

  get type() {
    return this._extractType(this.name);
  }

  get path() {
    const parts = [this.name];
    let current = this.parent;
    while (current) {
      parts.unshift(current.name);
      current = current.parent;
    }
    return parts.join('/');
  }

  // 池里读 url(可能 null,如 fromSnapshot 后未 acquire)。
  get blobUrl() {
    return peek(this)?.url ?? null;
  }

  async rename(newName) {
    if (!this.handle || !this.parent)
      throw new Error('无法重命名：缺少必要的句柄或父级引用');
    // 先 destroy 释放 url,避免 handle.move 报 "A FileSystemHandle cannot be moved while it is locked"
    // (缩略图 canvas/img 持有 blobUrl 时,Chrome 视文件为锁定)。move 后再 acquire 重建。
    destroy(this);
    try {
      await this.handle.move(newName);
      const entry = await acquire(this);
      this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      this.md5 = null;
      return true;
    }
    catch (err) {
      const entry = await acquire(this).catch((e) => {
        console.warn('重命名失败后重建资源失败,blobUrl 将为 null:', e);
        return null;
      });
      if (entry)
        this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      console.error('重命名失败:', err);
      throw err;
    }
  }

  // 移动文件到目标文件夹。树维护走 folder 方法(this.parent.removeFile + target.addFile)——
  // 不再内联 splice(T08 消灭"移动绕门面、删除走门面"的双风格)。
  async move(target) {
    if (!this.parent || !this.parent.handle)
      throw new Error('无法移动：缺少父级引用');
    if (!target || !target.handle)
      throw new Error('移动：目标文件夹无效');
    try {
      await this.handle.move(target.handle);
      this.parent.removeFile(this); // 源移除(走 folder 方法)
      target.addFile(this); // 目标按序插入(addFile 内部 push + sort + 设 parent)
      return true;
    }
    catch (err) {
      console.error('移动失败:', err);
      throw err;
    }
  }
}

// ===== 模块级纯算法(序列化/快照/懒建/释放)=====

// 懒建 blobUrl(池里无 → getFile + 建 url)。enrich 正常路径已 acquire,listFolder 新建/fromSnapshot 重建需懒。
// peek 短路:enrich 已 acquire 则直接复用。acquire 处统一写 _meta(单源)。
export async function ensureBlobUrl(file) {
  const existing = peek(file);
  const entry = existing ?? (await acquire(file));
  if (file._meta == null && entry?.file)
    file._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
  return entry.url;
}

// 序列化为可持久化快照(plain;handle 可结构化克隆进 IDB)。不含 file/blobUrl/parent。
export function fileToSnapshot(file) {
  return {
    handle: file.handle,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    md5: file.md5 ?? null,
  };
}

// 从快照重建(sync,零 IO)。size/lastModified 落 _meta(池空时 getter 读得到)。
export function fileFromSnapshot(snap, parent) {
  const f = Object.create(SmartFile.prototype);
  f.handle = snap.handle;
  f.parent = parent;
  f._meta = { size: snap.size, lastModified: snap.lastModified };
  f.md5 = snap.md5 ?? null;
  return f;
}

// 释放池条目(无视 owners)。文件从树移除 / 文件夹销毁用。
export function disposeFile(file) {
  destroy(file);
}
