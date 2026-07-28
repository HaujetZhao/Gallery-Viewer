import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { makeCancelToken } from '../utils/concurrency';
import { cancelPendingPersist, flushPendingPersist, handleFolderClick, integrateScanResult, persistIfDirty, schedulePersist, startBackgroundScan } from './filesystem';
import { saveScan } from './scanCache';

vi.mock('./scanCache', () => ({ saveScan: vi.fn(async () => {}), loadScan: vi.fn(async () => null), clearScan: vi.fn(async () => {}) }));
vi.mock('./handleStore', () => ({ add: vi.fn(async () => 'id'), getHandle: vi.fn(async () => null), verifyPermission: vi.fn(async () => true), loadAll: vi.fn(async () => []), update: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));

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

// R3-2 + R3-3:debounced 持久化调度 + handleFolderClick 不阻塞。
// 用 vi.useFakeTimers 控制 schedulePersist 的 1s debounce timer。
describe('持久化调度(schedulePersist / cancelPendingPersist)与点击不阻塞', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveScan.mockClear();
    cancelPendingPersist(); // 清掉上一用例残留的 timer
  });
  afterEach(() => {
    cancelPendingPersist();
    vi.useRealTimers();
  });

  it('handleFolderClick 命中变更:loadFolder 先返回,saveScan 推进 timer 后才调(R3-2 不阻塞)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = false;
    fs.rootFolder = { toSnapshot: () => ({}), getAllFiles: () => [] };

    // 假 folder:validate=true,scan 返回 newFiles 使 dirty=true,enrich/loadFolder 立即 resolve。
    const folder = {
      name: 'sub',
      files: [],
      subFolders: [],
      path: 'root/sub',
      validate: vi.fn(async () => true),
      enrich: vi.fn(async () => {}),
    };
    // scanFolder 是 SmartFolder 模块导出,这里直接 mock 模块拿结果。
    const smartFolderMod = await import('../models/SmartFolder');
    vi.spyOn(smartFolderMod, 'scanFolder').mockResolvedValue({
      files: [],
      subFolders: [],
      newFiles: [{}],
      newSubFolders: [],
      removedFiles: [],
      removedFolders: [],
    });

    await handleFolderClick(folder);

    // 不推进 timer:loadFolder 已完成(点击不阻塞),saveScan 尚未触发(debounce 等待中)。
    // 注:fs.currentFolder 经 reactive 代理化,与原始 folder 引用不等,用路径断言。
    expect(fs.currentFolder.path).toBe(folder.path); // loadFolder 已设 currentFolder
    expect(saveScan).not.toHaveBeenCalled(); // debounce 未到 1s
    expect(fs.rootDirty).toBe(true); // dirty 仍在(尚未持久化)

    // 推进 1s:debounced persist 触发。
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveScan).toHaveBeenCalledTimes(1);
    expect(fs.rootDirty).toBe(false); // 持久化后清 dirty

    smartFolderMod.scanFolder.mockRestore();
  });

  it('debounce 合并:短时间内多次 schedulePersist → saveScan 只调 1 次(R3-3)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = true;
    fs.rootFolder = { toSnapshot: () => ({}), getAllFiles: () => [] };

    schedulePersist('r1');
    schedulePersist('r1');
    schedulePersist('r1'); // 三次连续,应合并成一次 trailing 写

    await vi.advanceTimersByTimeAsync(1000);
    expect(saveScan).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingPersist:取消后推进 timer → saveScan 不被调(切根清旧根在途写)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = true;
    fs.rootFolder = { toSnapshot: () => ({}), getAllFiles: () => [] };

    schedulePersist('r1');
    cancelPendingPersist(); // 模拟切根时清旧根 timer
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveScan).not.toHaveBeenCalled();
  });

  it('flushPendingPersist:有在途写 → 立即落盘(saveScan 调 1 次,dirty 清;切根不丢改动)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = true;
    fs.rootFolder = { toSnapshot: () => ({}), getAllFiles: () => [] };

    schedulePersist('r1');
    await flushPendingPersist(); // 模拟切根前 flush 旧根待写(不等 1s)
    expect(saveScan).toHaveBeenCalledTimes(1); // 旧根改动落盘
    expect(fs.rootDirty).toBe(false); // dirty 清(顺带治 rootDirty 串根)

    await vi.advanceTimersByTimeAsync(1000);
    expect(saveScan).toHaveBeenCalledTimes(1); // flush 已清 timer,不再二次触发
  });

  it('flushPendingPersist:无在途写 → no-op(saveScan 不调)', async () => {
    await flushPendingPersist();
    expect(saveScan).not.toHaveBeenCalled();
  });

  it('id 校验:切根后 currentRootId 变 → schedulePersist(oldId) 推进 timer 时跳过(defense in depth)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root1', 0, 0);
    rootStore.add('r2', 'root2', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = true;
    fs.rootFolder = { toSnapshot: () => ({}), getAllFiles: () => [] };

    schedulePersist('r1');
    rootStore.setCurrent('r2'); // 切根:currentRootId 不再是 r1
    await vi.advanceTimersByTimeAsync(1000);

    // 跳过(避免写错根 IDB + 误清新根 dirty)。
    expect(saveScan).not.toHaveBeenCalled();
  });

  it('schedulePersist 无 id → no-op(推进 timer 无副作用)', async () => {
    schedulePersist(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveScan).not.toHaveBeenCalled();
  });
});
