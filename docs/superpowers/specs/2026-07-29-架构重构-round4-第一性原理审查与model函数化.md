# Round 4:第一性原理审查 + model 函数化(P0 + P3)

日期:2026-07-29
前置:round1(资源层分离 + 纯 model + 纯列表 scan)/ round2(虚拟化 + 扫描优化)/ round3(性能 polish)

## 背景

用户提出性能目标(几千~1 万+ 照片、瞬间扫完、缓存避免重复扫描、文件夹秒切),要求**无视既有约定、从第一性原理审查 SmartFolder/SmartFile 设计是否合理,有无技术债 / 过度复杂 / 更优实现**。

## 一、第一性原理审查结论

### 物理约束(决定设计空间)

FS Access API 的硬约束解释了 80% 的设计动机:

| 约束 | 后果 |
|---|---|
| `dirHandle.values()` 是唯一列举方式,**读不到目录 mtime** | 无免费"目录变了没"信号 → 用**名字集合差集**当变更信号(最优解) |
| `handle.getFile()` 是唯一读 File 的路(一次 IO) | scan 尽量零 getFile → 纯名差集 + enrich 懒补 |
| handle 可结构化克隆进 IDB,重读需 `requestPermission`(用户手势) | 启动恢复需"打开上次"卡片兜底 |
| `URL.createObjectURL` 必须手动 revoke | 需资源池集中管理(fileResource) |

**scan / enrich / fromSnapshot / 资源池这几块,都是在约束下的正确选择。** 审查只批真正的问题。

### 核心算法稳定(不动)

scanFolder 纯列表差集 + 信任名字集合短路 + enrich 批量写 `_meta` + fromSnapshot 零 IO 秒重建——这套是"瞬间扫完 + 秒切"的基石。1 万图场景下,扫描零 getFile、秒切零 IO(快照连 `_meta` + `md5` 都持久化,enrich targets 空)。

### md5 缓存键:误判纠正(重要)

初版审查误判 md5(前 2MB)为"首切性能天花板",建议改 size+mtime。**经用户澄清 + 代码核实,收回此判断:**

- md5 是**视窗触发、按需计算**(`if (!file.md5)` 才算,从不算万张),非全量预扫。
- md5 **随快照持久化**([SmartFile.toSnapshot](src/models/SmartFile.js) 存 md5)→ 切回时 `file.md5` 已恢复 → 直接查缩略图缓存,**零 md5 计算、零 2MB 读**(秒切零重算)。
- md5 是**内容寻址**:同一照片在不同文件夹(不同 handle/路径,如父/子文件夹或复制副本)md5 相同 → 共享一份缩略图缓存。**size+mtime 做不到**(不同物理文件 mtime 随复制变,必然 miss)。

→ md5 设计深思熟虑,**不改**。仅纠正了代码注释/CLAUDE.md 里"改 size+mtime 会丢改名缓存命中"的不准理由(改名是两者都命中的场景),改为真实的"跨物理文件内容去重 + 持久化零重算"。

### 三个真实张力(本轮处理)

1. **SmartFolder/SmartFile 是 God Object** —— 数据 / 响应式节点 / 文件操作 / 序列化 / 扫描全揉进一个类。→ **P3 函数化**。
2. **`getAllFiles().length` + 全树 toSnapshot 写放大** —— 每次 dirty 都 O(N)。→ **P0-1 计数 + toSnapshot 权衡保留**。
3. **"代理 vs 原始对象"陷阱散落** —— `set→get 取代理→integrate` 手法遍布,4+ 处注释警告。→ **P0-2 registerAndIntegrate 收口**。

### 不动的(避免误伤)

- `scanCache` 14 行(可测性 + 与 handleStore 对称)
- `db.js` 原生 IDB vs scanCache/handleStore idb-keyval 两套(KV 用 keyval、大 blob 用原生,用对工具)
- scanFolder 纯函数 + 信任短路 + enrich 批量(核心性能算法)

---

## 二、P0 三项(低风险清理)

### P0-1:`getAllFiles().length` → `countAllFiles()`

`persistIfDirty` 算 fileCount 原走 `root.getAllFiles().length`——递归 concat 整树成万级数组,**只为取 length**(O(N) 分配)。1 万+ 图每次 dirty 都付。

改:`countAllFiles(folder)` 递归计数(零数组分配)。`getAllFiles` 删除(无其他调用)。

### P0-2:`registerAndIntegrate` 收口代理陷阱

封 `registerAndIntegrate(plainFolder, scanResult, fs)`:set 进 reactive Map(代理化)→ get 取代理 → integrateScanResult 写回。新建 folder 一律走此 helper(`getFolderData` 用),避免"set→get 取代理"手法散落被未来调用点漏写。

### P0-3:`visibilitychange:hidden` flush

`schedulePersist` 1s debounce 窗口内关浏览器/切后台会丢在途改动。补 `visibilitychange:hidden` 监听(App.vue)→ `flushPendingPersist` best-effort 落盘:hidden 在 pagehide 前触发,多数浏览器仍允许 IDB 写完;无在途写时零成本快路径 return。

**验证:** 82 tests passed,lint clean。

---

