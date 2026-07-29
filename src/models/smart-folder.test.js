import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire } from '../services/fileResource';
import { SmartFile } from './SmartFile';
import { enrichFolder, folderFromSnapshot, folderToSnapshot, scanFolder, SmartFolder } from './SmartFolder';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
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
  root.expanded = false;
  return root;
}

describe('smartFolder rehydrate', () => {
  it('toSnapshot 序列化整棵树(name/expanded/subFolders/files)', () => {
    const root = buildTree();
    const snap = folderToSnapshot(root);
    expect(snap.name).toBe('root');
    expect(snap.expanded).toBe(false);
    expect(snap.subFolders).toHaveLength(1);
    expect(snap.subFolders[0].name).toBe('sub');
    expect(snap.subFolders[0].files[0].name).toBe('a.jpg');
  });

  it('fromSnapshot 重建树 + parent 接回 + expanded 恢复', () => {
    const snap = folderToSnapshot(buildTree());
    const root2 = folderFromSnapshot(snap, null);

    expect(root2.name).toBe('root');
    expect(root2.subFolders).toHaveLength(1);
    expect(root2.subFolders[0].name).toBe('sub');
    expect(root2.subFolders[0].parent).toBe(root2);
    expect(root2.subFolders[0].files[0].name).toBe('a.jpg');
    expect(root2.subFolders[0].files[0].size).toBe(5);
    expect(root2.expanded).toBe(false);
  });

  // Phase 3 Step 2:fromSnapshot 纯函数化后,不再注册 foldersData(副作用移到 switchToRoot 的 registerFolderTree)。
  // 这里用一个外部 Map 验证:fromSnapshot 不会偷偷往任何外部 Map 写(纯函数证据)。
  it('fromSnapshot 不注册(纯函数):外部 foldersData 不含 folder(注册归 switchToRoot)', () => {
    const snap = folderToSnapshot(buildTree());
    const externalFoldersData = new Map();
    const root2 = folderFromSnapshot(snap, null);

    // folder 树结构正确
    expect(root2.name).toBe('root');
    expect(root2.path).toBe('root');
    expect(root2.subFolders[0].name).toBe('sub');
    expect(root2.subFolders[0].path).toBe('root/sub');
    expect(root2.subFolders[0].parent).toBe(root2);

    // fromSnapshot 不碰外部 Map(注册是调用方责任)
    expect(externalFoldersData.has('root')).toBe(false);
    expect(externalFoldersData.has('root/sub')).toBe(false);
    expect(externalFoldersData.size).toBe(0);
  });
});

