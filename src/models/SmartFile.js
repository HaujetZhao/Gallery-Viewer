/**
 * SmartFile 类 - 表示一个媒体文件。搬自源码 js/model.SmartFile.js,零外部依赖。
 * blobUrl 构造时立即建;md5 是懒加载槽(外部算后赋值)。
 */
export class SmartFile {
  constructor({ handle, file, parent = null }) {
    this.handle = handle; // FileSystemFileHandle
    this.file = file; // File 对象
    this.parent = parent; // 父 SmartFolder 引用
    this.blobUrl = URL.createObjectURL(file);
    this.dom = null; // deprecated: gallery 卡片 DOM 反向引用,新代码不依赖
    this.md5 = null; // 懒加载,外部计算后赋值
  }

  _extractType(filename) {
    const parts = filename.split('.');
    if (parts.length < 2) return '';
    return parts.pop().toLowerCase();
  }

  get name() {
    return this.handle.name;
  }
  get size() {
    return this.file.size;
  }
  get lastModified() {
    return this.file.lastModified;
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
    } catch (err) {
      // move 失败,从原 file 重建 blobUrl(已 revoke)
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
      // 源码此处还有 sourceFolder.updateCount()/targetFolder.updateCount()
      // 退化后 count 是计算属性(folder.files.length),无需手动更新,已删
      return true;
    } catch (err) {
      console.error('移动失败:', err);
      throw err;
    }
  }

  async refresh() {
    try {
      const file = await this.handle.getFile();
      if (this.size !== file.size || this.lastModified !== file.lastModified) {
        if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
        this.file = file;
        // 源码原本还有 this.size = file.size / this.lastModified = file.lastModified,
        // 会遮蔽 getter,冗余且怪异,已删(getter 本就读 this.file)
        this.blobUrl = URL.createObjectURL(file);
        this.md5 = null;
      }
      return true;
    } catch (err) {
      console.error('刷新文件失败:', err);
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
    if (!this.handle) return false;
    try {
      await this.handle.getFile();
      return true;
    } catch (err) {
      if (err.name === 'NotFoundError') return false;
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

      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'png';
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
      if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return 'gif';
      if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
        return 'webp';
      if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';

      if (this.type === 'svg') {
        const text = await file.slice(0, 1000).text();
        if (text.includes('<svg') || text.includes('<?xml')) return 'svg';
      }
      return this.type;
    } catch (err) {
      console.warn(`获取文件 ${this.name} 实际类型失败:`, err);
      return this.type;
    }
  }
}
