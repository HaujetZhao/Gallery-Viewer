# Round 2 · R2+R3:打开即信 + root eager + 变更才持久化

日期:2026-07-28
状态:设计已用户认可,待转 writing-plans 出实施计划
前置:
- round2 总文档:[2026-07-28-架构重构-round2-精修与扫描优化.md](./2026-07-28-架构重构-round2-精修与扫描优化.md)(Part 2 / R2+R3)
- R1(Gallery 虚拟化)已完成
本文档自包含。新窗口先读本文件即可动手。

---

## 背景与目标

消除「重复打开文件夹时的不必要扫描」。理想终态:重复打开、磁盘无变更 → **0 全树 readdir / 0 getFile / 0 IDB 写 / 0 全树计数**。

round2 三条线之二。R1(虚拟化)管「文件夹内万图滚动不卡」;R2+R3 管「打开/切换近零成本」。两者独立。

## 现状(三处浪费,都在 [scanAndPersist](../../../src/services/filesystem.js#L72))

[scanAndPersist](../../../src/services/filesystem.js#L72)(`openFolderPicker`/`switchToRoot`/`reloadProject` 都调):
1. **W1**:`startBackgroundScan(root)` —— 全树递归,每个文件夹 `values()` 列名比对(一次 readdir/文件夹/每次打开)。
2. **W2**:`saveScan(id, root.toSnapshot())` —— 递归序列化整树 + 一次大 IDB 写(O(N_files)/每次打开)。
3. **W3**:`updateMeta(id, { fileCount: root.getAllFiles().length })` —— 递归 concat 全树文件(O(N_files)/每次打开)。

[switchToRoot](../../../src/services/filesystem.js#L116) 即使有 snapshot 秒显(`fromSnapshot`),**仍调 `scanAndPersist`** → W1/W2/W3 每次打开都跑。

> 注:`scanFolder` 的 trust 短路(名字集合一致 → 零 IO 引用既有)+ `enrich` 信任路(既有 `_meta` 已有 → targets 空 → 零 getFile)已完善。「未变文件的 getFile」早已消除,本 R2+R3 能再省的就是 W1/W2/W3 这三处「每次打开的全树遍历/序列化/计数」。

## 平台现实(不变,决定一切)

- FS Access API 读不到目录 mtime;`values()` 列名 + 名字集合比对是最便宜的变更信号(已用)。
- 无变更推送(`FileSystemObserver` 不可靠)。
- 故「磁盘是否变了」只能靠 readdir 比对;「未变则不序列化/不计数」是可省的红利。

## 设计决策(用户已定)

**变更检测策略:root 一层 eager + 深层按需**。switchToRoot 时 eager 校验 root 一层(顶层增删即时),深层子目录点开才校验。`重载项目` 仍 force 全量兜底。

---

## R2 扫描

### D1 `rootEagerScan(root)`(新,filesystem.js)

switchToRoot 有 snap 后,只扫 root 一层(不递归深层):

```js
async function rootEagerScan(root) {
  const fs = useFsStore();
  const result = await scanFolder(root, { trust: true }); // 一次 readdir 校验顶层增删(名字集合一致零 IO)
  integrateScanResult(root, result, fs);                   // 写回代理(增删生效;检测增删则置 dirty)
  await root.enrich({ token });                            // 顶层新增文件补 _meta
}
```

不递归深层 → 砍 W1 的「全树每节点 readdir」,只 root 一层一次。

### D2 `switchToRoot` 改(有 snap 分支)

```js
if (snap) {
  const root = SmartFolder.fromSnapshot(snap, null);
  registerFolderTree(root, fs);
  fs.rootFolder = root;
  fs.currentFolder = root;
  await rootEagerScan(root);     // ← 替代 scanAndPersist 的全树后台扫
}
// ...setCurrent + updateMeta(lastUsed)
await persistIfDirty(id);        // ← 仅 dirty 时持久化(W2/W3)
```

无 snap 分支:`loadProject` 全扫(首次建 snap,不变)。

### D3 `handleFolderClick` 改(所有点击都 trust 校验)

```js
const result = await scanFolder(folder, { trust: true }); // 校验增删(短路零 IO)
integrateScanResult(folder, result, fs);                  // 置 dirty 若有增删
await folder.enrich();                                    // 新增文件补 _meta
await persistIfDirty(id);                                 // dirty 才持久化
await loadFolder(folder);
```

替代原 `< 200 才 refreshFolder(trust:false)`。trust:true 对所有点击:未变零 IO,有变才 enrich 新增。深层变更点开才刷新(折中)。

> `refreshFolder`(trust:false,reload/手动刷新抓同名替换)保留,`reloadProject` 用。

---

## R3 持久化

### D4 dirty flag([stores/fs.js](../../../src/stores/fs.js))

fsStore 加 `rootDirty` ref(bool)。**置脏点(service 层,model 保持纯)**:
- `integrateScanResult`:result 的 `newFiles`/`removedFiles`/`newSubFolders`/`removedFolders` 任一非空 → `fs.rootDirty = true`。
- rename / delete / move:操作完成后由调用方([operations.js](../../../src/services/operations.js) / history)置 `fs.rootDirty = true`。
- 清脏:`persistIfDirty` 完成后 `fs.rootDirty = false`。

> enrich 不单独置脏:新文件的 `_meta` 持久化由 `newFiles`(integrateScanResult 已检测)覆盖;既有文件 trust 路targets 空(`_meta` 已有)→ 不写 → 不脏。

### D5 `persistIfDirty(id)`(新,替代 scanAndPersist 的持久化部分)

```js
async function persistIfDirty(id) {
  const fs = useFsStore();
  if (!id || !fs.rootDirty) return;       // 未变:零 saveScan / 零 getAllFiles(砍 W2/W3)
  const root = fs.rootFolder;
  await saveScan(id, root.toSnapshot());
  await useRootStore().updateMeta(id, { fileCount: root.getAllFiles().length });
  fs.rootDirty = false;
}
```

### D6 fileCount 缓存(基础已具备)

rootStore.roots 元数据已含 `fileCount`([root.js:8](../../../src/stores/root.js#L8))。switchToRoot / 侧栏读 meta 显示,**不调 getAllFiles**;仅 `persistIfDirty`(dirty)时重算。→ 砍 W3。

---

## 各入口行为(R2+R3 后)

| 入口 | 行为 |
|---|---|
| `switchToRoot`(有 snap) | fromSnapshot + rootEagerScan(顶层 trust) + persistIfDirty(无变更→零 persist) |
| `switchToRoot`(无 snap) | loadProject 全扫(首次建 snap) |
| `openFolderPicker` | initProject + 全树 scanAndPersist 建 snap(**首次必须**,不变) |
| `handleFolderClick` | scanFolder(trust)+ enrich 新增 + persistIfDirty + loadFolder |
| `reloadProject` | force 全树(抓同名替换兜底,不变) |

## 不做(YAGNI)

- 不改首次打开(`openFolderPicker`):首次必须全树扫建 snap。
- 不增量维护 fileCount(rename 不变计数;add/delete 时 ±1 易,但子树增删复杂)——用「persist 时重算 + 非 persist 读缓存」足够(变更才付一次)。
- 不动 `scanFolder`/`enrich`/trust 机制(已完善)。
- 不做后台定时 persist(dirty 在用户操作后即时 persist,足够)。

## 落点

### [filesystem.js](../../../src/services/filesystem.js)
- 新增 `rootEagerScan(root)`。
- 新增 `persistIfDirty(id)`。
- `switchToRoot`:有 snap 分支 `scanAndPersist(id)` → `rootEagerScan(root)` + `persistIfDirty(id)`;保留无 snap 全扫。
- `handleFolderClick`:`< 200 refreshFolder` → `scanFolder(trust:true)` + integrateScanResult + enrich + persistIfDirty + load。
- `integrateScanResult`:增删检测 → `fs.rootDirty = true`。
- `scanAndPersist`(首次/reload 用):末尾接 `persistIfDirty`(首次全树 enrich 后必 dirty)。

### [stores/fs.js](../../../src/stores/fs.js)
- 加 `const rootDirty = ref(false)`,return 暴露。

### rename/delete/move 调用方([operations.js](../../../src/services/operations.js) / history)
- 操作完成后 `useFsStore().rootDirty = true`(service 层,model 不动)。

## 取舍(必须告知)

- **深层新增子文件夹/文件**:点开才出现(root eager 只管顶层)。
- **顶层新增**:root eager 即时抓到 → dirty → persist → 侧栏/计数更新。
- **同名替换**(内容变、名字/size/mtime 不变):scanFolder trust 检测不到 → `重载项目`(force)兜底。

## 验收

**客观(我机械核对)**:
- 无变更 switchToRoot:无 IDB write(`saveScan` 不调)、无 `getAllFiles` 调用;root 一层 `scanFolder` trust 短路(可加临时 log 或 DevTools 观察)。
- 有变更(顶层新增文件):root eager 抓到 → dirty → persist(IDB write + fileCount 更新)。
- 现有测试绿;scan/scanCache 相关单测若需更新。

**主观(用户验)**:重复打开大树瞬完;顶层新增即时出现;深层新增点开刷新;侧栏计数正确;rename/delete 后重开仍持久化。

## 与其他线

- R1(虚拟化)独立,不交互。
- R4(_meta 单源)/ R5(批量 _meta)/ R6(边角)独立精修,不阻塞。

---

## 一句话总结

把「每次打开都全树后台扫 + 全量持久化 + 全树计数」拆成:显示走 snapshot、校验走 root 一层 eager + 深层按需点开、持久化走 dirty flag(变更才 saveScan + getAllFiles)。fileCount 已在 rootStore meta,非变更直接读。理想终态:重复打开无变更 = 0 readdir / 0 getFile / 0 IDB 写 / 0 全树计数。
