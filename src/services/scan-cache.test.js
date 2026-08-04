import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { kvDel, kvGet, kvSet } from './db';
import { clearScan, loadScan, saveScan } from './scanCache';

// mock GalleryDB 的 KV 函数(取代原 idb-keyval);按 key 存值,忽略 storeName 参数。
vi.mock('./db', () => {
  const store = new Map();
  return {
    kvGet: vi.fn((_storeName, k) => Promise.resolve(store.get(k))),
    kvSet: vi.fn((_storeName, k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    kvDel: vi.fn((_storeName, k) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
});

const SCANS_STORE = CONFIG.DATABASE.STORES.SCANS;

describe('scanCache', () => {
  it('save → load 往返', async () => {
    const snap = { name: 'root', files: [{ name: 'a.jpg' }] };
    await saveScan('id1', snap);
    expect(await loadScan('id1')).toEqual(snap);
  });

  it('clear 后 load undefined', async () => {
    await saveScan('id2', { x: 1 });
    await clearScan('id2');
    expect(await loadScan('id2')).toBeUndefined();
  });

  it('用 scans store + key 带 scan- 前缀', async () => {
    await saveScan('id3', {});
    await loadScan('id3');
    await clearScan('id3');
    expect(kvSet).toHaveBeenCalledWith(SCANS_STORE, 'scan-id3', {});
    expect(kvGet).toHaveBeenCalledWith(SCANS_STORE, 'scan-id3');
    expect(kvDel).toHaveBeenCalledWith(SCANS_STORE, 'scan-id3');
  });
});
