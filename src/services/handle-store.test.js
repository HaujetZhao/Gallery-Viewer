import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetCache, add, getHandle, getLastUsed, loadAll, remove, update } from './handleStore';

const store = new Map();
vi.mock('idb-keyval', () => ({
  get: vi.fn(k => store.get(k)),
  set: vi.fn((k, v) => { store.set(k, v); }),
  del: vi.fn((k) => { store.delete(k); }),
}));

function makeHandle(name, sameEntry = false) {
  return { name, isSameEntry: vi.fn(async () => sameEntry) };
}

beforeEach(() => {
  store.clear();
  _resetCache();
});

describe('handleStore 多根', () => {
  it('loadAll 初始空', async () => {
    expect(await loadAll()).toEqual([]);
  });

  it('add 新 handle 追加 + 返回 {id, existed:false}', async () => {
    const { id, existed } = await add(makeHandle('a'));
    const all = await loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(id);
    expect(all[0].name).toBe('a');
    expect(all[0].fileCount).toBe(0);
    expect(existed).toBe(false);
  });

  it('add 同 handle(isSameEntry true)去重 + existed:true', async () => {
    const h = makeHandle('a', true);
    const r1 = await add(h);
    const r2 = await add(h);
    expect(r2.id).toBe(r1.id);
    expect(r2.existed).toBe(true);
    expect(await loadAll()).toHaveLength(1);
  });

  it('add 不同 handle 追加', async () => {
    await add(makeHandle('a', false));
    await add(makeHandle('b', false));
    expect(await loadAll()).toHaveLength(2);
  });

  it('remove', async () => {
    const { id } = await add(makeHandle('a'));
    await remove(id);
    expect(await loadAll()).toHaveLength(0);
  });

  it('update 元数据(持久化)', async () => {
    const { id } = await add(makeHandle('a'));
    _resetCache(); // 强制从 IDB 重读,验证持久化
    await update(id, { fileCount: 42 });
    _resetCache();
    const all = await loadAll();
    expect(all[0].fileCount).toBe(42);
  });

  it('getHandle', async () => {
    const h = makeHandle('a');
    const { id } = await add(h);
    expect(await getHandle(id)).toBe(h);
  });

  it('getLastUsed 按 lastUsed 降序', async () => {
    const h1 = makeHandle('old');
    await add(h1);
    const all = await loadAll();
    all[0].lastUsed = 100;
    const h2 = makeHandle('new');
    await add(h2); // h2 lastUsed = now(新)
    const last = await getLastUsed();
    expect(last.handle).toBe(h2);
  });

  it('getLastUsed 空列表返回 null', async () => {
    expect(await getLastUsed()).toBeNull();
  });
});
