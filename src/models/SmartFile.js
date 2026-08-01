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

  // 视频时长。_meta.duration 作运行时缓存——由 file-meta store(md5 索引)懒加载填入,或抽帧时填入。
  // 不随快照持久化(跨副本共享走 file-meta store)。非视频/未加载 → undefined。
  get duration() {
    return this._meta?.duration;
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
    // move 只改名、内容字节不变 → md5 保留(缩略图/收藏/file-meta 缓存仍命中),_meta 更新 size/mtime
    // 并保留 duration(否则重命名后 badge 时长清空,缩略图却仍显示,自相矛盾)。
    const prevDuration = this._meta?.duration;
    try {
      await this.handle.move(newName);
      const entry = await acquire(this);
      this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      if (prevDuration != null)
        this._meta.duration = prevDuration;
      // md5 不清:move 不改内容,旧 md5 仍正确;若外部确实改了内容,detectFileChange 会兜底清。
      return true;
    }
    catch (err) {
      const entry = await acquire(this).catch((e) => {
        console.warn('重命名失败后重建资源失败,blobUrl 将为 null:', e);
        return null;
      });
      if (entry) {
        this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
        if (prevDuration != null)
          this._meta.duration = prevDuration;
      }
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
    // duration 不再随快照——迁至 file-meta store(md5 索引,跨副本共享)
  };
}

// 从快照重建(sync,零 IO)。size/lastModified 落 _meta(池空时 getter 读得到)。
// duration 不从快照恢复(从 file-meta store 懒加载)。
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

// R3:单文件"改"检测——读 getFile 比 _meta,变了则更新 _meta + 清 md5(缩略图下次懒加载重算)。
// 纯函数:不碰 store。modal 打开时调(ensureBlobUrl 后 peek 复用 File,省一次 IO)。返回是否变了。
export async function detectFileChange(file) {
  if (!file?.handle)
    return false;
  try {
    const raw = peek(file)?.file ?? await file.handle.getFile();
    if (!file._meta) {
      file._meta = { size: raw.size, lastModified: raw.lastModified };
      return false;
    }
    if (file._meta.size !== raw.size || file._meta.lastModified !== raw.lastModified) {
      file._meta = { size: raw.size, lastModified: raw.lastModified };
      file.md5 = null; // 内容变 → 清 md5(缩略图懒加载重算)
      return true;
    }
  }
  catch (e) {
    console.warn(`detectFileChange ${file.name} 失败:`, e);
  }
  return false;
}
