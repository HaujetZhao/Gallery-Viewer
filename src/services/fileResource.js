// 文件资源池(owner-based 引用计数)。
// 集中管理 SmartFile 的浏览器资源(blobUrl)+ 元数据(file/size/mtime),杀 URL 泄漏类 bug。
//
// 设计要点:
// - owner-based:同一物理文件的多个 SmartFile 实例各自一份池条目;handle-identity 共享是后续升级。
// - acquire(file, owner, preloaded?):懒取 File + 建 url + 缓存。多次 acquire 同 url 复用,owners 记账。
// - release(file, owner?):减一个 owner;owners 归零 → revoke + 删条目。
// - destroy(file):无视 owners 强制 revoke(文件从树移除/dispose 用)。
// - peek(file):读已 acquire 的条目(不建),SmartFile getter 用。
// - 并发安全:acquire 同 file 用 in-flight promise 去重(共享一次 getFile + 一个 url),不因并发泄漏。
//
// owner 默认 = file 自身(SmartFile 当自己的 owner,池与 SmartFile 生命周期 1:1)。
const pool = new Map(); // SmartFile -> entry(已建)
const inflight = new Map(); // SmartFile -> Promise<entry>(建中);并发 acquire 同 file 复用在途,根治 url 泄漏(enrich 后台 + 缩略图 ensureBlobUrl 并发)

function makeEntry(file) {
  return {
    url: URL.createObjectURL(file),
    file,
    size: file.size,
    mtime: file.lastModified,
    owners: new Set(),
  };
}

function dropEntry(file, entry) {
  URL.revokeObjectURL(entry.url);
  pool.delete(file);
}

// 懒取 File + 建 url + 缓存。preloaded=已 fetch 的 File(scan/undo 复用,避免重复 IO)。
// owner=引用身份,默认 file 自身;多次 acquire 复用同一 url,owners 记账。
//
// 并发安全:并发 acquire 同一 file 用 in-flight promise 去重——共享一次 getFile + 一个 url,不泄漏。
// (Phase 2 场景:enrich 后台并发 getFile + 缩略图进视口 ensureBlobUrl,可能同时 acquire 同一 file。)
export async function acquire(file, owner = file, preloaded = null) {
  const existing = pool.get(file);
  if (existing) {
    existing.owners.add(owner);
    return existing;
  }
  // 复用在途 promise(并发 acquire 同 file 共享一次 getFile + 一个 url)
  if (inflight.has(file)) {
    const entry = await inflight.get(file);
    entry.owners.add(owner);
    return entry;
  }
  const p = (async () => {
    const f = preloaded ?? await file.handle.getFile();
    return makeEntry(f);
  })();
  inflight.set(file, p);
  try {
    const entry = await p;
    pool.set(file, entry);
    entry.owners.add(owner);
    return entry;
  }
  finally {
    inflight.delete(file); // 建完(成功/失败)清在途
  }
}

// 释放一个 owner;owners 归零 → revoke + 删 entry。
// ponytail: Phase 1 无生产调用方(所有释放走 destroy);release + owners 引用计数为 Phase 2+ 多视图
// 共享同一 url 按 owner 释放预留。owners 是 Set(身份去重),非次数计数——同 owner 多次 acquire 只算一个。
export function release(file, owner = file) {
  const entry = pool.get(file);
  if (!entry)
    return;
  entry.owners.delete(owner);
  if (entry.owners.size === 0)
    dropEntry(file, entry);
}

// 强制释放(无视 owners):文件从树移除/dispose 用。
// ponytail: 若此刻有 inflight(文件移除时正好在 getFile,罕见),建完仍会 pool.set——边角泄漏一个 url,
//           不阻断(destroy 通常在文件已 acquire 完后调)。需要时再加取消语义。
export function destroy(file) {
  const entry = pool.get(file);
  if (entry)
    dropEntry(file, entry);
}

// 读已 acquire 的 entry(不建)。SmartFile getter 用。
export function peek(file) {
  return pool.get(file) ?? null;
}
