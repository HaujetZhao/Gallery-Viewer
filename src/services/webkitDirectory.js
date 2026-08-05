// 降级只读模式(webkitdirectory):在不支持 File System Access API 的浏览器(Safari/Firefox)里,
// 用 <input type="file" webkitdirectory> 一次选整个文件夹。WebKit 把目录内容铺平成 FileList,
// 每个 File 带 webkitRelativePath(根名/子目录/…/文件名),据此纯内存重建目录树(零磁盘 IO)。
// 无持久句柄 → 不可写回、不可重扫、不可多根;缩略图/EXIF/收藏/备注仍按 md5 内容寻址复用(见 thumbnail.js)。
// 目录指纹秒开(L2.5):WebKit 一次性返回整个 FileList(含 path/size/lastModified),纯内存算目录指纹,
// 存「指纹 → 每文件 md5 快照」到 IDB;重选同目录命中指纹 → 直接填 md5,免重算。指纹 miss → 退化逐文件懒算。
import SparkMD5 from 'spark-md5';
import { FileTypes } from '../config/file-types';
import { SmartFile } from '../models/SmartFile';
import { diffEntries, SmartFolder } from '../models/SmartFolder';
import { windowsCompareStrings } from '../utils/format';
import { kvGet, kvSet } from './db';

// 当前降级根的文件快照(File[] 单例)。select 成功后由 openDegradedDirectoryPicker 灌入,供 scanDegradedFolder 过滤。
let degradedSnapshot = null;

export function setDegradedSnapshot(files) {
  degradedSnapshot = files;
}
export function getDegradedSnapshot() {
  return degradedSnapshot;
}

// 复用的隐藏 <input type="file" webkitdirectory>。调用方 click() 触发原生目录选择(用户手势)。
export function createDirectoryInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true; // 兼容 Safari/Firefox
  input.multiple = true;
  return input;
}

export function isMediaName(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0)
    return false;
  return FileTypes.isSupported(name.slice(dot + 1).toLowerCase());
}

// 目录指纹:哈希全部文件的 `path|size|lastModified`(含根名)。同目录重选 → 相同指纹;任一文件增删/改 → 指纹变。
// 纯内存零 IO(File 已带这些元数据)。
export function computeDirectoryFingerprint(files) {
  const parts = files
    .map(f => `${f.webkitRelativePath}|${f.size}|${f.lastModified}`)
    .sort();
  return SparkMD5.hash(parts.join('\n'));
}

// —— 目录指纹快照会话(L2.5):累积本会话已算的 md5,debounced 落「指纹 → {path: md5}」快照 ——
let currentFingerprint = null;
let sessionMd5 = null; // Map<path, md5> 累积器
let persistTimer = null;
const SNAPSHOT_DEBOUNCE_MS = 3000;

export function startDegradedSnapshotSession(fp) {
  currentFingerprint = fp;
  sessionMd5 = new Map();
}
export function clearDegradedSnapshotSession() {
  currentFingerprint = null;
  sessionMd5 = null;
  clearTimeout(persistTimer);
  persistTimer = null;
}
// 由 thumbnail.loadCardMetadata 算完 md5 后调用(仅降级);增量收集 + debounce 落快照。
export function collectDegradedMd5(path, md5) {
  if (!sessionMd5)
    return;
  sessionMd5.set(path, md5);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistDegradedSnapshot, SNAPSHOT_DEBOUNCE_MS);
}
async function persistDegradedSnapshot() {
  if (!currentFingerprint || !sessionMd5)
    return;
  const key = `degraded:${currentFingerprint}`;
  const prev = (await kvGet('scans', key)) || {};
  const files = { ...(prev.files || {}), ...Object.fromEntries(sessionMd5) };
  await kvSet('scans', key, { files, scannedAt: Date.now() });
}

