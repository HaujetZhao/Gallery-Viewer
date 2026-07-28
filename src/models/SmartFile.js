/**
 * SmartFile 类 - 表示一个媒体文件。搬自源码 js/model.SmartFile.js,零外部依赖。
 * blobUrl 构造时立即建(正常 scan 路径有 file);fromSnapshot 重建时懒建(ensureBlobUrl)。
 * _size/_lastModified 缓存:支持 fromSnapshot(file=null)时 getter 仍可读。
 * md5 是懒加载槽(外部算后赋值)。
 */
export class SmartFile {
  constructor({ handle, file, parent = null }) {
    this.handle = handle; // FileSystemFileHandle
    this.file = file; // File 对象(可能为 null,fromSnapshot 重建时)
    this.parent = parent; // 父 SmartFolder 引用
    this._size = file?.size; // 缓存,file=null 时 getter fallback 用
    this._lastModified = file?.lastModified;
    this.blobUrl = file ? URL.createObjectURL(file) : null;
    this.dom = null; // deprecated: gallery 卡片 DOM 反向引用,新代码不依赖
    this.md5 = null; // 懒加载,外部计算后赋值
  }

  // 懒建 blobUrl(fromSnapshot 重建的文件无 blobUrl;显示原图/拖拽前调)。
  // 单文件 IO,不影响秒切换(切换只重建结构)。
  async ensureBlobUrl() {
    if (!this.blobUrl) {
      this.file = await this.handle.getFile();
      this.blobUrl = URL.createObjectURL(this.file);
      this._size = this.file.size;
      this._lastModified = this.file.lastModified;
    }
    return this.blobUrl;
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

  get size() {
    return this.file?.size ?? this._size;
  }

  get lastModified() {
    return this.file?.lastModified ?? this._lastModified;
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

  // 序列化为可持久化快照(plain;handle 可结构化克隆进 IDB)。不含 file/blobUrl/parent。
  toSnapshot() {
    return {
      handle: this.handle,
      name: this.name,
      size: this.size,
      lastModified: this.lastModified,
      md5: this.md5 ?? null,
    };
  }

  // 从快照重建(sync,零 IO)。file/blobUrl 懒(ensureBlobUrl 时从 handle 取);parent 按传参接回。
  static fromSnapshot(snap, parent) {
    const f = Object.create(SmartFile.prototype);
    f.handle = snap.handle;
    f.file = null;
    f.parent = parent;
    f._size = snap.size;
    f._lastModified = snap.lastModified;
    f.blobUrl = null;
    f.dom = null;
    f.md5 = snap.md5 ?? null;
    return f;
  }

  async rename(newName) {
    if (!this.handle || !this.parent) {
      throw new Error('无法重命名：缺少必要的句柄或父级引用');
    }
    // 先 revoke blobUrl 释放引用,避免 handle.move 报 "A FileSystemHandle cannot be moved while it is locked"
    // (缩略图 canvas/img 持有 blobUrl 时,Chrome 视文件为锁定)。move 后再重建。
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    try {
      await this.handle.move(newName);
      const newFile = await this.handle.getFile();
      this.file = newFile;
      this.blobUrl = URL.createObjectURL(newFile);
      this.md5 = null;
      return true;
    }
    catch (err) {
      // move 失败,从原 file 重建 blobUrl(已 revoke)
      if (this.file)
        this.blobUrl = URL.createObjectURL(this.file);
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

  dispose() {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
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
      const file = await this.handle.getFile();
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
