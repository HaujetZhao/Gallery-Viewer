# 存储三分架构(file-meta / user-data / thumbnails)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把以 md5 索引的数据按性质分到三个 IDB objectStore——`thumbnails`(大 blob 缓存,保留)、`file-meta`(文件固有媒体属性如 duration,新)、`user-data`(用户附加 favorites+notes 聚合,新);全部懒加载(视窗与缩略图同取),废弃 favorites/notes 对 idb-keyval 的使用。

**Architecture:**
- `GalleryThumbnailDB` 升 v1→v2,onupgradeneeded 加 `file-meta`、`user-data` 两个 store(keyPath `md5`)。
- **SmartFile model 零改动**:`duration` getter 仍读 `_meta`;`_meta.duration` 改为运行时缓存——由 file-meta store 懒加载或抽到时填入。快照不再持久化 duration。
- 懒加载入口:`generateThumbnail` 内 md5 就绪后,与缩略图同流程 `get file-meta(md5)` + `get user-data(md5)`,填 `file._meta` / favorites / notes 镜像(幂等,已加载则 skip)。
- favorites/notes 镜像保留响应式 Set/Map,持久化改 user-data store(读改写聚合对象)。
- 全局"筛选收藏"(R16-a)届时用 cursor 全扫 user-data store 建临时 Set(本 plan 不实现,YAGNI)。

**Tech Stack:** Vue 3 + Pinia(setup store)、IndexedDB(手写,扩 [db.js](src/services/db.js))、Vitest(vi.mock indexedDB / idb-keyval)。

**非目标(本次不做):**
- GIF/SVG 的 md5 计算(现状 GIF/SVG 不算 md5 → 无收藏/备注;保持)。
- handleStore / scanCache 的 idb-keyval 迁移(它们按 root id 索引,非 md5 三分类范畴)。
- 旧快照 duration 字段迁移(忽略,重新抽;duration 抽取成本低)。

---

## 文件结构与职责

| 文件 | 改动 | 职责 |
|---|---|---|
| [src/services/db.js](src/services/db.js) | 改 | DB v2 + 2 store + fileMeta/userData CRUD |
| [src/services/db.test.js](src/services/db.test.js) | 新 | db CRUD 单测(mock indexedDB) |
| [src/services/userData.js](src/services/userData.js) | 新 | user-data store 的读写聚合对象 + ensureLoaded(给 favorites/notes 共用) |
| [src/services/userData.test.js](src/services/userData.test.js) | 新 | userData 单测 |
| [src/services/fileMeta.js](src/services/fileMeta.js) | 新 | file-meta store 的 get/put + ensureLoaded(填 file._meta) |
| [src/services/fileMeta.test.js](src/services/fileMeta.test.js) | 新 | fileMeta 单测 |
| [src/stores/favorites.js](src/stores/favorites.js) | 改 | 持久化改 userData;load() 移除;ensureLoaded 接入 |
| [src/stores/notes.js](src/stores/notes.js) | 改 | 同上 |
| [src/services/thumbnail.js](src/services/thumbnail.js) | 改 | md5 就绪后加载 fileMeta + userData |
| [src/services/thumbnail-strategies.js](src/services/thumbnail-strategies.js) | 改 | duration 抽到后写 fileMeta store |
| [src/models/SmartFile.js](src/models/SmartFile.js) | 改 | 快照去掉 duration 字段 |
| [src/App.vue](src/App.vue) | 改 | 移除 favorites.load/notes.load |

**关键接口约定(全 plan 一致):**
- `getFileMeta(md5)` → `{ duration?, width?, height?, bitrate? } | null`
- `putFileMeta(md5, patch)` → 读现有 → 合并 patch → put(merge,不覆盖未给字段)
- `getUserData(md5)` → `{ favorite?, note? } | null`
- `putUserData(md5, patch)` → 读改写合并
- `ensureFileMetaLoaded(file)` → 若 `file.md5` 且 `file._meta.duration == null`,getFileMeta 填 `_meta`(幂等)
- `ensureUserDataLoaded(md5)` → userData store 内部幂等加载,favorites/notes 镜像按需更新

---

## Task 1: db.js — DB v2 + file-meta/user-data store + CRUD

**Files:**
- Modify: `src/services/db.js`
- Modify: `src/config/index.js`(`DATABASE.STORES` 加两项)
- Test: `src/services/db.test.js`(新)

- [ ] **Step 1: config 加 store 名**

`src/config/index.js` 的 `DATABASE`:
```js
DATABASE: {
  NAME: 'GalleryThumbnailDB',
  VERSION: 2, // v2: 加 file-meta + user-data store
  STORES: {
    THUMBNAILS: 'thumbnails',
    FILE_META: 'file-meta',
    USER_DATA: 'user-data',
  },
},
```

