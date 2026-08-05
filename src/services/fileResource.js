// 文件资源池。
// 集中管理 SmartFile 的浏览器资源(blobUrl)。R4:size/mtime 单落 SmartFile._meta(不进池),消双数据源 stale。
//
// 设计要点:
// - acquire(file, preloaded?):懒取 File + 建 url。多次 acquire 同 file 复用(池去重)。
// - destroy(file):强制 revoke(文件从树移除/dispose 用)。R6:inflight 标记,建完即 drop。
// - peek(file):读已 acquire 的 entry(不建),SmartFile blobUrl getter 用。
// - 并发安全:acquire 同 file 用 in-flight promise 去重(共享一次 getFile + 一个 url)。
//
// R4:删 release + owners(Phase 1 无生产调用方,所有释放走 destroy;引用计数为多视图共享预留,推迟)。
//     size/mtime 移出池 → SmartFile._meta 单源(消「每条路径管 _meta↔池 同步」的双数据源)。
const pool = new Map(); // SmartFile -> entry(已建)
const inflight = new Map(); // SmartFile -> Promise<entry>(建中);并发 acquire 同 file 复用在途,根治 url 泄漏
const cancelled = new Set(); // R6:destroy 标记的 inflight file —— 建完即 drop(不 set pool),根治「文件移除时正好在 getFile」的边角 url 泄漏

function makeEntry(file) {
  return {
    url: URL.createObjectURL(file),
    file,
  };
}

function dropEntry(file, entry) {
  URL.revokeObjectURL(entry.url);
  pool.delete(file);
}

// 懒取 File + 建 url。preloaded=已 fetch 的 File(scan/undo 复用,避免重复 IO)。
// 并发安全:并发 acquire 同 file 用 in-flight promise 去重——共享一次 getFile + 一个 url,不泄漏。
export async function acquire(file, preloaded = null) {
  const existing = pool.get(file);
  if (existing)
    return existing;
  if (inflight.has(file)) {
    const entry = await inflight.get(file);
    return entry;
  }
  const p = (async () => {
    // 降级只读:SmartFile.handle 为 null,直接从 file._file 取(不 import getFile 防 fileResource↔SmartFile 循环依赖)。
    const f = preloaded ?? file._file ?? await file.handle.getFile();
    return makeEntry(f);
  })();
  inflight.set(file, p);
  try {
    const entry = await p;
    if (cancelled.has(file)) { // R6:建中 destroy 标记 → 建完即 drop(revoke url,不 set pool)
      cancelled.delete(file);
      dropEntry(file, entry);
      return entry;
    }
    pool.set(file, entry);
    return entry;
  }
  finally {
    inflight.delete(file);
    cancelled.delete(file); // finally 兜底:reject 路径(无 catch)+ destroy 在 await p 之后紧接调用的边角都会再 add,统一在此清
  }
}

// 强制释放(无视引用):文件从树移除/dispose 用。
// R6: 若此刻有 inflight(文件移除时正好在 getFile),标记 cancelled —— acquire 建完检查即 drop,根治边角泄漏。
export function destroy(file) {
  const entry = pool.get(file);
  if (entry)
    dropEntry(file, entry);
  else if (inflight.has(file))
    cancelled.add(file);
}

// 读已 acquire 的 entry(不建)。SmartFile getter 用。
export function peek(file) {
  return pool.get(file) ?? null;
}