## 三、P3:SmartFolder/SmartFile 函数化(消灭 God Object)

### 形态

类降级为**纯数据 + 派生 getter**,行为方法是**同文件模块级函数**:

| 类(保留) | 模块函数(新增/迁移) |
|---|---|
| `SmartFolder`:字段 + `path`/`isEmpty` getter | `scanFolder`/`enrichFolder`/`folderToSnapshot`/`folderFromSnapshot`/`createFolder`/`createVirtualFolder`/`validateFolder`/`findValidFolderAncestor`/`disposeFolder`/`toggleFolderExpanded`/`deleteFolder`/`addFileAndSort`/`removeFileFromFolder`/`countAllFiles`/`createAllMediaFolder` |
| `SmartFile`:字段 + `name`/`size`/`lastModified`/`type`/`path`/`blobUrl` getter | `ensureBlobUrl`/`fileToSnapshot`/`fileFromSnapshot`/`renameFile`/`moveFile`/`disposeFile` |

**模板用的 getter 保留**(普查确认:`folder.path`/`isEmpty`/`files`/`subFolders`、`file.name`/`size`/`blobUrl` 等在 .vue 模板高频用)——Vue 响应式追踪属性访问,函数化会破坏 reactivity + 爆炸面巨大。

### 删的死方法(0 调用)

- SmartFolder:`addFile` / `findFile` / `getFileCount` / `move`(throw)/ `getAllFiles`(被 countAllFiles 替代)
- SmartFile:`validate` / `getActualType`

### 关键设计:moveFile 内联树维护

`SmartFile.move` 原调 `targetFolder.addFileAndSort`/`sourceFolder.removeFile`(SmartFolder 方法)。函数化后若 `moveFile` import SmartFolder 函数 → SmartFolder import SmartFile(已有)→ **循环 import**。

解法:`moveFile` 内联树维护(`sourceFolder.files.splice` + `targetFolder.files.push` + sort),自包含,避免反向 import。代价:windowsCompareStrings 一行排序逻辑重复(可接受,<< 循环 import 复杂度)。

### 调用点更新(13 文件)

`filesystem.js` / `recovery.js` / `fileOps.js` / `operations.js` / `metadata.js` / `thumbnail.js` / `MediaModal.vue` / `SidebarTreeItem.vue` + 3 测试文件。

### 测试:编排测试改 spy 风格

`filesystem.test.js` 原 mock"对象方法"(`folder.enrich`/`rootFolder.toSnapshot`)。函数化后这些是模块函数,改用 `vi.spyOn(smartFolderMod, 'enrichFolder')` 等隔离(真实 enrich/snapshot 行为在 `smart-folder.test.js` 单测)。`beforeEach` 全局 spy 4 个函数,`cancel` 测试覆盖 `enrichFolder` 做关卡。

**验证:** 82 tests passed,lint clean,净减 87 行(321 insert / 408 delete)。

### ⚠️ 诚实定位:P3 不消灭代理陷阱

陷阱根因是 **Vue3 reactive Map 惰性代理化**,跟方法挂不挂类上**无关**。即使 `enrichFolder(folder)` 是函数,调用方传原始 folder,函数内 `folder.files = x` 仍不响应式。

P3 的真实收益:**可维护性 + 约定一致性**(model 层 enrich/ensureBlobUrl 有 IO 副作用,原挂在 model 类上违反约定 1;函数化后约定 1 真正成立)+ **减少认知负担** + 删死方法。陷阱的根治靠 **P0-2 registerAndIntegrate + scanAndPersist 统一取代理**(已具备),不靠 P3。

---

## 四、未做(留待后续)

- **P1**:metadata.js image 读尺寸改用 `getImageInfoFromHeader`(零解码,省一次 Image 解码);thumbnail-strategies 与 metadata 的 strategy 表去重 + cover-crop 数学抽共用。
- **P2**:持久化调度 per-root timer(`Map<rootId, timer>`),简化切根竞态防线。
- **ALL_MEDIA 增量化**(当前每次切都全量重拼 O(整树))——频繁切 ALL_MEDIA + 万图才痛。
- md5 计算搬 Web Worker(防并发算 md5 主线程抖动)——可选,单次成本不大。

均非性能咽喉(扫描/秒切/缓存已达标),优先级低于本轮。

---

## 五、验收点(交用户上手)

本轮改了响应式相关逻辑(虽测试绿,但 UI 主观体验由用户判断):

1. **文件夹秒切**:打开过的根,切换应瞬显(fromSnapshot 零 IO),后台只扫一层。
2. **扫描 + enrich**:新开文件夹,缩略图随 enrich 补 size/mdate 后 sort 重排一次(不应多次抖动)。
3. **改名/移动/删除 + 撤销**:文件操作后 UI 即时更新;Ctrl+Z 撤销还原(renameFile/moveFile/addFileAndSort/removeFileFromFolder 路径)。
4. **文件夹展开/收起**:Sidebar 树 toggle(toggleFolderExpanded 路径)。
5. **关浏览器不丢改动**:改名后立即切后台/关页,重开应见新名(visibilitychange flush)。
6. **ALL_MEDIA**:聚合视图正常。