- [ ] **Step 2: 写 db.test.js(失败测试)**

`src/services/db.test.js`:
```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFileMeta, getUserData, putFileMeta, putUserData } from './db';

// 极简 fake indexedDB(只够 CRUD 用,单测验证 merge 逻辑)
function fakeIDB(stores) {
  const data = {}; // storeName -> Map<key, value>
  stores.forEach((s) => { data[s] = new Map(); });
  const tx = (storeNames, mode) => ({
    objectStore: (name) => ({
      get: (key) => ({ onsuccess: null, onerror: null, result: data[name].get(key) }),
      put: (val) => { data[name].set(val.md5, val); return { oncomplete: null, onerror: null }; },
    }),
  });
  return { transaction: tx, _data: data };
}

let db;
beforeEach(() => {
  db = fakeIDB(['file-meta', 'user-data']);
});
afterEach(() => { vi.resetModules(); });

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
});
```

注:CRUD 接受 `db` 实参(便于测试注入),模块内 `getDb()` 返回模块级 db 供"无 db 实参"的调用(运行时)。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/services/db.test.js`
Expected: FAIL(函数未导出)

- [ ] **Step 4: 实现 db.js**

在 [db.js](src/services/db.js) `initDB` 的 `onupgradeneeded` 里加两个 store(保留旧 store 兼容):
```js
request.onupgradeneeded = (e) => {
  const d = e.target.result;
  if (!d.objectStoreNames.contains(STORE_NAME))
    d.createObjectStore(STORE_NAME, { keyPath: 'id' });
  if (!d.objectStoreNames.contains(CONFIG.DATABASE.STORES.FILE_META))
    d.createObjectStore(CONFIG.DATABASE.STORES.FILE_META, { keyPath: 'md5' });
  if (!d.objectStoreNames.contains(CONFIG.DATABASE.STORES.USER_DATA))
    d.createObjectStore(CONFIG.DATABASE.STORES.USER_DATA, { keyPath: 'md5' });
};
```

末尾追加 CRUD(db 实参可选,缺省用模块级 `db`):
```js
function pick(d) { return d || db; }

