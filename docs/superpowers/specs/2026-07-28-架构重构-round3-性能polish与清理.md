# Round 3:性能 polish 与清理(Round 2 终点审查 + 候选)

日期:2026-07-28
状态:分析完成,待新窗口实施(本文档即实施基线)
前置:
- Round 2 实现(已完成):[2026-07-28-架构重构-round2-实现记录.md](./2026-07-28-架构重构-round2-实现记录.md)
- Round 2 规划:[2026-07-28-架构重构-round2-精修与扫描优化.md](./2026-07-28-架构重构-round2-精修与扫描优化.md)

本文档自包含。新窗口先读本文件即可动手。

---

## Round 2 终点结论

**成功,架构端到端干净。** R1(虚拟化)/ R2+R3(打开即信+按需校验+dirty 才持久化)/ R4-R6(_meta 单源、删死码、批量写、inflight 去泄漏)全部落地。71 测试绿、lint 干净、build 过。

**模型纯、副作用集中、资源池单一职责(`{url,file}`)、响应式陷阱从结构消除。** 架构层已无债。**Round 3 纯是性能 polish + 清理,非架构改动。** 是否继续取决于体感(见下)。

---

## Part 1:Round 2 遗留(按用户相关度排序)

### P1. 持久化仍是**整树粒度**——W2/W3 只解决一半

[src/services/filesystem.js `persistIfDirty`](../../src/services/filesystem.js):`rootDirty` 是单布尔;一旦脏(哪怕深层一个文件改名)→ `root.toSnapshot()` **序列化整棵树** + `root.getAllFiles()` **全树计数** + IDB 写整个快照。

- 无变更:零写(Round 2 "砍 W2/W3" 仅此成立)。
- **有变更:万图树改名一个文件 → 全树序列化 + 大 IDB 写。写放大没解决。**

### P2. 缩略图"首开转圈"——**当前最可能被感知的"卡"**(Round 2 已搁置到后续待办)

切到大文件夹**首次**打开,可见卡片逐个出图(转圈)。瓶颈:
- 缩略图并发 **`THUMBNAIL_QUEUE_SIZE = 4`**([config/index.js](../../src/config/index.js))。
- 每图 `calculateMD5`(读前 2MB)做缓存键([thumbnail.js](../../src/services/thumbnail.js))。
- `Image + onload + drawImage` 解码([thumbnail-strategies.js](../../src/services/thumbnail-strategies.js))。

**澄清**:repeat-open **不受影响**(md5 在 snapshot → IDB 命中 → 零 IO)。转圈主要是首开大文件夹。"万图不卡"剩下的最后一块。

### P3. handleFolderClick **在"命中变更"时阻塞显示**

[src/services/filesystem.js:337-341](../../src/services/filesystem.js):
```js
const result = await scanFolder(folder, { trust: true });
integrateScanResult(folder, result, fs);
await folder.enrich();
await persistIfDirty(rootStore.currentRootId);  // ← 阻塞
await loadFolder(folder);                         // ← 显示在持久化之后
```
点击的文件夹若发现新文件(dirty=true),用户**等全树序列化 + IDB 写完才看到文件夹**。无变更时 dirty=false 秒过;命中变更时万图树有感知延迟。

### P4. 首次打开仍**全树后台扫**

`openFolderPicker` → `scanAndPersist` → `startBackgroundScan` 全树并发 getFile + enrich + 全量快照写。万图首开仍重(IO 密集,虽并发 32)。R2 的"按需"只惠及**重复打开**;首开建快照仍全量。

### P5. 小瑕疵(清理级)

