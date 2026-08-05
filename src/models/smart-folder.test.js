import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire } from '../services/fileResource';
import { _setDegraded } from '../utils/browser';
import { SmartFile } from './SmartFile';
import { detectMetaChanges, enrichFolder, findFolderByPath, foldersFromRecordMap, folderToRecord, scanFolder, SmartFolder, validateFolder } from './SmartFolder';

// integrateScanResult(service)走 markFolderDirty → 用 root store;model 测试不关心 dirty,mock 掉避免 Pinia 耦合。
vi.mock('../services/persistence', () => ({ markFolderDirty: vi.fn(), afterFolderMutation: vi.fn() }));

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

// 整树 → recordMap(遍历,每夹 folderToRecord 一条)。测试往返用;persistIfDirty 实际只写 dirty 子集。
function treeToRecordMap(folder, map = new Map()) {
  if (!folder)
    return map;
  map.set(folder.path, folderToRecord(folder));
  for (const sub of folder.subFolders)
    treeToRecordMap(sub, map);
  return map;
}

describe('smartFolder rehydrate (per-folder record)', () => {
  it('folderToRecord 序列化单夹(本夹 files + 子夹 path 引用,非递归)', () => {
    const root = buildTree();
    const rec = folderToRecord(root);
    expect(rec.path).toBe('root');
    expect(rec.name).toBe('root');
    expect(rec.expanded).toBe(false);
    expect(rec.files).toEqual([]); // 根夹无文件(buildTree 文件在 sub)
    expect(rec.subFolderPaths).toEqual(['root/sub']); // 子夹用 path 引用,不嵌套
  });

  it('folderToRecord 单夹文件序列化', () => {
    const sub = buildTree().subFolders[0];
    const rec = folderToRecord(sub);
    expect(rec.path).toBe('root/sub');
    expect(rec.files[0].name).toBe('a.jpg');
  });

  it('folderToRecord → foldersFromRecordMap 往返 + parent 接回 + expanded 恢复', () => {
    const map = treeToRecordMap(buildTree());
    expect(map.size).toBe(2); // root + sub
    const root2 = foldersFromRecordMap('root', map, null);

    expect(root2.name).toBe('root');
    expect(root2.subFolders).toHaveLength(1);
    expect(root2.subFolders[0].name).toBe('sub');
    expect(root2.subFolders[0].parent).toBe(root2);
    expect(root2.subFolders[0].files[0].name).toBe('a.jpg');
    expect(root2.subFolders[0].files[0].size).toBe(5);
    expect(root2.expanded).toBe(false);
  });

  // foldersFromRecordMap 纯函数:不写外部状态(用 externalMap 验证不偷偷写入)。
  it('foldersFromRecordMap 不写外部状态(纯函数)', () => {
    const map = treeToRecordMap(buildTree());
    const externalMap = new Map();
    const root2 = foldersFromRecordMap('root', map, null);

    expect(root2.path).toBe('root');
    expect(root2.subFolders[0].path).toBe('root/sub');
    expect(root2.subFolders[0].parent).toBe(root2);
    expect(externalMap.size).toBe(0); // 不碰外部 Map
  });

  it('foldersFromRecordMap 缺根 record 返回 null(防御)', () => {
    expect(foldersFromRecordMap('missing', new Map(), null)).toBeNull();
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
    integrateScanResult(folder, result);

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
    integrateScanResult(folder, result);
    expect(revoke).toHaveBeenCalled(); // gone 被 dispose → destroy(revoke blobUrl)
    expect(folder.files.map(f => f.name)).toEqual(['a.jpg']); // 写回代理 folder
  });
});

describe('integrateScanResult helper(service 层整合副作用)', () => {
  it('写回 folder.files/subFolders + dispose removedFiles(T06:新 sub 挂树代理化,removedFolders 自然脱离树)', async () => {
    const { integrateScanResult } = await import('../services/scanIntegration');
    const { acquire } = await import('../services/fileResource');

    // 造假 folder(普通对象够用:本测试只验写回 + dispose)
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
      subFolders: [newSub], // 新 sub 挂到 subFolders(被代理化);removedSub 不在其中 → 脱离树
      newFiles: [],
      newSubFolders: [newSub],
      removedFiles: [removedFile],
      removedFolders: [removedSub],
    };

    integrateScanResult(folder, result);

    expect(folder.files).toBe(result.files); // 写回(代理 folder 属性变更触发响应式)
    expect(folder.subFolders).toBe(result.subFolders);
    expect(folder.subFolders).toContain(newSub); // 新子目录挂到树(folder.subFolders)
    expect(folder.subFolders).not.toContain(removedSub); // 旧子目录不在新 subFolders(脱离树)
    expect(revoke).toHaveBeenCalled(); // removedFile 被 disposeFile → destroy(revoke blobUrl)
  });
});

// findFolderByPath:按 path 在 rootFolder 树里查 folder(T05 引入,T06 删 Map 后的查询路径)。
describe('findFolderByPath', () => {
  it('命中: 返回 path 对应的 folder', () => {
    const leaf = { path: 'root/sub/leaf', subFolders: [] };
    const sub = { path: 'root/sub', subFolders: [leaf] };
    const root = { path: 'root', subFolders: [sub] };
    expect(findFolderByPath(root, 'root/sub/leaf')).toBe(leaf);
    expect(findFolderByPath(root, 'root')).toBe(root);
  });

  it('未命中: 返回 null', () => {
    const root = { path: 'root', subFolders: [] };
    expect(findFolderByPath(root, 'root/none')).toBeNull();
  });

  it('空入参: 返回 null', () => {
    expect(findFolderByPath(null, 'x')).toBeNull();
    expect(findFolderByPath({ path: 'r', subFolders: [] }, '')).toBeNull();
  });
});

