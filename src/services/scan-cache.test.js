import { del, get, set } from 'idb-keyval';

import { describe, expect, it, vi } from 'vitest';
import { clearScan, loadScan, saveScan } from './scanCache';

vi.mock('idb-keyval', () => {
  const store = new Map();
  return {
    get: vi.fn(k => store.get(k)),
    set: vi.fn((k, v) => { store.set(k, v); }),
    del: vi.fn((k) => { store.delete(k); }),
  };
});

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

  it('key 带 scan- 前缀', async () => {
    await saveScan('id3', {});
    await loadScan('id3');
    await clearScan('id3');
    expect(set).toHaveBeenCalledWith('scan-id3', {});
    expect(get).toHaveBeenCalledWith('scan-id3');
    expect(del).toHaveBeenCalledWith('scan-id3');
  });
});
