// 多根文件夹句柄持久化。IDB 'roots' = [{id, handle, name, fileCount, lastUsed}]。
// 内存缓存(避免每次 IO,与 IDB 同步)。handle 可结构化克隆进 IDB。
// 启动迁移:旧单 handle(root-directory-handle)→ roots 列表首项。
import { del, get, set } from 'idb-keyval';

const ROOTS_KEY = 'roots';
const LEGACY_KEY = 'root-directory-handle'; // 旧单 handle,启动迁移用

let cache = null; // 记录数组(含 handle) | null(未加载)

async function loadRaw() {
  if (cache)
    return cache;
  let list = await get(ROOTS_KEY);
  if ((!list || list.length === 0) && await get(LEGACY_KEY)) {
    // 迁移旧单 handle
    const handle = await get(LEGACY_KEY);
    list = [{
      id: crypto.randomUUID(),
      handle,
      name: handle.name,
      fileCount: 0,
      lastUsed: Date.now(),
    }];
    await set(ROOTS_KEY, list);
    await del(LEGACY_KEY);
  }
  cache = list || [];
  return cache;
}

async function persist() {
  if (cache)
    await set(ROOTS_KEY, cache);
}

export async function loadAll() {
  return await loadRaw();
}

// 加 handle(isSameEntry 去重 + 更新 lastUsed),返回 { id, existed }(命中 existed=true,供调用方区分新/旧)。
export async function add(handle) {
  const list = await loadRaw();
  for (const item of list) {
    if (await item.handle.isSameEntry(handle)) {
      item.lastUsed = Date.now();
      await persist();
      return { id: item.id, existed: true };
    }
  }
  const id = crypto.randomUUID();
  list.push({ id, handle, name: handle.name, fileCount: 0, lastUsed: Date.now() });
  await persist();
  return { id, existed: false };
}

export async function remove(id) {
  const list = await loadRaw();
  const i = list.findIndex(it => it.id === id);
  if (i > -1) {
    list.splice(i, 1);
    await persist();
  }
}

export async function update(id, patch) {
  const list = await loadRaw();
  const item = list.find(it => it.id === id);
  if (item) {
    Object.assign(item, patch);
    await persist();
  }
}

// R1:按 id 顺序重排内存 cache + persist(顺序真源在 handleStore IDB cache)。
export async function reorder(ids) {
  const list = await loadRaw();
  const map = new Map(list.map(it => [it.id, it]));
  const next = [];
  for (const id of ids) {
    const it = map.get(id);
    if (it) {
      next.push(it);
      map.delete(id);
    }
  }
  // ponytail: ids 未覆盖的(防御,正常不会发生)保留原相对顺序追加末尾
  for (const it of map.values())
    next.push(it);
  list.length = 0;
  list.push(...next);
  await persist();
}

export async function getHandle(id) {
  const list = await loadRaw();
  return list.find(it => it.id === id)?.handle || null;
}

export async function getLastUsed() {
  const list = await loadRaw();
  if (list.length === 0)
    return null;
  const top = [...list].sort((a, b) => b.lastUsed - a.lastUsed)[0];
  return { id: top.id, handle: top.handle };
}

// 验证句柄权限:query 已 granted 则直接通过;否则 request(需用户手势)。
export async function verifyPermission(handle, mode = 'readwrite') {
  if (!handle)
    return false;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted')
    return true;
  if ((await handle.requestPermission(opts)) === 'granted')
    return true;
  return false;
}

// test 用:重置内存缓存。
export function _resetCache() {
  cache = null;
}