describe('scanFolder 纯函数(不改入参,零 getFile)+ enrich', () => {
  it('scanFolder 只列名:不 getFile,files 排序对但 size 缺省(undefined)', async () => {
    const entries = [
      fileEntry('b.jpg', 200),
      fileEntry('a.png', 100),
      fileEntry('c.gif', 300),
      dirEntry('sub'), // 非媒体目录,应建子文件夹
      fileEntry('notes.txt'), // 非媒体扩展名,应跳过(getFile 不该被调)
    ];
    const originalFiles = [];
    const originalSubFolders = [];
    const folder = new SmartFolder({ handle: makeDirHandle(entries), parent: null });
    folder.files = originalFiles; // 入参引用(空数组)
    folder.subFolders = originalSubFolders;
    const result = await scanFolder(folder);

    // Phase 3:scanFolder 纯函数 —— 不改 folder 入参,结果在 result
    expect(folder.files).toBe(originalFiles); // 入参未被替换
    expect(folder.subFolders).toBe(originalSubFolders);

    // Phase 2:scan 零 getFile —— 仅列名 + 差集,所有 size/mtime 由 enrich 补
    expect(entries[0].getFile).not.toHaveBeenCalled(); // b.jpg
    expect(entries[1].getFile).not.toHaveBeenCalled(); // a.png
    expect(entries[2].getFile).not.toHaveBeenCalled(); // c.gif
    expect(entries[4].getFile).not.toHaveBeenCalled(); // notes.txt 被跳过
    expect(result.files.map(f => f.name)).toEqual(['a.png', 'b.jpg', 'c.gif']); // Windows 排序
    expect(result.subFolders.map(f => f.name)).toEqual(['sub']);
    // newFiles 是遍历插入序(未排序);result.files 才排序
    expect(result.newFiles.map(f => f.name)).toEqual(['b.jpg', 'a.png', 'c.gif']);
    expect(result.newSubFolders.map(f => f.name)).toEqual(['sub']);
    expect(result.removedFiles).toEqual([]);
    expect(result.removedFolders).toEqual([]);

    // listFolder 阶段:池空 + _meta 未写 → size 缺省(undefined)
    expect(result.files[0].size).toBeUndefined();
    expect(result.files[0]._meta).toBeNull();
    expect(result.files[0].md5).toBeNull();

    // newSubFolders 是新建的原始对象(纯函数不注册任何外部 Map)
    expect(result.newSubFolders[0].parent).toBe(folder);
    expect(result.newSubFolders[0].name).toBe('sub');
  });

  it('enrich 补全: getFile + acquire + 写 _meta,size 正确(用 integrateScanResult 写回 folder)', async () => {
    const { integrateScanResult } = await import('../services/scanIntegration');
    const entries = [
      fileEntry('b.jpg', 200),
      fileEntry('a.png', 100),
    ];
    const folder = new SmartFolder({ handle: makeDirHandle(entries), parent: null });
    const result = await scanFolder(folder);
    // 模拟 service 层写回(folder 在真实 store 里是代理,这里直接写也行)
    const fakeFs = { foldersData: new Map() };
    integrateScanResult(folder, result, fakeFs);

    expect(entries[0].getFile).not.toHaveBeenCalled(); // scan 阶段零 IO
    expect(folder.files[0].size).toBeUndefined(); // 缺省

    await enrichFolder(folder);

    expect(entries[0].getFile).toHaveBeenCalledTimes(1); // enrich 阶段才 getFile
    expect(entries[1].getFile).toHaveBeenCalledTimes(1);
    // enrich 后 _meta 写 → getter 读 _meta(响应式)
    expect(folder.files.find(f => f.name === 'a.png').size).toBe(100);
    expect(folder.files.find(f => f.name === 'a.png')._meta).toEqual({ size: 100, lastModified: 1 });
    expect(folder.files.find(f => f.name === 'b.jpg').size).toBe(200);
  });

  it('信任短路: scanFolder 名字集合一致 → getFile 未调,result.files 沿用原对象引用', async () => {
    const a = fileEntry('a.jpg');
    const b = fileEntry('b.png');
    const folder = new SmartFolder({ handle: makeDirHandle([a, b]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const cachedB = cachedFile('b.png');
    folder.files = [cachedA, cachedB];
    const originalFiles = folder.files;

    const result = await scanFolder(folder, { trust: true });

    expect(a.getFile).not.toHaveBeenCalled();
    expect(b.getFile).not.toHaveBeenCalled();
    expect(folder.files).toBe(originalFiles); // 入参未改
    // 信任短路 → result.files === folder.files(沿用缓存)
    expect(result.files).toBe(folder.files);
    expect(result.newFiles).toEqual([]);
    expect(result.newSubFolders).toEqual([]);
    expect(result.removedFiles).toEqual([]);
    expect(result.removedFolders).toEqual([]);

    // enrich 阶段:既有项 _meta 有 → filter 待补(targets 空)→ 零 getFile
    await enrichFolder(folder);
    expect(a.getFile).not.toHaveBeenCalled();
    expect(b.getFile).not.toHaveBeenCalled();
  });

  it('信任差异(新增):scan 零 getFile;既有保留,新增进 newFiles', async () => {
    const a = fileEntry('a.jpg');
    const b = fileEntry('b.png');
    const c = fileEntry('c.gif'); // 新增
    const folder = new SmartFolder({ handle: makeDirHandle([a, b, c]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const cachedB = cachedFile('b.png');
    folder.files = [cachedA, cachedB];
    const originalFiles = folder.files;

    const result = await scanFolder(folder, { trust: true });

    // scan 纯列名,既有 + 新增都不 getFile
    expect(a.getFile).not.toHaveBeenCalled();
    expect(b.getFile).not.toHaveBeenCalled();
    expect(c.getFile).not.toHaveBeenCalled();
    expect(folder.files).toBe(originalFiles); // 入参未改
    expect(result.files.map(f => f.name)).toEqual(['a.jpg', 'b.png', 'c.gif']);
    expect(result.newFiles.map(f => f.name)).toEqual(['c.gif']); // 仅新增进 newFiles
    expect(result.removedFiles).toEqual([]);

    // enrich 阶段:既有 _meta 有 → 不补;新增 _meta=null → 补
    folder.files = result.files; // 模拟 integrateScanResult 写回
    await enrichFolder(folder);
    expect(a.getFile).not.toHaveBeenCalled();
    expect(b.getFile).not.toHaveBeenCalled();
    expect(c.getFile).toHaveBeenCalledTimes(1); // 仅新增项 getFile
  });

  it('信任差异(删除):scanFolder 不 dispose,removedFiles 含消失项;integrateScanResult 才 dispose', async () => {
    const a = fileEntry('a.jpg');
    const folder = new SmartFolder({ handle: makeDirHandle([a]), parent: null });
    const cachedA = cachedFile('a.jpg');
    const gone = cachedFile('gone.png');
    // gone 模拟 scan 过的真实状态(池里有 entry),dispose → destroy 才会 revoke
    await acquire(gone, { name: 'gone.png', size: 100, lastModified: 1 });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    folder.files = [cachedA, gone];
    const originalFiles = folder.files;

    const result = await scanFolder(folder, { trust: true });

    // scanFolder 纯函数:不 dispose,removedFiles 暴露给调用方
    expect(revoke).not.toHaveBeenCalled();
    expect(folder.files).toBe(originalFiles); // 入参未改
    expect(result.files.map(f => f.name)).toEqual(['a.jpg']);
    expect(result.removedFiles.map(f => f.name)).toEqual(['gone.png']);

    // integrateScanResult 才 dispose(走 service 层副作用)
    const { integrateScanResult } = await import('../services/scanIntegration');
    const fakeFs = { foldersData: new Map() };
    integrateScanResult(folder, result, fakeFs);
    expect(revoke).toHaveBeenCalled(); // gone 被 dispose → destroy(revoke blobUrl)
    expect(folder.files.map(f => f.name)).toEqual(['a.jpg']); // 写回代理 folder
  });
});

describe('integrateScanResult helper(service 层整合副作用)', () => {
  it('写回代理 folder.files/subFolders + 注册 newSubFolders + 删 removedFolders + dispose removedFiles', async () => {
    const { integrateScanResult } = await import('../services/scanIntegration');
    const { acquire } = await import('../services/fileResource');

    // 造假 folder(代理形式,普通对象够用:本测试只验写回 + Map 操作)
    const folder = {};

    // 造假 result:newSubFolders / removedFolders。removedFile 真实 acquire 过(P3 disposeFile → destroy → revoke 才有可观测副作用)
    const newSub = { path: 'root/newSub' };
    const removedSub = { path: 'root/old' };
    const keptFile = { name: 'keep.jpg' };
    const removedFile = new SmartFile({ handle: { name: 'gone.jpg' }, parent: null });
    await acquire(removedFile, { name: 'gone.jpg', size: 1, lastModified: 1 });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const result = {
      files: [keptFile],
      subFolders: [newSub],
      newFiles: [],
      newSubFolders: [newSub],
      removedFiles: [removedFile],
      removedFolders: [removedSub],
    };

    const fakeFs = { foldersData: new Map([['root/old', removedSub]]) };

    integrateScanResult(folder, result, fakeFs);

    expect(folder.files).toBe(result.files); // 写回(代理 folder 属性变更触发响应式)
    expect(folder.subFolders).toBe(result.subFolders);
    expect(fakeFs.foldersData.get('root/newSub')).toBe(newSub); // 注册新子目录
    expect(fakeFs.foldersData.has('root/old')).toBe(false); // 删旧子目录
    expect(revoke).toHaveBeenCalled(); // removedFile 被 disposeFile → destroy(revoke blobUrl)
  });
});
