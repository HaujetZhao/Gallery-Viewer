import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { cancelPendingPersist, flushPendingPersist, persistIfDirty, schedulePersist } from './persistence';
import { saveScan } from './scanCache';

vi.mock('./scanCache', () => ({ saveScan: vi.fn(async () => {}), loadScan: vi.fn(async () => null), clearScan: vi.fn(async () => {}) }));
vi.mock('./handleStore', () => ({ add: vi.fn(async () => 'id'), getHandle: vi.fn(async () => null), verifyPermission: vi.fn(async () => true), loadAll: vi.fn(async () => []), update: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));

beforeEach(() => {
  setActivePinia(createPinia());
});

// P3:model 函数化后,持久化测试用 spy 隔离 SmartFolder 模块函数(真实 snapshot 行为在 smart-folder.test.js 单测)。
let folderFns;
beforeEach(async () => {
  const mod = await import('../models/SmartFolder');
  folderFns = {
    folderToSnapshot: vi.spyOn(mod, 'folderToSnapshot').mockReturnValue({}),
    countAllFiles: vi.spyOn(mod, 'countAllFiles').mockReturnValue(0),
  };
});
afterEach(() => {
  folderFns?.folderToSnapshot.mockRestore();
  folderFns?.countAllFiles.mockRestore();
});

describe('persistIfDirty', () => {
  beforeEach(() => saveScan.mockClear());

  it('非 dirty → no-op(不 saveScan / 不 folderToSnapshot)', async () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    fs.rootFolder = {};
    await persistIfDirty('r1');
    expect(saveScan).not.toHaveBeenCalled();
    expect(folderFns.folderToSnapshot).not.toHaveBeenCalled();
    expect(folderFns.countAllFiles).not.toHaveBeenCalled();
  });

  it('dirty → saveScan + countAllFiles + 清 dirty', async () => {
    const fs = useFsStore();
    fs.rootDirty = true;
    const snap = { fake: 'snap' };
    folderFns.folderToSnapshot.mockReturnValue(snap);
    fs.rootFolder = {};
    const root = useRootStore();
    root.add('r1', 'name', 0, 0);
    saveScan.mockClear();
    await persistIfDirty('r1');
    expect(saveScan).toHaveBeenCalledWith('r1', snap);
    expect(folderFns.countAllFiles).toHaveBeenCalled();
    expect(fs.rootDirty).toBe(false);
  });

  it('无 id → no-op', async () => {
    const fs = useFsStore();
    fs.rootDirty = true;
    await persistIfDirty(null);
    expect(saveScan).not.toHaveBeenCalled();
  });
});

// R3-2 + R3-3:debounced 持久化调度。用 vi.useFakeTimers 控制 schedulePersist 的 1s debounce timer。
describe('持久化调度(schedulePersist / cancelPendingPersist)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveScan.mockClear();
    cancelPendingPersist(); // 清掉上一用例残留的 timer
  });
  afterEach(() => {
    cancelPendingPersist();
    vi.useRealTimers();
  });

  it('debounce 合并:短时间内多次 schedulePersist → saveScan 只调 1 次(R3-3)', async () => {
    const fs = useFsStore();
    const rootStore = useRootStore();
    rootStore.add('r1', 'root', 0, 0);
    rootStore.setCurrent('r1');
    fs.rootDirty = true;
    fs.rootFolder = {};

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
    fs.rootFolder = {};

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
    fs.rootFolder = {};

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
    fs.rootFolder = {};

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
