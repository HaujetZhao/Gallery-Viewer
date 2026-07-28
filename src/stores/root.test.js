import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as handleStore from '../services/handleStore';
import { useRootStore } from './root';

vi.mock('../services/handleStore', () => ({
  loadAll: vi.fn(),
  update: vi.fn(async () => {}),
}));

beforeEach(() => {
  setActivePinia(createPinia());
  handleStore.loadAll.mockReset();
  handleStore.update.mockReset();
});

describe('rootStore', () => {
  it('loadFromHandleStore 填 roots(排除 handle)', async () => {
    handleStore.loadAll.mockResolvedValue([
      { id: '1', name: 'a', fileCount: 10, lastUsed: 100, handle: {} },
      { id: '2', name: 'b', fileCount: 20, lastUsed: 200, handle: {} },
    ]);
    const store = useRootStore();
    await store.loadFromHandleStore();
    expect(store.roots).toEqual([
      { id: '1', name: 'a', fileCount: 10, lastUsed: 100 },
      { id: '2', name: 'b', fileCount: 20, lastUsed: 200 },
    ]);
    expect(store.roots[0].handle).toBeUndefined();
  });

  it('updateMeta 更新 roots + 同步 handleStore.update', async () => {
    handleStore.loadAll.mockResolvedValue([{ id: '1', name: 'a', fileCount: 0, lastUsed: 0, handle: {} }]);
    const store = useRootStore();
    await store.loadFromHandleStore();
    await store.updateMeta('1', { fileCount: 99, lastUsed: 555 });
    expect(store.roots[0].fileCount).toBe(99);
    expect(store.roots[0].lastUsed).toBe(555);
    expect(handleStore.update).toHaveBeenCalledWith('1', { fileCount: 99, lastUsed: 555 });
  });

  it('add / setCurrent / remove(移除当前则清 currentRootId)', () => {
    const store = useRootStore();
    store.add('1', 'a', 5, 100);
    store.setCurrent('1');
    expect(store.currentRootId).toBe('1');
    store.remove('1');
    expect(store.roots).toHaveLength(0);
    expect(store.currentRootId).toBeNull();
  });
});