// 递归排序树(文件/子夹均按 Windows 风格名字序,与 scanFolder 差集后的排序一致)。
function sortFolderTree(folder) {
  folder.files.sort((a, b) => windowsCompareStrings(a.name, b.name));
  folder.subFolders.sort((a, b) => windowsCompareStrings(a.name, b.name));
  for (const sub of folder.subFolders)
    sortFolderTree(sub);
}

// FileList → 整棵降级树(sync,零 IO)。md5Map(path→md5)可选:目录指纹命中时预填,免重算。
export function createDegradedRootFromFileList(files, md5Map = null) {
  if (!files || !files.length)
    return null;
  const rootName = files[0].webkitRelativePath?.split('/')[0] || '文件夹';
  const root = new SmartFolder({ handle: null, name: rootName });
  // 相对路径 → 子夹 索引,建树时 O(F×depth) 找/建,避免每层对兄弟子夹线性 find(O(F×S))。
  const dirIndex = new Map();
  dirIndex.set('', root);
  for (const file of files) {
    const rel = file.webkitRelativePath || '';
    if (!rel || !isMediaName(file.name))
      continue;
    const segs = rel.split('/');
    segs.shift(); // 去掉根名
    segs.pop(); // 去掉文件名段(文件名从 file.name 取)
    // 沿父目录链用 dirIndex 找/建子夹(键 = 累积相对路径);遇到隐藏目录(. 开头)则丢弃该文件
    let dirPath = '';
    let parent = root;
    let skip = false;
    for (const dirName of segs) {
      if (!dirName || dirName.startsWith('.')) {
        skip = true;
        break;
      }
      dirPath = dirPath ? `${dirPath}/${dirName}` : dirName;
      let sub = dirIndex.get(dirPath);
      if (!sub) {
        sub = new SmartFolder({ handle: null, name: dirName, parent });
        parent.subFolders.push(sub);
        dirIndex.set(dirPath, sub);
      }
      parent = sub;
    }
    if (skip)
      continue;
    const smart = new SmartFile({ handle: null, parent, file });
    smart._meta = { size: file.size, lastModified: file.lastModified };
    smart.md5 = md5Map?.get(rel) ?? null; // 指纹命中预填 md5
    parent.files.push(smart);
  }
  sortFolderTree(root);
  return root;
}

// 单层遍历(降级):从内存快照按 folder.path 前缀过滤,收齐直系文件/子目录名 → diffEntries 差集。
// 纯函数,不碰 store、不落盘。folder 必须已在降级树里(handle 为 null)。
export function scanDegradedFolder(folder, { trust = false } = {}) {
  const snapshot = getDegradedSnapshot();
  if (!snapshot)
    return { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [] };
  const prefix = `${folder.path}/`;
  const currentFileEntries = [];
  const currentDirNames = new Set();
  for (const f of snapshot) {
    const p = f.webkitRelativePath || '';
    if (!p.startsWith(prefix))
      continue;
    const rest = p.slice(prefix.length);
    if (!rest.includes('/')) {
      if (isMediaName(f.name))
        currentFileEntries.push(f); // 直系文件
    }
    else {
      const dirName = rest.split('/')[0];
      if (dirName && !dirName.startsWith('.'))
        currentDirNames.add(dirName); // 直系子目录(去重)
    }
  }
  const currentDirEntries = [...currentDirNames].map(name => ({ name }));
  const existingFilesMap = new Map(folder.files.map(f => [f.name, f]));
  const existingFoldersMap = new Map(folder.subFolders.map(f => [f.name, f]));
  return diffEntries({
    folder,
    existingFilesMap,
    existingFoldersMap,
    currentFileEntries,
    currentDirEntries,
    trust,
    makeFile: (e) => {
      const sf = new SmartFile({ handle: null, parent: folder, file: e });
      sf._meta = { size: e.size, lastModified: e.lastModified };
      return sf;
    },
    makeFolder: e => new SmartFolder({ handle: null, name: e.name, parent: folder }),
  });
}
