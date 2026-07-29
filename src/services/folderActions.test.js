import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { makeCancelToken } from '../utils/concurrency';
import { handleFolderClick, startBackgroundScan } from './folderActions';
import { cancelPendingPersist } from './persistence';
import { saveScan } from './scanCache';

vi.mock('./scanCache', () => ({ saveScan: vi.fn(async () => {}), loadScan: vi.fn(async () => null), clearScan: vi.fn(async () => {}) }));
vi.mock('./handleStore', () => ({ add: vi.fn(async () => 'id'), getHandle: vi.fn(async () => null), verifyPermission: vi.fn(async () => true), loadAll: vi.fn(async () => []), update: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));

// startBackgroundScan Phase 3 起调 integrateScanResult → useFsStore(),需要激活 Pinia。
beforeEach(() => {
  setActivePinia(createPinia());
});

// P3:model 函数化后,folderActions 编排测试用 spy 隔离 SmartFolder 模块函数(真实 enrich/snapshot/validate 行为
// 在 smart-folder.test.js 单测)。个别测试(如 cancel)覆盖 enrichFolder 做关卡。
// handleFolderClick 用例推进 timer 后会触发 persistIfDirty → folderToSnapshot/countAllFiles,故一并 spy 避免真实跑崩。
let folderFns;
beforeEach(async () => {
  const mod = await import('../models/SmartFolder');
  folderFns = {
    enrichFolder: vi.spyOn(mod, 'enrichFolder').mockResolvedValue(),
    folderToSnapshot: vi.spyOn(mod, 'folderToSnapshot').mockReturnValue({}),
    countAllFiles: vi.spyOn(mod, 'countAllFiles').mockReturnValue(0),
    validateFolder: vi.spyOn(mod, 'validateFolder').mockResolvedValue(true),
  };
});
afterEach(() => {
  folderFns?.enrichFolder.mockRestore();
  folderFns?.folderToSnapshot.mockRestore();
  folderFns?.countAllFiles.mockRestore();
  folderFns?.validateFolder.mockRestore();
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

    // P3:enrichFolder 是模块函数,spy 断言每节点(root/a/b/c)调一次。
    expect(folderFns.enrichFolder).toHaveBeenCalledTimes(4);
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
    const root = fakeFolder('root', Array.from({ length: cap + 2 }, (_, i) => fakeFolder(`s${i}`)));
    // P3:关卡挪到 enrichFolder spy。root 立即返回(让遍历进入 subs),subs 卡 hold。
    // cancel 后首批 cap 个 enrichFolder 卡 hold,超出的子节点不再派发。
    folderFns.enrichFolder.mockImplementation(async (folder) => {
      if (folder === root)
        return;
      enriched.push(folder.name);
      await hold;
    });

    const token = makeCancelToken();
    const done = startBackgroundScan(root, token);
    await new Promise(r => setTimeout(r, 20)); // 让首批 cap 个启动
    token.cancel();
    resolveHold(); // 放行首批
    await done;

    expect(enriched.length).toBe(cap); // 首 cap 个启动,剩 2 因 cancel 不派发
  });
});

// R3-2:handleFolderClick 命中变更不阻塞——loadFolder 先返回,debounced saveScan 推进 timer 后才调。
describe('handleFolderClick', () => {
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
    fs.rootFolder = {};

    // 假 folder:validate=true,scan 返回 newFiles 使 dirty=true,enrich/loadFolder 立即 resolve。
    const folder = {
      name: 'sub',
      files: [],
      subFolders: [],
      path: 'root/sub',
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
});
