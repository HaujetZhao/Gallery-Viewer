import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire } from '../services/fileResource';
import { SmartFile } from './SmartFile';
import { SmartFolder } from './SmartFolder';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
  SmartFolder.appState = { foldersData: new Map() };
});

// 假目录句柄:values() 异步迭代 entries(file/dir)。file 项带 getFile spy。
function makeDirHandle(entries) {
  return {
    name: 'root',
    values() {
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              if (i < entries.length)
                return Promise.resolve({ value: entries[i++], done: false });
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
  };
}

function fileEntry(name, size = 100, lastModified = 1) {
  return {
    kind: 'file',
    name,
    getFile: vi.fn(async () => ({ name, size, lastModified })),
  };
}

function dirEntry(name) {
  return { kind: 'directory', name };
}

// 用既有 SmartFile 预填(模拟 scan 过的真实状态:_meta 槽兜底 + 可能 acquire 过)。
// scan 路径 acquire 后读池;fromSnapshot 重建后只 _meta;这里同步构造,先用 _meta 兜底。
function cachedFile(name, size = 100, lastModified = 1) {
  const f = new SmartFile({ handle: { name }, parent: null });
  f._meta = { size, lastModified };
  return f;
}

function buildTree() {
  const root = new SmartFolder({ handle: { name: 'root' }, parent: null });
  const sub = new SmartFolder({ handle: { name: 'sub' }, parent: root });
  root.subFolders = [sub];
  const subFile = new SmartFile({ handle: { name: 'a.jpg' }, parent: sub });
  subFile._meta = { size: 5, lastModified: 9 };
  sub.files = [subFile];
  root.scanned = true;
  sub.scanned = true;
  root.treeNode.expanded = false;
  return root;
}

describe('smartFolder rehydrate', () => {
  it('toSnapshot 序列化整棵树(name/scanned/expanded/subFolders/files)', () => {
    const root = buildTree();
    const snap = root.toSnapshot();
    expect(snap.name).toBe('root');
    expect(snap.scanned).toBe(true);
    expect(snap.expanded).toBe(false);
    expect(snap.subFolders).toHaveLength(1);
    expect(snap.subFolders[0].name).toBe('sub');
    expect(snap.subFolders[0].files[0].name).toBe('a.jpg');
  });

  it('fromSnapshot 重建树 + parent 接回 + expanded 恢复', () => {
    const snap = buildTree().toSnapshot();
    SmartFolder.appState.foldersData.clear();
    const root2 = SmartFolder.fromSnapshot(snap, null);

    expect(root2.name).toBe('root');
    expect(root2.subFolders).toHaveLength(1);
    expect(root2.subFolders[0].name).toBe('sub');
    expect(root2.subFolders[0].parent).toBe(root2);
    expect(root2.subFolders[0].files[0].name).toBe('a.jpg');
    expect(root2.subFolders[0].files[0].size).toBe(5);
    expect(root2.treeNode.expanded).toBe(false);
  });

  it('fromSnapshot 每节点注册 appState.foldersData(按 path)', () => {
    const snap = buildTree().toSnapshot();
    SmartFolder.appState.foldersData.clear();
    const root2 = SmartFolder.fromSnapshot(snap, null);
    expect(SmartFolder.appState.foldersData.get('root')).toBe(root2);
    expect(SmartFolder.appState.foldersData.get('root/sub')).toBe(root2.subFolders[0]);
  });
});

describe('smartFolder scan 并发 + 信任', () => {
  it('并发 getFile:所有媒体文件都被读 + 排序 + size 正确', async () => {
    const entries = [
      fileEntry('b.jpg', 200),
      fileEntry('a.png', 100),
      fileEntry('c.gif', 300),
      dirEntry('sub'), // 非媒体目录,应建子文件夹
      fileEntry('notes.txt'), // 非媒体扩展名,应跳过(getFile 不该被调)
    ];
    const folder = new SmartFolder({ handle: makeDirHandle(entries), parent: null });
    await folder.scan();

    expect(entries[0].getFile).toHaveBeenCalled(); // b.jpg
    expect(entries[1].getFile).toHaveBeenCalled(); // a.png
    expect(entries[2].getFile).toHaveBeenCalled(); // c.gif
    expect(entries[4].getFile).not.toHaveBeenCalled(); // notes.txt 被跳过
    expect(folder.files.map(f => f.name)).toEqual(['a.png', 'b.jpg', 'c.gif']); // Windows 排序
    expect(folder.files[0].size).toBe(100);
    expect(folder.subFolders.map(f => f.name)).toEqual(['sub']);
  });

  it('信任短路:名字集合一致 → getFile 一次都不调,对象引用不变', async () => {
    const a = fileEntry('a.jpg');
    const b = fileEntry('b.png');
    const folder = new SmartFolder({ handle: makeDirHandle([a, b]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const cachedB = cachedFile('b.png');
    folder.files = [cachedA, cachedB];
    folder.scanned = true;

    await folder.scan({ trust: true });

    expect(a.getFile).not.toHaveBeenCalled();
    expect(b.getFile).not.toHaveBeenCalled();
    expect(folder.files).toEqual([cachedA, cachedB]); // 原对象,零 IO
    expect(folder.scanned).toBe(true);
  });

  it('信任差异(新增):只对新增项 getFile,既有项信任保留', async () => {
    const a = fileEntry('a.jpg');
    const b = fileEntry('b.png');
    const c = fileEntry('c.gif'); // 新增
    const folder = new SmartFolder({ handle: makeDirHandle([a, b, c]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const cachedB = cachedFile('b.png');
    folder.files = [cachedA, cachedB];

    await folder.scan({ trust: true });

    expect(a.getFile).not.toHaveBeenCalled(); // 既有,信任
    expect(b.getFile).not.toHaveBeenCalled();
    expect(c.getFile).toHaveBeenCalledTimes(1); // 新增,取元数据
    expect(folder.files.map(f => f.name)).toEqual(['a.jpg', 'b.png', 'c.gif']);
  });

  it('信任差异(删除):消失的文件被 dispose', async () => {
    const a = fileEntry('a.jpg');
    const folder = new SmartFolder({ handle: makeDirHandle([a]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const gone = cachedFile('gone.png');
    // gone 模拟 scan 过的真实状态(池里有 entry),dispose → destroy 才会 revoke
    await acquire(gone, gone, { name: 'gone.png', size: 100, lastModified: 1 });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    folder.files = [cachedA, gone];

    await folder.scan({ trust: true });

    expect(folder.files.map(f => f.name)).toEqual(['a.jpg']);
    expect(revoke).toHaveBeenCalled(); // gone 被 dispose → destroy(revoke blobUrl)
  });

  it('非信任:既有项也 getFile 校验,size 变了就地刷新', async () => {
    const a = fileEntry('a.jpg', 999, 2); // 磁盘上 size/mtime 都变了
    const folder = new SmartFolder({ handle: makeDirHandle([a]), parent: null });
    const cachedA = cachedFile('a.jpg', 100, 1); // 缓存里是旧的
    folder.files = [cachedA];

    await folder.scan({ trust: false });

    expect(a.getFile).toHaveBeenCalledTimes(1);
    expect(cachedA.size).toBe(999); // destroy+acquire 后读池=999
  });
});
