# Round 2 · R5:enrich 批量写 _meta(修 size/date 排序 sort 风暴)

日期:2026-07-28
状态:设计已用户认可,待转 writing-plans
前置:
- round2 总文档:[2026-07-28-架构重构-round2-精修与扫描优化.md](./2026-07-28-架构重构-round2-精修与扫描优化.md)(Part 1 B / R5)
- R1(Gallery 虚拟化)、R2+R3(扫描优化)已完成
本文档自包含。

---

## 背景与目标

消除 enrich 逐个写 `_meta` 导致的 **size/date 排序 O(N²) sort 风暴**。目标:enrich 完成后 sort computed 只重排一次(而非 N 次),size/date 排序大文件夹不再反复跳序/卡顿。

与 R1 协同:虚拟化后 displayFiles 仍读全部 files 的 size 做排序,R5 让 enrich 期间的 sort 频率从 N 降到 1。

## 现状(为什么 size/date 排序卡)

[SmartFolder.enrich](../../../src/models/SmartFolder.js#L179) 的 `runConcurrent` worker 内,每个文件:

```js
const file = await f.handle.getFile();
await acquire(f, f, file);                                    // 写池(普通 Map,不响应式)
f._meta = { size: file.size, lastModified: file.lastModified }; // 写 _meta(响应式!)
```

- `_meta` 是 SmartFile 实例字段(在 store 的 reactive files 数组里),**每次写触发 [Gallery displayFiles](../../../src/components/Gallery.vue) sort computed 重排**(读全部 `.size`,O(N log N))。
- N 文件在 `runConcurrent` 并发交错完成 → **N 次重排 = O(N²) 风暴**。
- name 排序不受影响(sort computed 不读 size);**仅 size/date 排序**触发。

> 注:`acquire` 写的是 fileResource 池(普通 Map,不响应式),不触发 sort;只有 `_meta` 写触发。这是拆分的基础。

## 设计:拆「并发 getFile」+「同步批量写 _meta」

### D1 worker 只取数据,不写 _meta
worker 内:`getFile + acquire`(池缓存 size/mtime,不响应式)+ **返回 `{ f, size, lastModified }`**(不写 _meta)。

### D2 收齐后同步批量写 _meta
`runConcurrent` 保序返回 results 后,一个**同步 for 循环**批量写 `f._meta`。Vue 把同步代码块内的多次响应式变更批成**一次 flush**(微任务边界),sort computed 只重排一次。

```js
const results = await runConcurrent(targets, async (f) => {
  if (token?.cancelled) return null;
  try {
    const file = await f.handle.getFile();
    await acquire(f, f, file);
    return { f, size: file.size, lastModified: file.lastModified };
  }
  catch (e) {
    console.warn(`enrich ${f.name} 失败:`, e);
    return null;
  }
}, { concurrency: CONFIG.PERFORMANCE.SCAN_CONCURRENCY, token });

if (token?.cancelled) return;             // 取消则不批量写(下次 enrich 补;acquire 已建 url 无害)
for (const r of results) {
  if (r) r.f._meta = { size: r.size, lastModified: r.lastModified };
}
```

### D3 cancel 语义保留
- worker 内查 token(取消则该 worker 不跑)。
- 收齐后批量写前再查 token:cancelled → 不写 _meta(保持 store 不被旧扫描改);acquire 已建的 url 无害——getter `_meta ?? peek` 兜底,size/mtime 走 peek 仍有值,_meta 下次 enrich 补。

## 落点

仅改 [SmartFolder.enrich](../../../src/models/SmartFolder.js#L179)(单函数)。`runConcurrent` worker 返回结果而非写 _meta + 收齐后同步循环写。

## 不做(YAGNI)

- 不改 acquire / fileResource 池 / `_meta` getter(那是 R4 单一数据源)。
- 不改 sort 逻辑 / displayFiles。
- 不动其他调 enrich 的地方(startBackgroundScan / rootEagerScan / handleFolderClick / refreshFolder)——它们调 `folder.enrich()`,接口不变。

## 验收

**客观(我机械核对)**:enrich 后所有 targets 的 `_meta` 已写入(size/lastModified 有值,行为不变);可临时在 displayFiles computed 内计数,确认 enrich 期间求值次数从 N → 1。

**主观(用户验)**:size/date 排序的大文件夹(几千+),enrich 期间不再反复跳序/卡顿;name 排序不受影响。

## 与其他线

- R1(虚拟化)协同:都让大文件夹更顺;独立不冲突。
- R4(_meta 单源)/ R6(边角)独立,不阻塞。
