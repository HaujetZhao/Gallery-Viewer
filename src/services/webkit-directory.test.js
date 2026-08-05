// 降级只读模式(webkitdirectory)核心逻辑测试:FileList 建树 / 单层扫描 / 目录指纹。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setDegraded } from '../utils/browser';
import {
  clearDegradedSnapshotSession,
  computeDirectoryFingerprint,
  createDegradedRootFromFileList,
  isMediaName,
  scanDegradedFolder,
  setDegradedSnapshot,
} from './webkitDirectory';

// 构造一个"webkit 文件":File + 手动 webkitRelativePath。
function makeFile(relPath, content = 'x', lastModified = 1000) {
  const f = new File([content], relPath.split('/').pop(), { lastModified });
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, enumerable: true });
  return f;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
});
afterEach(() => {
  clearDegradedSnapshotSession();
  setDegradedSnapshot(null);
  _setDegraded(false);
});

describe('isMediaName', () => {
  it('按扩展名过滤媒体类型', () => {
    expect(isMediaName('a.jpg')).toBe(true);
    expect(isMediaName('b.mp4')).toBe(true);
    expect(isMediaName('c.mp3')).toBe(true);
    expect(isMediaName('d.txt')).toBe(false);
    expect(isMediaName('e')).toBe(false);
  });
});

describe('createDegradedRootFromFileList', () => {
  const files = [
    makeFile('相册/a.jpg'),
    makeFile('相册/b.png'),
    makeFile('相册/sub/c.jpg'),
    makeFile('相册/sub/deep/d.jpg'),
    makeFile('相册/.hidden/e.jpg'), // 隐藏目录下 → 丢弃
    makeFile('相册/note.txt'), // 非媒体 → 过滤
  ];

  it('从 FileList 重建目录树(根名/子目录/深层/隐藏过滤/非媒体过滤)', () => {
    const root = createDegradedRootFromFileList(files);
    expect(root).not.toBeNull();
    expect(root.name).toBe('相册'); // 根名 = webkitRelativePath[0]
    expect(root.handle).toBeNull();
    expect(root.isVirtual).toBe(false); // 真实目录夹,非虚拟聚合

    // 根直系文件:a.jpg/b.png(note.txt 过滤,隐藏目录文件丢弃)
    const rootNames = root.files.map(f => f.name).sort();
    expect(rootNames).toEqual(['a.jpg', 'b.png']);
    // 根直系子目录:sub(.hidden 不建)
    expect(root.subFolders.map(f => f.name)).toEqual(['sub']);

    const sub = root.subFolders[0];
    expect(sub.files.map(f => f.name)).toEqual(['c.jpg']);
    expect(sub.subFolders.map(f => f.name)).toEqual(['deep']);
    expect(sub.subFolders[0].files.map(f => f.name)).toEqual(['d.jpg']);
  });

  it('holds _file + _meta(size/lastModified),不触 handle', () => {
    const root = createDegradedRootFromFileList([files[0]]);
    const f = root.files[0];
    expect(f.handle).toBeNull();
    expect(f._file).toBeInstanceOf(File);
    expect(f._meta.size).toBe(1); // 'x' 内容 1 字节
    expect(f.name).toBe('a.jpg');
  });

  it('传 md5Map 时预填 md5(目录指纹命中免重算)', () => {
    const md5Map = new Map([[files[0].webkitRelativePath, 'hash-a']]);
    const root = createDegradedRootFromFileList([files[0]], md5Map);
    expect(root.files[0].md5).toBe('hash-a');
  });

  it('空 FileList 返回 null', () => {
    expect(createDegradedRootFromFileList([])).toBeNull();
    expect(createDegradedRootFromFileList(null)).toBeNull();
  });
});

describe('scanDegradedFolder', () => {
  const files = [
    makeFile('根/a.jpg'),
    makeFile('根/b.jpg'),
    makeFile('根/sub/c.jpg'),
    makeFile('根/sub2/d.jpg'),
  ];

  beforeEach(() => setDegradedSnapshot(files));

  it('收齐根直系文件 + 子目录,不含深层文件', () => {
    const root = createDegradedRootFromFileList(files);
    const result = scanDegradedFolder(root);
    expect(result.files.map(f => f.name).sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(result.subFolders.map(f => f.name).sort()).toEqual(['sub', 'sub2']);
    // 深层 c.jpg/d.jpg 不属于根直系
    expect(result.files.some(f => f.name === 'c.jpg')).toBe(false);
  });

  it('信任短路:名字集合一致 → 零新条目,复用既有 files', () => {
    const root = createDegradedRootFromFileList(files);
    const result = scanDegradedFolder(root, { trust: true });
    expect(result.newFiles).toEqual([]);
    expect(result.newSubFolders).toEqual([]);
    expect(result.removedFiles).toEqual([]);
    expect(result.files).toBe(root.files); // trust 命中 → 直接引用缓存
  });

  it('scans 子文件夹只取该夹直系', () => {
    const root = createDegradedRootFromFileList(files);
    const sub = root.subFolders.find(f => f.name === 'sub');
    const result = scanDegradedFolder(sub);
    expect(result.files.map(f => f.name)).toEqual(['c.jpg']);
    expect(result.subFolders).toEqual([]);
  });
});

describe('computeDirectoryFingerprint', () => {
  it('同文件列表指纹一致;文件增删/改动 → 指纹变', () => {
    const a = [makeFile('根/a.jpg', 'x', 100), makeFile('根/b.jpg', 'y', 200)];
    const aCopy = [makeFile('根/a.jpg', 'x', 100), makeFile('根/b.jpg', 'y', 200)];
    expect(computeDirectoryFingerprint(a)).toBe(computeDirectoryFingerprint(aCopy));

    const withExtra = [...a, makeFile('根/c.jpg', 'z', 300)];
    expect(computeDirectoryFingerprint(withExtra)).not.toBe(computeDirectoryFingerprint(a));

    const changed = [makeFile('根/a.jpg', 'x', 100), makeFile('根/b.jpg', 'CHANGED', 200)];
    expect(computeDirectoryFingerprint(changed)).not.toBe(computeDirectoryFingerprint(a));
  });

  it('与文件顺序无关(内部排序)', () => {
    const a = [makeFile('根/a.jpg', 'x', 100), makeFile('根/b.jpg', 'y', 200)];
    const rev = [makeFile('根/b.jpg', 'y', 200), makeFile('根/a.jpg', 'x', 100)];
    expect(computeDirectoryFingerprint(a)).toBe(computeDirectoryFingerprint(rev));
  });
});
