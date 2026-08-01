import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserData, getFileMeta, getUserData, putFileMeta, putUserData } from './db';

// 极简 fake indexedDB(只够 CRUD 用,单测验证 merge 逻辑)
// 关键:tx.oncomplete 用 setTimeout(0) 延一个宏任务,确保 getReq.onsuccess(微任务)先执行 put,
// 再触发 oncomplete resolve——对齐真实 IDB 的「tx 内所有 op 完成后才 oncomplete」语义。
function fakeIDB(stores) {
  const data = {}; // storeName -> Map<key, value>
  stores.forEach((s) => {
    data[s] = new Map();
  });
  const tx = (storeNames, _mode) => {
    const storesByName = {};
    storeNames.forEach((n) => {
      storesByName[n] = {
        get: (key) => {
          const req = { result: data[n].get(key) };
          // 微任务触发 onsuccess(在 db.js 赋值 req.onsuccess 之后)
          queueMicrotask(() => req.onsuccess?.({ target: req }));
          return req;
        },
        put: (val) => {
          data[n].set(val.md5, val);
          return {};
        },
        delete: (key) => {
          data[n].delete(key);
          return {};
        },
      };
    });
    const txObj = { objectStore: name => storesByName[name] };
    // 延一个宏任务触发 oncomplete,确保 store.get().onsuccess(微任务)先跑完
    setTimeout(() => txObj.oncomplete?.());
    return txObj;
  };
  return { transaction: tx, _data: data };
}

let db;
beforeEach(() => {
  db = fakeIDB(['file-meta', 'user-data']);
});
afterEach(() => {
  vi.resetModules();
});

describe('file-meta / user-data CRUD', () => {
  it('putFileMeta 合并而非覆盖(保留其他字段)', async () => {
    await putFileMeta(db, 'm1', { duration: 10 });
    await putFileMeta(db, 'm1', { width: 1920 }); // 不应丢 duration
    const m = await getFileMeta(db, 'm1');
    expect(m).toEqual({ md5: 'm1', duration: 10, width: 1920 });
  });

  it('putUserData 读改写合并', async () => {
    await putUserData(db, 'm1', { favorite: true });
    await putUserData(db, 'm1', { note: '备注' });
    const u = await getUserData(db, 'm1');
    expect(u).toEqual({ md5: 'm1', favorite: true, note: '备注' });
  });

  it('getFileMeta 未存返回 null', async () => {
    expect(await getFileMeta(db, 'nope')).toBe(null);
  });

  it('deleteUserData 删除条目', async () => {
    await putUserData(db, 'm1', { favorite: true });
    deleteUserData(db, 'm1');
    expect(await getUserData(db, 'm1')).toBe(null);
  });
});
