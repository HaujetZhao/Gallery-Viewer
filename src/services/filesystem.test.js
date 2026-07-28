import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { makeCancelToken } from '../utils/concurrency';
vi.mock('./scanCache', () => ({ saveScan: vi.fn(async () => {}), loadScan: vi.fn(async () => null), clearScan: vi.fn(async () => {}) }));
vi.mock('./handleStore', () => ({ add: vi.fn(async () => 'id'), getHandle: vi.fn(async () => null), verifyPermission: vi.fn(async () => true), loadAll: vi.fn(async () => []), update: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));
import { saveScan } from './scanCache';
import { integrateScanResult, persistIfDirty, startBackgroundScan } from './filesystem';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';

// startBackgroundScan Phase 3 起调 integrateScanResult → useFsStore(),需要激活 Pinia。
beforeEach(() => {
  setActivePinia(createPinia());
});

// 假文件夹:Phase 3 Step 1 起 startBackgroundScan 调 scanFolder(读 handle.values())+ enrich。
// handle.values() 吐出与声明 subFolders 同名的 directory 条目 —— 信任短路命中 → 子文件夹保留(不被当 removed)。
// enrich mock(Phase 2:进入节点先 enrich 当前层)保留。
function fakeFolder(name, subFolders = []) {
  return {
    name,
    subFolders,
    files: [],
    handle: {
      name,
      values: () => makeValuesIter(subFolders.map(s => ({ kind: 'directory', name: s.name }))),
    },
    enrich: vi.fn(async () => {}),
  };
}

// 异步迭代器:吐出给定 entries(file/dir)。scanFolder 用它读 handle.values()。
function makeValuesIter(entries) {
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
}

describe('startBackgroundScan', () => {
  it('递归遍历所有子文件夹(含嵌套),每节点 enrich', async () => {
    const c = fakeFolder('c');
    const b = fakeFolder('b');
    const a = fakeFolder('a', [c]);
    const root = fakeFolder('root', [a, b]);

    await startBackgroundScan(root);

    // Phase 2:进入每个节点先 enrich 当前层(补 size/mtime)。
    // Phase 3:scanFolder 在 subFolderData(代理)上跑,无需 scan mock。
    expect(root.enrich).toHaveBeenCalled();
    expect(a.enrich).toHaveBeenCalled();
    expect(c.enrich).toHaveBeenCalled();
    expect(b.enrich).toHaveBeenCalled();
  });

  it('无 subFolders 时安全返回(undefined / 空)', async () => {
    const root = fakeFolder('root', []);
    await expect(startBackgroundScan(root)).resolves.toBeUndefined();
    await expect(startBackgroundScan(null)).resolves.toBeUndefined();
  });

  it('取消:首批在途时 cancel,超出并发上限的不再派发', async () => {
    const cap = CONFIG.PERFORMANCE.SCAN_FOLDER_CONCURRENCY;
    let resolveHold;
    const hold = new Promise((r) => {
      resolveHold = r;
    });
    const enriched = [];
    const subs = Array.from({ length: cap + 2 }, (_, i) => {
      const f = fakeFolder(`s${i}`);
      // 关卡挪到 enrich:子节点进入后 startBackgroundScan 先 enrich(在派发 scanFolder/integrate 之前)。
      // cancel 后首批 cap 个 enrich 卡 hold,超出的子节点不再派发。
      f.enrich = vi.fn(async () => {
        enriched.push(i);
        await hold;
      });
      return f;
    });
    const root = fakeFolder('root', subs);

    const token = makeCancelToken();
    const done = startBackgroundScan(root, token);
    await new Promise(r => setTimeout(r, 20)); // 让首批 cap 个启动
    token.cancel();
    resolveHold(); // 放行首批
    await done;

    expect(enriched.length).toBe(cap); // 首 cap 个启动,剩 2 因 cancel 不派发
  });
});

// integrateScanResult:增删检测置 fs.rootDirty(无增删不置)。
describe('integrateScanResult dirty', () => {
  it('有新增文件 → 置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [{}], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(true);
  });

  it('有删除文件夹 → 置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [{}] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(true);
  });

  it('无增删(trust 短路)→ 不置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(false);
  });
});

describe('persistIfDirty', () => {
  beforeEach(() => saveScan.mockClear());

  it('非 dirty → no-op(不 saveScan / 不 getAllFiles)', async () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const toSnapshot = vi.fn(() => ({}));
    const getAllFiles = vi.fn(() => []);
    fs.rootFolder = { toSnapshot, getAllFiles };
    await persistIfDirty('r1');
    expect(saveScan).not.toHaveBeenCalled();
    expect(toSnapshot).not.toHaveBeenCalled();
    expect(getAllFiles).not.toHaveBeenCalled();
  });

  it('dirty → saveScan + getAllFiles + 清 dirty', async () => {
    const fs = useFsStore();
    fs.rootDirty = true;
    const snap = { fake: 'snap' };
    const toSnapshot = vi.fn(() => snap);
    const getAllFiles = vi.fn(() => [{}, {}, {}]);
    fs.rootFolder = { toSnapshot, getAllFiles };
    const root = useRootStore();
    root.add('r1', 'name', 0, 0);
    saveScan.mockClear();
    await persistIfDirty('r1');
    expect(saveScan).toHaveBeenCalledWith('r1', snap);
    expect(getAllFiles).toHaveBeenCalled();
    expect(fs.rootDirty).toBe(false);
  });

  it('无 id → no-op', async () => {
    const fs = useFsStore();
    fs.rootDirty = true;
    await persistIfDirty(null);
    expect(saveScan).not.toHaveBeenCalled();
  });
});
