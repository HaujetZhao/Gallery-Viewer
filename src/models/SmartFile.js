// SmartFile 类 - 表示一个媒体文件。搬自源码 js/model.SmartFile.js,零外部依赖。
// 身份(handle/name/type)+ 派生缓存(md5)留实例;browsery 资源(blobUrl)+ 元数据(file/size/mtime)抽到 fileResource 池。
// SmartFile 当池的门面:blobUrl/size/lastModified 改 getter,消费方读语法不变(字段读 == getter 读)。
// _meta 是 fromSnapshot 重建时的快照槽 {size, lastModified}(零 IO 重建,池空时可读)。
// md5 是懒加载槽(外部算后赋值)。
import { acquire, destroy, peek } from '../services/fileResource';

export class SmartFile {
  constructor({ handle, parent = null }) {
    this.handle = handle; // FileSystemFileHandle
    this.parent = parent; // 父 SmartFolder 引用
    this._meta = null; // 快照槽 { size, lastModified }(fromSnapshot 用)
    this.md5 = null; // 懒加载,外部计算后赋值
  }

  // 懒建 blobUrl(池里无 → getFile + 建 url)。enrich 正常路径已 acquire,listFolder 新建/fromSnapshot 重建需懒。
  // peek 短路:enrich 已 acquire 则直接复用(省一次 acquire,也避开并发边角)。
  // R4:acquire 处统一写 _meta(单源)—— 消除原「ensureBlobUrl 路径 size 走 peek 兜底、其余走 _meta」的双数据源。
  async ensureBlobUrl() {
    const existing = peek(this);
    const entry = existing ?? (await acquire(this));
    if (this._meta == null && entry?.file)
      this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
    return entry.url;
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

  // _meta 优先(响应式):_meta 是 SmartFile 实例字段(在 store 的 reactive files 数组里,属性变更触发 Vue 响应式);
  // peek 读普通 Map(不响应式)。enrich 写 _meta → Gallery sort computed 重排。若仍优先 peek,enrich 后 size 变了 Vue 不知道。
  // `?? peek` 兜底(_meta 漏写时,如 ensureBlobUrl 后池里有但 _meta 未写)。
  get size() {
    return this._meta?.size; // R4:单源(池不放 size/mtime,消双数据源 stale)
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

  // 序列化为可持久化快照(plain;handle 可结构化克隆进 IDB)。不含 file/blobUrl/parent。
  // size/lastModified 从 getter 读(池或 _meta,scan 过的读池,fromSnapshot 重建的读 _meta)。
  toSnapshot() {
    return {
      handle: this.handle,
      name: this.name,
      size: this.size,
      lastModified: this.lastModified,
      md5: this.md5 ?? null,
    };
  }

  // 从快照重建(sync,零 IO)。handle/parent/md5 直接设;size/lastModified 落 _meta(池空时 getter 读得到)。
  static fromSnapshot(snap, parent) {
    const f = Object.create(SmartFile.prototype);
    f.handle = snap.handle;
    f.parent = parent;
    f._meta = { size: snap.size, lastModified: snap.lastModified };
    f.md5 = snap.md5 ?? null;
    return f;
  }

  async rename(newName) {
    if (!this.handle || !this.parent) {
      throw new Error('无法重命名：缺少必要的句柄或父级引用');
    }
    // 先 destroy 释放 url,避免 handle.move 报 "A FileSystemHandle cannot be moved while it is locked"
    // (缩略图 canvas/img 持有 blobUrl 时,Chrome 视文件为锁定)。move 后再 acquire 重建。
    destroy(this);
    try {
      await this.handle.move(newName);
      const entry = await acquire(this); // 重新 getFile 建 url
      // 写 _meta(响应式一致): rename 后 size/mtime 沿用新 File,与池同步
      this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      this.md5 = null;
      return true;
    }
    catch (err) {
      // move 失败,文件还在,重建 url(getFile 通常仍成功;失败则 blobUrl=null,记 warn 便于排查图裂)
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

  async move(targetFolder) {
    if (!this.parent || !this.parent.handle) {
      throw new Error('无法移动：缺少父级引用');
    }
    if (!targetFolder || !targetFolder.handle) {
      throw new Error('无法移动：目标文件夹无效');
    }
    try {
      const sourceFolder = this.parent;
      await this.handle.move(targetFolder.handle);
      sourceFolder.removeFile(this);
      this.parent = targetFolder;
      targetFolder.addFileAndSort(this);
      return true;
    }
    catch (err) {
      console.error('移动失败:', err);
      throw err;
    }
  }

  // 释放池条目(无视 owners)。dispose 用于文件从树移除 / 文件夹销毁。
  dispose() {
    destroy(this);
  }

  async validate() {
    if (!this.handle)
      return false;
    try {
      await this.handle.getFile();
      return true;
    }
    catch (err) {
      if (err.name === 'NotFoundError')
        return false;
      console.warn(`文件 ${this.name} 验证失败:`, err);
      return false;
    }
  }

  // 文件头魔数识别实际类型。位运算逐字符照搬源码。
  async getActualType() {
    try {
      const file = peek(this)?.file ?? await this.handle.getFile(); // R6:复用池(已 acquire 则不重复 getFile),池空才 getFile
      const buffer = await file.slice(0, 12).arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47)
        return 'png';
      if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
        return 'jpg';
      if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return 'gif';
      if (
        bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50
      ) {
        return 'webp';
      }
      if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D)
        return 'bmp';

      if (this.type === 'svg') {
        const text = await file.slice(0, 1000).text();
        if (text.includes('<svg') || text.includes('<?xml'))
          return 'svg';
      }
      return this.type;
    }
    catch (err) {
      console.warn(`获取文件 ${this.name} 实际类型失败:`, err);
      return this.type;
    }
  }
}
