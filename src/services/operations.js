// 文件操作命令(命令模式)。搬自源码 js/operation-history.js 的 3 个 Operation 类。
// FileDelete 含 .trash 回收站逻辑(镜像目录 + 防重名);Rename/Move 委托 SmartFile。
// 文件删除进撤销栈;文件夹删除不进(物理 removeEntry,不可逆,见 fileOps.handleDeleteFolder)。
import { useFsStore } from '../stores/fs';
import { acquire, destroy } from './fileResource';

export const OperationType = {
  FILE_DELETE: 'file_delete',
  FILE_RENAME: 'file_rename',
  FILE_MOVE: 'file_move',
};

class Operation {
  constructor(type, target) {
    this.type = type;
    this.target = target;
    this.timestamp = Date.now();
  }

  async execute() {
    throw new Error('execute() must be implemented');
  }

  async undo() {
    throw new Error('undo() must be implemented');
  }

  getDescription() {
    throw new Error('getDescription() must be implemented');
  }
}

// 删除文件 → 移到 root/.trash(镜像原目录结构 + 防重名)。undo 从 .trash 移回原位原名。
export class FileDeleteOperation extends Operation {
  constructor(fileData) {
    super(OperationType.FILE_DELETE, fileData);
    this.fileData = fileData;
    this.parentFolder = fileData.parent;
    this.originalName = fileData.name;
    this.trashPath = null;
  }

  // 去掉根目录名 + 文件名,返回纯父级相对路径(用于 .trash 镜像)
  _getRelativePath() {
    const pathParts = this.fileData.path.split('/');
    const rootName = useFsStore().rootHandle.name;
    if (pathParts[0] === rootName)
      pathParts.shift();
    pathParts.pop();
    return pathParts.join('/');
  }

  // 在 root 下建 .trash,按原相对路径镜像建子目录
  async _createTrashDirectory() {
    const rootTrashHandle = await useFsStore().rootHandle.getDirectoryHandle('.trash', { create: true });
    const relativePath = this._getRelativePath();
    if (!relativePath)
      return rootTrashHandle;
    let current = rootTrashHandle;
    for (const dir of relativePath.split('/')) {
      current = await current.getDirectoryHandle(dir, { create: true });
    }
    return current;
  }

  // _1/_2 防重名(基于扩展名拆分)
  async _generateUniqueTrashName(trashDirHandle) {
    const fileName = this.originalName;
    const dotIdx = fileName.lastIndexOf('.');
    const baseName = dotIdx !== -1 ? fileName.substring(0, dotIdx) : fileName;
    const ext = dotIdx !== -1 ? fileName.substring(dotIdx) : '';
    let targetName = fileName;
    let counter = 1;
    while (true) {
      try {
        await trashDirHandle.getFileHandle(targetName); // 已存在则试下一个
        targetName = `${baseName}_${counter}${ext}`;
        counter++;
      }
      catch (e) {
        if (e.name === 'NotFoundError')
          break; // 名字可用
        throw e;
      }
    }
    return targetName;
  }

  async execute() {
    if (!this.parentFolder?.handle)
      throw new Error('无法定位父文件夹');
    const trashDirHandle = await this._createTrashDirectory();
    const trashName = await this._generateUniqueTrashName(trashDirHandle);
    await this.fileData.handle.move(trashDirHandle, trashName); // move(dir, name) 双参
    const relativePath = this._getRelativePath();
    this.trashPath = relativePath ? `${relativePath}/${trashName}` : trashName;
    this.parentFolder.removeFile(this.fileData);
    // Vue 响应式:removeFile 改了 parent.files,Gallery 自动重渲
  }

  async undo() {
    if (!this.trashPath)
      throw new Error('没有删除信息,无法撤销');
    const rootTrashHandle = await useFsStore().rootHandle.getDirectoryHandle('.trash');
    const pathParts = this.trashPath.split('/');
    const trashName = pathParts.pop();
    let trashDirHandle = rootTrashHandle;
    for (const dir of pathParts) {
      trashDirHandle = await trashDirHandle.getDirectoryHandle(dir);
    }
    const trashedFileHandle = await trashDirHandle.getFileHandle(trashName);
    await trashedFileHandle.move(this.parentFolder.handle, this.originalName); // 回原位原名
    // move 后旧 handle 失效,重取 + destroy 旧 url + acquire 建新 url + 清 md5
    const restoredHandle = await this.parentFolder.handle.getFileHandle(this.originalName);
    const restoredFile = await restoredHandle.getFile();
    destroy(this.fileData); // 清旧 url(池里有则 revoke)
    this.fileData.handle = restoredHandle;
    await acquire(this.fileData, this.fileData, restoredFile); // 建 url + 缓存 size/mtime(复用 restoredFile 零重复 IO)
    this.fileData.md5 = null;
    this.parentFolder.addFileAndSort(this.fileData);
  }

  getDescription() {
    return `删除文件:${this.originalName}`;
  }
}

export class FileRenameOperation extends Operation {
  constructor(fileData, oldName, newName) {
    super(OperationType.FILE_RENAME, fileData);
    this.fileData = fileData;
    this.oldName = oldName;
    this.newName = newName;
  }

  async execute() {
    await this.fileData.rename(this.newName);
  }

  async undo() {
    await this.fileData.rename(this.oldName);
    // SmartFile.rename 内部已重建 blobUrl + 清 md5,Vue 响应式自动更新
  }

  getDescription() {
    return `重命名:${this.oldName} → ${this.newName}`;
  }
}

export class FileMoveOperation extends Operation {
  constructor(fileData, targetFolder) {
    super(OperationType.FILE_MOVE, fileData);
    this.fileData = fileData;
    if (!fileData.parent)
      throw new Error('文件缺少父文件夹引用');
    this.sourceFolder = fileData.parent;
    this.targetFolder = targetFolder;
  }

  async execute() {
    await this.fileData.move(this.targetFolder);
  }

  async undo() {
    if (!this.sourceFolder)
      throw new Error('源文件夹引用丢失');
    await this.fileData.move(this.sourceFolder);
  }

  getDescription() {
    return `移动文件:${this.fileData.name}`;
  }
}