- **过时注释**(R4 后未同步,会误导):
  - [SmartFile.js:38-40](../../src/models/SmartFile.js#L38-L40) size getter 注释仍提"`?? peek` 兜底"——R4 已删。
  - [SmartFolder.js enrich 注释](../../src/models/SmartFolder.js)(约 204 行)"getter _meta??peek 兜底"——R4 后不存在。
- **`cancelled` Set 边角**:[fileResource.js](../../src/services/fileResource.js) `acquire` 的 getFile **reject** 时,`cancelled` 里的 file 没清(漏到 finally 之外)→ 一个 Set 条目泄漏。罕见,但 R6 既为治 inflight 边角,建议顺手补(acquire catch 里 `cancelled.delete(file)`)。
- **虚拟化隐含"缩略图必方形"**:固定行高精确依赖所有缩略图 1:1。当前成立(策略皆方画布中心裁剪),但是**隐性耦合**——未来非方形缩略图策略会破布局且无断言。加注释或 assert。

## 澄清:非问题

- Gallery sort 括号正确(`((a.size ?? Infinity) - (b.size ?? Infinity)) * dir`),非 bug。
- _meta 单源后,fromSnapshot 文件 size 来自 _meta、新文件 enrich 后写 _meta,链路一致。

---

## Part 2:Round 3 优先级

| 序 | 内容 | 对应 | 收益 | 风险 |
|---|---|---|---|---|
| **R3-1** | **缩略图首开提速** | P2 | 切大文件夹首开不转圈——"万图不卡"最后一块 | 低 |
| **R3-2** | **点击不阻塞** | P3 | 命中变更时点击即时显示 | 极低 |
| **R3-3** | **增量/合并持久化** | P1 | 改名/增删不再全树写放大 | 低-中 |
| **R3-4** | **小清理** | P5 | 一致性/防误导 | 极低 |

---

### R3-1 缩略图首开提速

**目标**:首开大文件夹,可见卡片快速出图(不逐个转圈)。

**方向(独立可叠加)**:
1. **提并发**:`THUMBNAIL_QUEUE_SIZE` 4 → 8/12([config/index.js](../../src/config/index.js))。最直接;可视区卡片同时多算几张。
2. **`createImageBitmap` 替 `Image+drawImage`** 解码([thumbnail-strategies.js](../../src/services/thumbnail-strategies.js) image/video 策略):解码更快、可异步、不占主线程 onload。注意 GIF/SVG/音频封面路径不适用,保留原策略。
3. **md5 复用已读 blob**:首开时 `ensureBlobUrl` 已 getFile 出 File;md5 与解码可共享同一 blob 的前 2MB(避免二次读)。当前 `peek(file)?.file` 已复用 File 对象,确认 calculateMD5 用 `file.slice(0, 2MB)` 不触发额外 IO。
4. (可选,取舍) **md5 仅未命中时算**:当前 md5 是缓存键,首开必算。若改 `size+mtime` 当键可免 2MB 读,但**丢改名/移动后缓存命中**——不建议,md5 留着。

**验收**:客观——并发数/单图耗时可 console.time 量;主观(用户)——万图文件夹首开,可见卡片 1-2 秒内出图,不逐个转圈。配测试:createImageBitmap 路径单测(mock bitmap)。

**注意**:提并发会增加瞬时 CPU/内存(同时解码多张);若内存吃紧,8 比 12 稳。实测调。

---

### R3-2 点击不阻塞

**目标**:点文件夹命中变更时,即时显示,持久化后台跑。

**改法**([filesystem.js handleFolderClick](../../src/services/filesystem.js)):
```js
// 先显示,再后台持久化(不阻塞点击)
await loadFolder(folder);
persistIfDirty(rootStore.currentRootId);  // 不 await(或 .then)
```
顺序换:`scanFolder → integrateScanResult → enrich → loadFolder → persistIfDirty(后台)`。
enrich 仍 await(要补 size/mtime 给 sort);persistIfDirty 不阻塞显示。

**验收**:客观——点命中变更文件夹,显示不再等 IDB 写;主观——点击响应即时。配测试:handleFolderClick 用例断言 loadFolder 先于 persistIfDirty 完成(或 persistIfDirty 不被 await)。

**风险**:极低;持久化异步化要注意切根时 persistIfDirty 的 token/竞态(已有 newBackgroundToken 机制,确认覆盖)。

---

### R3-3 增量/合并持久化

**目标**:改名/增删不再触发全树序列化 + 大 IDB 写。

**两档可选**:
- **(a) 合并 + 后台(便宜)**:`persistIfDirty` 加 debounce(如 1s);连续变更合并成一次写。配合 R3-2 后台化,写放大在时间维度合并。不改 snapshot 格式。
- **(b) 每文件夹增量(结构)**:snapshot 按 folder 存(key 如 `scan-<rootId>/<folderPath>`),只写变化的 folder。读时聚合。彻底消写放大,但**改 snapshot 格式 + 迁移**,非平凡。

**建议**:先做 (a)(debounce + 后台),覆盖绝大多数体感;若万图树改名仍卡,再做 (b)。

**验收**:客观——改名一个文件,saveScan 调用次数 / IDB 写大小(a:合并到 1 次;(b):只写 1 folder)。配测试:debounce 合并、dirty 清除时机。

---

### R3-4 小清理

- 改 [SmartFile.js:38-40](../../src/models/SmartFile.js#L38-L40) + [SmartFolder enrich 注释](../../src/models/SmartFolder.js):删过时的 "`?? peek` 兜底" 描述,改为 "_meta 单源"。
- [fileResource.js](../../src/services/fileResource.js) `acquire`:getFile reject 路径补 `cancelled.delete(file)`(finally 之外补 catch)。
- [Gallery.vue / gallery-layout.js](../../src/components/Gallery.vue):加注释或 assert——固定行高依赖缩略图 1:1;未来非方形策略需改虚拟化。

**验收**:lint/test 绿;注释 grep 无残留过时描述。

---

## 不做(YAGNI / 取舍)

- **P4 首开全树扫改渐进式**:首开建全树快照是"切走再切回即有全树计数"的体感基础;改渐进式(深层按需、snapshot 随导航增长)会牺牲这个,且首开重活在并发 32 下通常可接受。除非万图首开实测卡,不动。
- **缩略图 key 换 size+mtime**:丢改名缓存命中,不值。
- **handle-identity 池共享**:多视图共享同一 url,当前 owner-based 1:1 够用,无瓶颈迹象。

---

## 一句话总结

架构已无债;Round 3 三件性能 polish:**①缩略图首开提速(并发+createImageBitmap,"万图不卡"最后一块)②点击不阻塞(loadFolder 先、持久化后台)③增量/合并持久化(debounce 先,每 folder 增量兜底)** + 一组小清理(过时注释、cancelled 漏清、虚拟化方形断言)。是否继续取决于"首开大文件夹转圈"和"改名写放大"的体感。
