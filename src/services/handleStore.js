// 文件夹句柄持久化(File System Access handle 存 IDB,启动恢复免重选)。
// FileSystemDirectoryHandle 可结构化克隆,能直接存 IndexedDB。用 idb-keyval(轻量 KV over IDB)。
import { del, get, set } from 'idb-keyval';

const KEY = 'root-directory-handle';

// 存/清根句柄(handle 为 null 则清除)。
export async function saveRootHandle(handle) {
  if (handle)
    await set(KEY, handle);
  else await del(KEY);
}

export async function loadRootHandle() {
  return await get(KEY);
}

export async function clearRootHandle() {
  await del(KEY);
}

// 验证句柄权限:query 已 granted 则直接通过;否则 request(弹浏览器权限框,需用户手势触发)。
// 返回是否获得指定 mode 权限。
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
