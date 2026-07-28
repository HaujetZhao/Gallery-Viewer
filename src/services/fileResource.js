// 文件资源池(owner-based 引用计数)。
// 集中管理 SmartFile 的浏览器资源(blobUrl)+ 元数据(file/size/mtime),杀 URL 泄漏类 bug。
//
// 设计要点:
// - owner-based:同一物理文件的多个 SmartFile 实例各自一份池条目;handle-identity 共享是后续升级。
// - acquire(file, owner, preloaded?):懒取 File + 建 url + 缓存。多次 acquire 同 url 复用,owners 记账。
// - release(file, owner?):减一个 owner;owners 归零 → revoke + 删条目。
// - destroy(file):无视 owners 强制 revoke(文件从树移除/dispose 用)。
// - peek(file):读已 acquire 的条目(不建),SmartFile getter 用。
//
// owner 默认 = file 自身(SmartFile 当自己的 owner,池与 SmartFile 生命周期 1:1)。
const pool = new Map(); // SmartFile -> entry

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
export async function acquire(file, owner = file, preloaded = null) {
  let entry = pool.get(file);
  if (!entry) {
    const f = preloaded ?? await file.handle.getFile();
    entry = makeEntry(f);
    pool.set(file, entry);
  }
  entry.owners.add(owner);
  return entry;
}

// 释放一个 owner;owners 归零 → revoke + 删 entry。
export function release(file, owner = file) {
  const entry = pool.get(file);
  if (!entry)
    return;
  entry.owners.delete(owner);
  if (entry.owners.size === 0)
    dropEntry(file, entry);
}

// 强制释放(无视 owners):文件从树移除/dispose 用。
export function destroy(file) {
  const entry = pool.get(file);
  if (entry)
    dropEntry(file, entry);
}

// 读已 acquire 的 entry(不建)。SmartFile getter 用。
export function peek(file) {
  return pool.get(file) ?? null;
}
