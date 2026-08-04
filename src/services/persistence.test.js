import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { update as handleStoreUpdate } from './handleStore';
import { afterFolderMutation, cancelPendingPersist, flushPendingPersist, persistIfDirty } from './persistence';
import { saveFolderRecord } from './scanCache';

vi.mock('./scanCache', () => ({ saveFolderRecord: vi.fn(async () => {}), loadScan: vi.fn(async () => new Map()), clearScan: vi.fn(async () => {}) }));
vi.mock('./handleStore', () => ({ add: vi.fn(), getHandle: vi.fn(), verifyPermission: vi.fn(), loadAll: vi.fn(async () => []), update: vi.fn(async () => {}), remove: vi.fn() }));

beforeEach(() => {
  setActivePinia(createPinia());
});

// per-folder 持久化用 spy 隔离 SmartFolder(folderToRecord / countAllFiles / findFolderByPath)。
let folderFns;
beforeEach(async () => {
  const mod = await import('../models/SmartFolder');
  folderFns = {
    folderToRecord: vi.spyOn(mod, 'folderToRecord').mockReturnValue({ path: 'fake' }),
    countAllFiles: vi.spyOn(mod, 'countAllFiles').mockReturnValue(0),
    findFolderByPath: vi.spyOn(mod, 'findFolderByPath').mockReturnValue({ path: 'root/sub' }),
  };
});
afterEach(() => {
  folderFns?.folderToRecord.mockRestore();
  folderFns?.countAllFiles.mockRestore();
  folderFns?.findFolderByPath.mockRestore();
});

function setupRoot(rootId = 'r1') {
  const root = useRootStore();
  root.add(rootId, 'root', 0, 0);
  root.setCurrent(rootId);
  const fs = useFsStore();
  fs.rootFolder = {};
  return fs;
}

describe('persistIfDirty (per-folder)', () => {
  beforeEach(() => saveFolderRecord.mockClear());

  it('非 dirty → no-op(不 saveFolderRecord / 不 folderToRecord)', async () => {
    await persistIfDirty();
    expect(saveFolderRecord).not.toHaveBeenCalled();
    expect(folderFns.folderToRecord).not.toHaveBeenCalled();
    expect(folderFns.countAllFiles).not.toHaveBeenCalled();
  });

  it('afterFolderMutation 标该夹脏 → persistIfDirty 写此夹 record + 清 dirty', async () => {
    const fs = setupRoot('r1');
    const folder = { path: 'root/sub' };
    afterFolderMutation(folder);
    expect(fs.dirtyFolders.has('r1::root/sub')).toBe(true);
    await persistIfDirty();
    expect(saveFolderRecord).toHaveBeenCalledTimes(1);
    expect(saveFolderRecord).toHaveBeenCalledWith('r1', expect.any(Object));
    expect(folderFns.countAllFiles).toHaveBeenCalled();
    expect(fs.dirtyFolders.size).toBe(0);
  });

  it('同夹多次标脏 → 合并一次写(per-folder debounce)', async () => {
    setupRoot('r1');
    const folder = { path: 'root/sub' };
    afterFolderMutation(folder);
    afterFolderMutation(folder);
    afterFolderMutation(folder);
    await persistIfDirty();
    expect(saveFolderRecord).toHaveBeenCalledTimes(1);
  });

  it('不同夹各标脏 → 各写一次(写量与变更量成正比)', async () => {
    setupRoot('r1');
    afterFolderMutation({ path: 'root/a' });
    afterFolderMutation({ path: 'root/b' });
    await persistIfDirty();
    expect(saveFolderRecord).toHaveBeenCalledTimes(2);
  });

  it('非当前根的脏 key 被跳过(defense in depth)但仍清掉', async () => {
    const fs = setupRoot('r1');
    fs.dirtyFolders.add('otherRoot::root/sub'); // 切根后旧根残留(理论被 flush 清,双保险)
    await persistIfDirty();
    expect(saveFolderRecord).not.toHaveBeenCalled();
    expect(fs.dirtyFolders.size).toBe(0);
  });

  it('fileCount 未变 → 不 updateMeta(md5-only 不触发 roots 写)', async () => {
    const root = useRootStore();
    root.add('r1', 'root', 0, 0); // fileCount 0
    root.setCurrent('r1');
    useFsStore().rootFolder = {};
    handleStoreUpdate.mockClear();
    afterFolderMutation({ path: 'root/sub' });
    await persistIfDirty(); // countAllFiles spy 返回 0,与 fileCount 0 相等 → 不写 roots
    expect(handleStoreUpdate).not.toHaveBeenCalled();
  });
});

describe('持久化调度(schedulePersist / cancelPendingPersist / flushPendingPersist)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveFolderRecord.mockClear();
    cancelPendingPersist();
  });
  afterEach(() => {
    cancelPendingPersist();
    vi.useRealTimers();
  });

  it('debounce 合并:短时间内多次 afterFolderMutation → saveFolderRecord 只 1 次', async () => {
    setupRoot('r1');
    const folder = { path: 'root/sub' };
    afterFolderMutation(folder);
    afterFolderMutation(folder);
    afterFolderMutation(folder);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveFolderRecord).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingPersist:取消后推进 timer → 不写(切根清旧根在途写)', async () => {
    setupRoot('r1');
    afterFolderMutation({ path: 'root/sub' });
    cancelPendingPersist();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveFolderRecord).not.toHaveBeenCalled();
  });

  it('flushPendingPersist:有在途写 → 立即落盘 + 清 dirty(切根不丢改动)', async () => {
    const fs = setupRoot('r1');
    afterFolderMutation({ path: 'root/sub' });
    await flushPendingPersist();
    expect(saveFolderRecord).toHaveBeenCalledTimes(1);
    expect(fs.dirtyFolders.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveFolderRecord).toHaveBeenCalledTimes(1); // flush 已清 timer,不二次触发
  });

  it('flushPendingPersist:无在途写且无 dirty → no-op', async () => {
    await flushPendingPersist();
    expect(saveFolderRecord).not.toHaveBeenCalled();
  });
});
