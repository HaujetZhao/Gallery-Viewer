import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { kvSet } from './db';
import { clearScan, loadScan, saveFolderRecord } from './scanCache';

// mock GalleryDB 的 KV 函数;按 key 存值(忽略 storeName)。store 跨用例共享,beforeEach 清空。
const store = new Map();
vi.mock('./db', () => ({
  kvSet: vi.fn((_storeName, k, v) => {
    store.set(k, v);
    return Promise.resolve();
  }),
  kvGetByPrefix: vi.fn((_storeName, prefix) => {
    const out = [];
    for (const [k, v] of store) {
      if (k.startsWith(prefix))
        out.push({ key: k, value: v });
    }
    return Promise.resolve(out);
  }),
  kvDelByPrefix: vi.fn((_storeName, prefix) => {
    for (const k of [...store.keys()]) {
      if (k.startsWith(prefix))
        store.delete(k);
    }
    return Promise.resolve();
  }),
}));

const SCANS_STORE = CONFIG.DATABASE.STORES.SCANS;

function fakeFolder(path) {
  return {
    path,
    name: path.split('/').pop(),
    handle: {},
    expanded: false,
    files: [],
    subFolders: [],
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('scanCache per-folder', () => {
  it('saveFolderRecord → loadScan 返 Map(path → record)', async () => {
    await saveFolderRecord('rid', fakeFolder('root/sub'));
    const map = await loadScan('rid');
    expect(map.get('root/sub')).toMatchObject({ path: 'root/sub', name: 'sub' });
  });

  it('loadScan 只取该 rootId 的 record(跨根隔离)', async () => {
    await saveFolderRecord('r1', fakeFolder('a/x'));
    await saveFolderRecord('r2', fakeFolder('a/x')); // 同 path 不同根
    const m1 = await loadScan('r1');
    const m2 = await loadScan('r2');
    expect(m1.size).toBe(1);
    expect(m2.size).toBe(1);
  });

  it('clearScan 只清该根 record(不动其他根)', async () => {
    await saveFolderRecord('r1', fakeFolder('a'));
    await saveFolderRecord('r1', fakeFolder('a/b'));
    await saveFolderRecord('r2', fakeFolder('a'));
    await clearScan('r1');
    expect((await loadScan('r1')).size).toBe(0);
    expect((await loadScan('r2')).size).toBe(1);
  });

  it('key 格式 rootId::path(rootId 防跨库同名覆盖)', async () => {
    await saveFolderRecord('r3', fakeFolder('a/b'));
    expect(kvSet).toHaveBeenCalledWith(SCANS_STORE, 'r3::a/b', expect.any(Object));
  });
});