// file-meta:文件固有媒体属性(md5 索引,合并写)
export function getFileMeta(d, md5) {
  if (typeof d === 'string') { md5 = d; d = null; } // (db, md5) 与 (md5) 两种调用兼容
  const conn = pick(d);
  return new Promise((resolve) => {
    if (!conn) return resolve(null);
    const req = conn.transaction([CONFIG.DATABASE.STORES.FILE_META], 'readonly')
      .objectStore(CONFIG.DATABASE.STORES.FILE_META).get(md5);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = () => resolve(null);
  });
}
export function putFileMeta(d, md5, patch) {
  if (typeof d === 'string') { patch = md5; md5 = d; d = null; } // (md5, patch)
  const conn = pick(d);
  return new Promise((resolve) => {
    if (!conn) return resolve();
    const store = CONFIG.DATABASE.STORES.FILE_META;
    const tx = conn.transaction([store], 'readwrite');
    const s = tx.objectStore(store);
    const getReq = s.get(md5);
    getReq.onsuccess = () => {
      const merged = { ...(getReq.result || {}), ...patch, md5 };
      s.put(merged);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// user-data:用户附加聚合(md5 索引,合并写)
export function getUserData(d, md5) {
  if (typeof d === 'string') { md5 = d; d = null; }
  const conn = pick(d);
  return new Promise((resolve) => {
    if (!conn) return resolve(null);
    const req = conn.transaction([CONFIG.DATABASE.STORES.USER_DATA], 'readonly')
      .objectStore(CONFIG.DATABASE.STORES.USER_DATA).get(md5);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = () => resolve(null);
  });
}
export function putUserData(d, md5, patch) {
  if (typeof d === 'string') { patch = md5; md5 = d; d = null; }
  const conn = pick(d);
  return new Promise((resolve) => {
    if (!conn) return resolve();
    const store = CONFIG.DATABASE.STORES.USER_DATA;
    const tx = conn.transaction([store], 'readwrite');
    const s = tx.objectStore(store);
    const getReq = s.get(md5);
    getReq.onsuccess = () => {
      const merged = { ...(getReq.result || {}), ...patch, md5 };
      s.put(merged);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// 删除条目(setFavorite/setNote 写后若 favorite 与 note 均空 → 调此,保持 store 精简,
// 全局筛选 cursor 量级小)。实参兼容 (db, md5) / (md5) 两种调用。
export function deleteUserData(d, md5) {
  if (typeof d === 'string') { md5 = d; d = null; }
  const conn = pick(d);
  if (!conn)
    return;
  conn.transaction([CONFIG.DATABASE.STORES.USER_DATA], 'readwrite')
    .objectStore(CONFIG.DATABASE.STORES.USER_DATA).delete(md5);
}
```
(本 plan 不实现 `getAllUserData` cursor 全扫——R16-a 收藏筛选尚未做,YAGNI;需要时按 `cleanOldCache` 的 cursor 模式补即可。)

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/services/db.test.js`
Expected: PASS(3 用例)

- [ ] **Step 6: Commit**

```bash
git add src/services/db.js src/services/db.test.js src/config/index.js
git commit -m "feat(db): v2 加 file-meta + user-data store(合并写 CRUD)"
```

---

## Task 2: fileMeta service — 懒加载填 file._meta

**Files:**
- Create: `src/services/fileMeta.js`
- Test: `src/services/fileMeta.test.js`

- [ ] **Step 1: 写测试**

`src/services/fileMeta.test.js`:
```js
import { describe, expect, it, vi } from 'vitest';
import { ensureFileMetaLoaded, saveFileMeta } from './fileMeta';

vi.mock('./db', () => ({
  getFileMeta: vi.fn(),
  putFileMeta: vi.fn(),
}));
import { getFileMeta, putFileMeta } from './db';

describe('fileMeta', () => {
  it('ensureFileMetaLoaded:命中则填 _meta.duration(幂等)', async () => {
    getFileMeta.mockResolvedValue({ md5: 'm1', duration: 12.5, width: 1920 });
    const file = { md5: 'm1', _meta: { size: 100 } };
    await ensureFileMetaLoaded(file);
    expect(file._meta.duration).toBe(12.5);
    expect(file._meta.width).toBe(1920);
  });

  it('ensureFileMetaLoaded:无 md5 跳过(不抛)', async () => {
    const file = { md5: null, _meta: {} };
    await expect(ensureFileMetaLoaded(file)).resolves.toBeUndefined();
    expect(getFileMeta).not.toHaveBeenCalled();
  });

  it('ensureFileMetaLoaded:_meta.duration 已有则不重复读', async () => {
    getFileMeta.mockClear();
    const file = { md5: 'm1', _meta: { duration: 5 } };
    await ensureFileMetaLoaded(file);
    expect(getFileMeta).not.toHaveBeenCalled();
  });

  it('saveFileMeta:put + 填 _meta', async () => {
    putFileMeta.mockClear();
    const file = { md5: 'm1', _meta: {} };
    await saveFileMeta(file, { duration: 9, width: 1080 });
    expect(putFileMeta).toHaveBeenCalledWith('m1', { duration: 9, width: 1080 });
    expect(file._meta.duration).toBe(9);
    expect(file._meta.width).toBe(1080);
  });

  it('ensureFileMetaLoaded:store 无记录不报错(_meta 不变)', async () => {
    getFileMeta.mockResolvedValue(null);
    const file = { md5: 'm1', _meta: {} };
    await ensureFileMetaLoaded(file);
    expect(file._meta.duration).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/fileMeta.test.js`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现 fileMeta.js**

`src/services/fileMeta.js`:
```js
// file-meta store(md5 索引)的门面:文件固有媒体属性(duration/width/height/bitrate)。
// 懒加载——视窗触发时 ensureFileMetaLoaded 填 file._meta(与缩略图同流程,无可见延迟)。
// saveFileMeta:抽到时 put + 同步填 _meta(运行时缓存,SmartFile.duration getter 读得到)。
import { getFileMeta, putFileMeta } from './db';

// 视窗加载:若 file.md5 有且 _meta.duration 未填,查 store 填入(幂等)。
// 注意:用 _meta.duration 是否已有作为"已加载"标志——duration 是 file-meta 的主字段,
// 其存在即代表该 md5 的 file-meta 已取回(其他字段 width/height 也会一并取回)。
export async function ensureFileMetaLoaded(file) {
  if (!file?.md5)
    return;
  if (file._meta?.duration != null)
    return; // 已加载(或已抽到)
  const meta = await getFileMeta(file.md5);
  if (!meta)
    return;
  file._meta = { ...file._meta, ...meta };
  delete file._meta.md5; // md5 不进 _meta(避免冗余)
}

// 抽到媒体属性时调:put store(合并)+ 填 _meta 运行时缓存。
export async function saveFileMeta(file, patch) {
  if (!file?.md5)
    return;
  file._meta = { ...file._meta, ...patch };
  await putFileMeta(file.md5, patch);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/fileMeta.test.js`
Expected: PASS(5 用例)

- [ ] **Step 5: Commit**

```bash
git add src/services/fileMeta.js src/services/fileMeta.test.js
git commit -m "feat(fileMeta): md5 索引的文件固有属性门面(懒加载填 _meta)"
```

---

## Task 3: thumbnail-strategies — duration 抽到后写 file-meta store

**Files:**
- Modify: `src/services/thumbnail-strategies.js:179-184`(video onLoadedMetadata)
- Modify: `src/services/thumbnail-strategies.js:237-239`(audio generateThumbnail)
- Modify: `src/services/thumbnail-strategies.js:330-333`(extractAudioDuration onMeta)

- [ ] **Step 1: video onLoadedMetadata 改写 file-meta**

[thumbnail-strategies.js:179](src/services/thumbnail-strategies.js#L179) `onLoadedMetadata`,把直接写 `_meta` 改为 saveFileMeta:
```js
async function onLoadedMetadata() {
  // R11→file-meta:duration 进 md5 索引的 file-meta store(跨副本共享);_meta 作运行时缓存。
  if (Number.isFinite(video.duration) && fileData._meta?.duration == null) {
    const { saveFileMeta } = await import('./fileMeta');
    await saveFileMeta(fileData, { duration: video.duration, width: video.videoWidth, height: video.videoHeight });
  }
  video.currentTime = Math.min(5, video.duration / 2);
}
```
注:`onLoadedMetadata` 原 sync,改 async(事件 handler async 无碍)。用动态 import 避免循环依赖(fileMeta → db,thumbnail-strategies → fileMeta,无环)。或顶部静态 import——检查无循环后优先静态 import(实现者确认 thumbnail-strategies 与 fileMeta 间无循环:fileMeta 只 import db,thumbnail-strategies import fileMeta,无环,可静态)。

实际用静态 import 更干净,文件顶部加:
```js
import { saveFileMeta } from './fileMeta';
```
然后 onLoadedMetadata 内直接 `await saveFileMeta(...)`(不需动态 import)。**采用静态 import。**

- [ ] **Step 2: audio generateThumbnail 改**

[thumbnail-strategies.js:237-239](src/services/thumbnail-strategies.js#L237):
```js
// file-meta:音频时长进 md5 索引 store
if (fileData._meta?.duration == null && fileData.blobUrl)
  await extractAudioDuration(fileData);
```
extractAudioDuration 内部改用 saveFileMeta(下一步)。

- [ ] **Step 3: extractAudioDuration onMeta 改**

[thumbnail-strategies.js:330-333](src/services/thumbnail-strategies.js#L330) `onMeta`:
原 sync 写 `_meta`,改为收集 duration、finish 后 saveFileMeta。因为 onMeta 是事件 handler,saveFileMeta async——把 duration 存到外层变量,finish 时 await saveFileMeta。但 extractAudioDuration 是 Promise(resolve),可在 onMeta 里 fire saveFileMeta(不 await,或改 finish 流程)。

最简:onMeta 内调 saveFileMeta(不 await,fire-and-forfill 之后 resolve)。但 saveFileMeta 写 _meta + put,要保证 _meta 写完再 resolve(否则调用方可能读到旧)。

改 extractAudioDuration:
```js
function extractAudioDuration(fileData) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    let done = false;
    let timer = null;
    async function onMeta() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('error', finish);
      audio.src = '';
      if (Number.isFinite(audio.duration) && fileData._meta?.duration == null)
        await saveFileMeta(fileData, { duration: audio.duration });
      resolve();
    }
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('error', finish);
      audio.src = '';
      resolve();
    }
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error', finish);
    timer = setTimeout(finish, 4000);
    audio.src = fileData.blobUrl;
  });
}
```

- [ ] **Step 4: 手动验证(无单测,因涉及 DOM video/audio)**

Run: `npm run dev`,打开一个视频文件夹,首次抽帧后刷新页面,视频卡片 badge 仍显示时长(从 file-meta store 加载,而非快照)。
DevTools → Application → IndexedDB → GalleryThumbnailDB → file-meta,确认有 `{md5, duration, width, height}` 记录。

- [ ] **Step 5: Commit**

```bash
git add src/services/thumbnail-strategies.js
git commit -m "refactor(thumbnail-strategies): duration/dim 写 file-meta store(md5 索引)"
```

---

## Task 4: thumbnail.js — md5 就绪后加载 file-meta

**Files:**
- Modify: `src/services/thumbnail.js:44-83`(generateThumbnail)

- [ ] **Step 1: md5 就绪后 ensureFileMetaLoaded**

在 [thumbnail.js](src/services/thumbnail.js) 顶部 import:
```js
import { ensureFileMetaLoaded } from './fileMeta';
```

`generateThumbnail` 内,md5 算出后(line 57 后)、缓存查询前后都该已加载。在 `if (!file.md5) { ... }` 块之后插入:
```js
// file-meta 懒加载:md5 就绪后与缩略图同流程取回 duration/dim,填 _meta(缓存命中/未命中都需,
// 因为缓存命中分支不再抽帧,否则副本的 duration 拿不到)。幂等:_meta.duration 已有则 skip。
await ensureFileMetaLoaded(file);
```
位置:在 `if (!file.md5) {...}` 之后、`getThumbnailFromDB` 之前。

- [ ] **Step 2: 移除 R11 旧 duration 写回逻辑**

[thumbnail.js:67-68](src/services/thumbnail.js#L67) `const beforeDuration = file.duration;` 和 [line 80-81](src/services/thumbnail.js#L80) 的 `if (... duration != null && !== beforeDuration) afterTreeMutation(...)` 整段删除——duration 不再随快照持久化,无需置脏调度。改为:
```js
// 未命中:策略生成(已画到 canvas)→ 存 DB
const blob = await strategy.generateThumbnail(canvas, file, targetSize);
if (blob) {
  await saveThumbnailToDB({ /* 同原 */ });
}
return { cached: false, strategyName: strategy.name };
```

- [ ] **Step 3: 验证**

Run: `npm run dev`,打开视频文件夹。首次:badge 空 → 抽帧后显示时长。刷新:badge 直接显示(file-meta store 加载)。切到另一文件夹(同一视频副本):badge 直接显示(跨副本共享)。

- [ ] **Step 4: Commit**

```bash
git add src/services/thumbnail.js
git commit -m "refactor(thumbnail): md5 就绪后懒加载 file-meta;移除 R11 快照 duration 置脏"
```

---

## Task 5: SmartFile — 快照去掉 duration 字段

**Files:**
- Modify: `src/models/SmartFile.js:118-140`(fileToSnapshot / fileFromSnapshot)
- Test: `src/models/smart-file.test.js`(已有,补用例)

- [ ] **Step 1: 补测试**

`src/models/smart-file.test.js` 加:
```js
import { fileToSnapshot, fileFromSnapshot } from './SmartFile';
// ... 已有 describe 内加:
it('fileToSnapshot 不含 duration(已迁 file-meta store)', () => {
  const f = makeFile(); // 复用已有的 makeFile helper
  f._meta = { size: 100, lastModified: 1, duration: 9 };
  const snap = fileToSnapshot(f);
  expect(snap.duration).toBeUndefined();
});

it('fileFromSnapshot 不读 duration(旧快照字段忽略)', () => {
  const snap = { handle: {}, name: 'a.mp4', size: 1, lastModified: 1, duration: 9, md5: 'm1' };
  const f = fileFromSnapshot(snap, null);
  expect(f.duration).toBeUndefined(); // 旧 duration 字段忽略,从 file-meta store 重载
});
```
注:实现者按现有 test 文件的 makeFile helper 调整。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/models/smart-file.test.js`
Expected: FAIL(duration 仍在快照)

- [ ] **Step 3: 改 fileToSnapshot / fileFromSnapshot**

[SmartFile.js:118](src/models/SmartFile.js#L118) `fileToSnapshot` 去掉 `duration` 行:
```js
export function fileToSnapshot(file) {
  return {
    handle: file.handle,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    md5: file.md5 ?? null,
    // duration 不再随快照——迁至 file-meta store(md5 索引,跨副本共享)
  };
}
```

[fileFromSnapshot](src/models/SmartFile.js#L130) 去掉 duration:
```js
export function fileFromSnapshot(snap, parent) {
  const f = Object.create(SmartFile.prototype);
  f.handle = snap.handle;
  f.parent = parent;
  f._meta = { size: snap.size, lastModified: snap.lastModified }; // duration 不从快照恢复(从 file-meta store 懒加载)
  f.md5 = snap.md5 ?? null;
  return f;
}
```

[SmartFile.js:36-39](src/models/SmartFile.js#L36) `duration` getter 注释更新:
```js
// 视频时长。_meta.duration 作运行时缓存——由 file-meta store(md5 索引)懒加载填入,或抽帧时填入。
// 不随快照持久化(跨副本共享走 file-meta store)。非视频/未加载 → undefined。
get duration() {
  return this._meta?.duration;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/models/smart-file.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/SmartFile.js src/models/smart-file.test.js
git commit -m "refactor(SmartFile): 快照不再持久化 duration(迁 file-meta store)"
```

---

## Task 6: userData service — favorites+notes 共用的读改写门面

**Files:**
- Create: `src/services/userData.js`
- Test: `src/services/userData.test.js`

- [ ] **Step 1: 写测试**

`src/services/userData.test.js`:
```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUserDataLoaded, setFavorite, setNote } from './userData';

vi.mock('./db', () => ({
  deleteUserData: vi.fn(async () => {}),
  getUserData: vi.fn(),
  putUserData: vi.fn(async () => {}),
}));
import { deleteUserData, getUserData, putUserData } from './db';

// userData 内部维护已加载 md5 缓存(避免重复 get);测试间清
beforeEach(() => {
  getUserData.mockReset();
  putUserData.mockReset();
});

describe('userData', () => {
  it('ensureUserDataLoaded:取回 {favorite,note} 缓存,幂等', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true, note: 'x' });
    await ensureUserDataLoaded('m1');
    await ensureUserDataLoaded('m1'); // 第二次不再 get
    expect(getUserData).toHaveBeenCalledTimes(1);
  });

  it('setFavorite:读改写(保留 note)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', note: '保留' });
    await setFavorite('m1', true);
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: '保留' });
  });

  it('setNote:读改写(保留 favorite)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true });
    await setNote('m1', '新备注');
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: '新备注' });
  });

  it('setNote 空串 + 有 favorite → 保留条目(note 字段 undefined)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true, note: '旧' });
    await setNote('m1', '   ');
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: undefined });
    expect(deleteUserData).not.toHaveBeenCalled();
  });

  it('setFavorite false 且无 note → 删条目(writeUserData 空决策)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true }); // 仅 favorite,取消后全空
    putUserData.mockClear();
    deleteUserData.mockClear();
    await setFavorite('m1', false);
    expect(deleteUserData).toHaveBeenCalledWith('m1');
    expect(putUserData).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/userData.test.js`
Expected: FAIL

- [ ] **Step 3: 实现 userData.js**

`src/services/userData.js`:
```js
// user-data store(md5 索引)门面:favorites+notes 聚合对象 {favorite?,note?}。
// 读改写合并(保留其他字段);加载结果内存缓存(幂等,避免视窗重复 get)。
// 注意:此 service 不持有响应式状态——响应式镜像在 favorites/notes store,本 service 只管持久化。
import { deleteUserData, getUserData, putUserData } from './db';

// 已加载 md5 → {favorite?,note?}(内存缓存,懒加载幂等)。store 切换/清场景由调用方处理。
const loaded = new Map();

export async function ensureUserDataLoaded(md5) {
  if (!md5) return null;
  if (loaded.has(md5)) return loaded.get(md5);
  const data = await getUserData(md5);
  const normalized = data || {};
  loaded.set(md5, normalized);
  return normalized;
}

// 给 favorites/notes store 用:取已加载缓存(同步,ensureUserDataLoaded 后才有)。
export function peekUserData(md5) {
  return loaded.get(md5) || null;
}

export async function setFavorite(md5, favorite) {
  if (!md5) return;
  const cur = await ensureUserDataLoaded(md5);
  const next = { ...cur, favorite: favorite || undefined }; // false → undefined
  loaded.set(md5, next);
  await writeUserData(md5, next);
}

export async function setNote(md5, text) {
  if (!md5) return;
  const trimmed = (text ?? '').trim();
  const cur = await ensureUserDataLoaded(md5);
  const next = { ...cur, note: trimmed || undefined }; // 空串不存
  loaded.set(md5, next);
  await writeUserData(md5, next);
}

// 写入决策:favorite 与 note 均空 → 删条目(保持 user-data store 精简——
// 用户数据量小,R16-a 全局筛选 cursor 量级才小);否则 putUserData(只存 truthy 字段)。
async function writeUserData(md5, next) {
  const { favorite, note } = next;
  if (!favorite && !note) {
    loaded.delete(md5);
    await deleteUserData(md5);
  }
  else {
    await putUserData(md5, { favorite, note });
  }
}

// 清缓存(切换场景预留,本 plan 暂不主动调)
export function invalidateUserData(md5) {
  if (md5) loaded.delete(md5);
  else loaded.clear();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/userData.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/userData.js src/services/userData.test.js
git commit -m "feat(userData): md5 聚合的 favorites+notes 持久化门面"
```

---

## Task 7: favorites store — 迁到 userData + 懒加载

**Files:**
- Modify: `src/stores/favorites.js`
- Modify: `src/services/thumbnail.js`(加载 userData——Task 8 合并做,此处只改 store)

- [ ] **Step 1: 重写 favorites.js**

`src/stores/favorites.js`:
```js
// 收藏集合(md5 为 key)。持久化走 user-data store({favorite,note} 聚合,md5 索引)。
// 懒加载:视窗触发时 ensureUserDataLoaded 填镜像(与缩略图同流程)。Set 为响应式镜像(整体替换触发)。
// 全局"筛选收藏"(R16-a)届时用 cursor 全扫 user-data store(本 plan 不实现)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ensureUserDataLoaded, peekUserData, setFavorite } from '../services/userData';

export const useFavoritesStore = defineStore('favorites', () => {
  const favSet = ref(new Set());

  // 由 thumbnail.js 视窗加载调:userData 取回后,若 favorite 则入 Set。
  // 幂等:已 in Set 不重复。整体替换触发响应式(.has 不追踪)。
  async function ensureLoaded(md5) {
    if (!md5 || favSet.value.has(md5))
      return;
    const data = await ensureUserDataLoaded(md5);
    if (data?.favorite && !favSet.value.has(md5)) {
      const next = new Set(favSet.value);
      next.add(md5);
      favSet.value = next;
    }
  }

  function isFavorite(md5) {
    return !!md5 && favSet.value.has(md5);
  }

  async function toggle(md5) {
    if (!md5) return;
    const next = new Set(favSet.value);
    const favorited = next.has(md5);
    if (favorited) next.delete(md5);
    else next.add(md5);
    favSet.value = next;
    await setFavorite(md5, !favorited);
  }

  return { favSet, ensureLoaded, isFavorite, toggle };
});
```

- [ ] **Step 2: 跑现有测试(若有 favorites.test.js)**

Run: `npx vitest run src/stores` 
Expected: 无回归(favorites 行为不变:isFavorite/toggle 同步语义)。

- [ ] **Step 3: Commit**

```bash
git add src/stores/favorites.js
git commit -m "refactor(favorites): 迁 user-data store(md5 聚合)+ 懒加载"
```

---

## Task 8: notes store — 迁到 userData + 懒加载

**Files:**
- Modify: `src/stores/notes.js`

- [ ] **Step 1: 重写 notes.js**

`src/stores/notes.js`:
```js
// 备注集合(md5 → 多行文本)。持久化走 user-data store({favorite,note} 聚合)。
// 懒加载:视窗触发 ensureUserDataLoaded 填镜像。Map 为响应式镜像(整体替换触发)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ensureUserDataLoaded, setNote } from '../services/userData';

export const useNotesStore = defineStore('notes', () => {
  const notesMap = ref(new Map());

  async function ensureLoaded(md5) {
    if (!md5 || notesMap.value.has(md5))
      return;
    const data = await ensureUserDataLoaded(md5);
    const note = data?.note;
    if (note && !notesMap.value.has(md5)) {
      const next = new Map(notesMap.value);
      next.set(md5, note);
      notesMap.value = next;
    }
    else if (!note && !notesMap.value.has(md5)) {
      // 标记"已加载但无备注"(避免重复 get)——用 Map 不便存负值,依赖 ensureUserDataLoaded 内部缓存即可
    }
  }

  function getNote(md5) {
    return (md5 && notesMap.value.get(md5)) || '';
  }

  function has(md5) {
    return !!md5 && notesMap.value.has(md5);
  }

  async function setNoteWrapper(md5, text) {
    if (!md5) return;
    const next = new Map(notesMap.value);
    const trimmed = (text ?? '').trim();
    if (trimmed) next.set(md5, text);
    else next.delete(md5);
    notesMap.value = next;
    await setNote(md5, text);
  }

  return { notesMap, ensureLoaded, getNote, has, setNote: setNoteWrapper };
});
```
注:notes.ensureLoaded 的"已加载无备注"幂等性,依赖 userData.ensureUserDataLoaded 内部 `loaded` Map 缓存(避免重复 get)——notesMap 不存负值,二次 ensureLoaded 时 userData 缓存命中 skip,favorites 同理。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run src/stores`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/notes.js
git commit -m "refactor(notes): 迁 user-data store(md5 聚合)+ 懒加载"
```

---

## Task 9: thumbnail.js — md5 就绪后加载 userData(填 favorites/notes 镜像)

**Files:**
- Modify: `src/services/thumbnail.js`

- [ ] **Step 1: 加载 userData**

[thumbnail.js](src/services/thumbnail.js) 在 Task 4 插入的 `ensureFileMetaLoaded(file)` 之后,加:
```js
// userData 懒加载:与 file-meta 同流程,填 favorites/notes 镜像(卡片爱心/备注即时显示)。
// 仅 image/video/audio(GIF/SVG 无 md5,现状不支持收藏/备注)。
const { useFavoritesStore } = await import('../stores/favorites');
const { useNotesStore } = await import('../stores/notes');
await Promise.all([
  useFavoritesStore().ensureLoaded(file.md5),
  useNotesStore().ensureLoaded(file.md5),
]);
```
注:用动态 import 避免 service → store 循环(service 层一般不直接 import store,但 thumbnail.js 已 import useFsStore/useRootStore 等 store,故可直接静态 import)。**确认 thumbnail.js 已 import 多个 store,采用静态 import**——顶部加 `import { useFavoritesStore } from '../stores/favorites';` `import { useNotesStore } from '../stores/notes';`,调用处直接用。

修正后:
```js
await Promise.all([
  useFavoritesStore().ensureLoaded(file.md5),
  useNotesStore().ensureLoaded(file.md5),
]);
```

- [ ] **Step 2: 移除 App.vue 的 favorites.load/notes.load**

[App.vue:81-82](src/App.vue#L81):
```js
// favorites.load(); // 已迁懒加载(视窗与缩略图同取)
// notes.load();
```
删除这两行(及注释)。确认 favorites/notes store 不再 export load(如 export 了,移除引用)。

- [ ] **Step 3: 验证**

Run: `npm run dev`:
1. 收藏一张图(L 键)→ 刷新 → 爱心仍在(视窗加载 userData 填镜像)。
2. 加备注 → 刷新 → 备注 hover 胶囊仍在。
3. DevTools → Application → IndexedDB → user-data,确认 `{md5, favorite:true}` 或 `{md5, note:'...'}` 记录。
4. 复制同一文件到另一文件夹 → 副本的爱心/备注直接显示(跨副本共享)。

- [ ] **Step 4: Commit**

```bash
git add src/services/thumbnail.js src/App.vue
git commit -m "refactor(loading): userData 懒加载接入视窗;移除启动 favorites/notes load"
```

---

## Task 10: 全量验证 + 清理

**Files:**
- 无新改动,验证 + 文档

- [ ] **Step 1: 跑全部测试**

Run: `npx vitest run`
Expected: 全 PASS(含 db/fileMeta/userData/smart-file/gallery-layout 等)

- [ ] **Step 2: lint**

Run: `npm run lint`
Expected: 0 error

- [ ] **Step 3: 浏览器全流程验收(用户本人)**

清单:
- [ ] 视频/音频 badge 时长:首次抽帧后显示,刷新/切根/跨文件夹副本都即时(无重抽)
- [ ] 收藏爱心:收藏后刷新仍在;跨文件夹副本一致
- [ ] 备注:加/改/删备注,刷新后状态正确;空串视为无备注
- [ ] 切换卡片样式(hover/always/detail)三种,badge/爱心/备注显示正常
- [ ] IDB 三个 store 结构正确(thumbnails / file-meta / user-data),无残留 idb-keyval 的 favorites/notes key(可手动清 keyval store)

- [ ] **Step 4: 更新文档**

在 [CLAUDE.md](CLAUDE.md) 的「关键约定」第 6 条(核心算法)补一句:
```
- md5 索引数据三分:thumbnails(blob 缓存,LRU)/ file-meta(文件固有 duration/dim)/ user-data(用户附加 favorites+notes 聚合)。均懒加载(视窗与缩略图同流程)。详见 [存储三分设计](docs/superpowers/specs/2026-08-02-存储三分架构-design.md)。
```
(若 design spec 未写,可省略链接,只更新 CLAUDE.md 约定文字。)

- [ ] **Step 5: 最终 Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 关键约定补 md5 数据三分(thumbnails/file-meta/user-data)"
```

---

## 风险与回滚

- **DB schema 升级**:v1→v2,onupgradeneeded 加 store。旧 DB(只有 thumbnails)升级后新增空 store,旧缩略图保留。若升级异常,initDB 已有 try/catch,降级到无 file-meta/user-data(功能退化但不崩)。
- **旧快照 duration 丢失**:旧快照的 duration 字段被忽略,视频时长重新从 file-meta store 加载(若之前抽过则 store 有;否则重抽)。成本:每个视频首次重抽一次 duration(轻)。用户感知:可能首次刷新后视频 badge 短暂空(重抽)。
- **GIF/SVG 收藏/备注**:现状不支持(无 md5),本 plan 不引入。若未来需要,先给 GIF/SVG 算 md5。
- **回滚**:每个 Task 独立 commit,可逐步 revert。最坏 revert 到本 plan 前(commit 281b73f 后)。