// T15:SmartFolder 对象行为(addFile/removeFile/toggleExpanded)锚定。
describe('smartFolder 行为(addFile/removeFile/toggleExpanded)', () => {
  it('addFile:push + 设 parent + Windows 风格 sort', () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    folder.files = [];
    const f1 = { name: 'b.jpg', parent: null };
    const f2 = { name: 'a.jpg', parent: null };
    folder.addFile(f1);
    folder.addFile(f2);
    expect(folder.files).toEqual([f2, f1]); // sorted(a < b)
    expect(f1.parent).toBe(folder);
    expect(f2.parent).toBe(folder);
  });

  it('addFile:重复不加入', () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    folder.files = [];
    const f = { name: 'a.jpg', parent: null };
    folder.addFile(f);
    folder.addFile(f);
    expect(folder.files.length).toBe(1);
  });

  it('removeFile:splice 移除', () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    const f = { name: 'a.jpg' };
    folder.files = [f];
    folder.removeFile(f);
    expect(folder.files).not.toContain(f);
  });

  it('removeFile:不存在则无副作用', () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    const f = { name: 'a.jpg' };
    folder.files = [];
    expect(() => folder.removeFile(f)).not.toThrow();
    expect(folder.files.length).toBe(0);
  });

  it('toggleExpanded:翻转', () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    folder.expanded = false;
    folder.toggleExpanded();
    expect(folder.expanded).toBe(true);
    folder.toggleExpanded();
    expect(folder.expanded).toBe(false);
  });

  // R10:三态展开循环(收起 → 单层 → 递归 → 收起)。
  it('cycleExpand:收起→单层→递归→收起 三态循环', () => {
    // root -> child(展开) -> grandchild(展开)
    const root = new SmartFolder({ handle: { name: 'root' }, parent: null });
    const child = new SmartFolder({ handle: { name: 'child' }, parent: root });
    const grand = new SmartFolder({ handle: { name: 'grand' }, parent: child });
    root.subFolders = [child];
    child.subFolders = [grand];
    root.expanded = false; // 初始:收起

    // 收起 → 单层:自己展开,后代全收
    root.cycleExpand();
    expect(root.expanded).toBe(true);
    expect(child.expanded).toBe(false);
    expect(grand.expanded).toBe(false);

    // 单层 → 递归:后代全展开
    root.cycleExpand();
    expect(root.expanded).toBe(true);
    expect(child.expanded).toBe(true);
    expect(grand.expanded).toBe(true);

    // 递归 → 收起
    root.cycleExpand();
    expect(root.expanded).toBe(false);
  });

  it('cycleExpand:叶子文件夹无后代,只在 收起↔展开 间循环', () => {
    const leaf = new SmartFolder({ handle: { name: 'leaf' }, parent: null });
    leaf.expanded = false;
    leaf.cycleExpand();
    expect(leaf.expanded).toBe(true); // 无后代 → 直接到"递归态"
    leaf.cycleExpand();
    expect(leaf.expanded).toBe(false); // 递归 → 收起
  });
});

// detectMetaChanges:读全部 getFile,size/mtime 变 → 更新 _meta + 清 md5(refreshFolder 既有内容变检测)。
describe('smartFolder detectMetaChanges', () => {
  function makeFile(getFileImpl) {
    return new SmartFile({
      handle: { name: 'a.jpg', getFile: vi.fn(getFileImpl) },
      parent: null,
    });
  }

  it('size/mtime 变 → 清 md5 + 更新 _meta', async () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    const file = makeFile(async () => ({ name: 'a.jpg', size: 200, lastModified: 99 }));
    file._meta = { size: 100, lastModified: 1 };
    file.md5 = 'oldmd5';
    folder.files = [file];

    await detectMetaChanges(folder);

    expect(file.md5).toBeNull(); // 变 → 清
    expect(file._meta).toEqual({ size: 200, lastModified: 99 }); // 更新
  });

  it('size/mtime 不变 → md5 保留', async () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    const file = makeFile(async () => ({ name: 'a.jpg', size: 100, lastModified: 1 }));
    file._meta = { size: 100, lastModified: 1 };
    file.md5 = 'keepmd5';
    folder.files = [file];

    await detectMetaChanges(folder);

    expect(file.md5).toBe('keepmd5'); // 不变 → 保留
  });

  it('_meta 缺失 → 补,不清 md5', async () => {
    const folder = new SmartFolder({ handle: { name: 'f' }, parent: null });
    const file = makeFile(async () => ({ name: 'a.jpg', size: 100, lastModified: 1 }));
    file._meta = null;
    file.md5 = 'keepmd5';
    folder.files = [file];

    await detectMetaChanges(folder);

    expect(file._meta).toEqual({ size: 100, lastModified: 1 });
    expect(file.md5).toBe('keepmd5'); // 新补 _meta 不清 md5(首次 enrich 场景)
  });
});

describe('validateFolder 降级短路', () => {
  afterEach(() => _setDegraded(false));

  it('降级只读:无真实句柄也恒合法', async () => {
    _setDegraded(true);
    const folder = new SmartFolder({ handle: null, name: 'root' });
    await expect(validateFolder(folder)).resolves.toBe(true);
  });

  it('fSA:无 handle → 非法', async () => {
    _setDegraded(false);
    const folder = new SmartFolder({ handle: null, name: 'root' });
    await expect(validateFolder(folder)).resolves.toBe(false);
  });
});
