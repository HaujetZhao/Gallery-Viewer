# 架构重构设计:资源层分离 + 纯 model + 纯列表 scan

日期:2026-07-28
状态:设计完成,待分阶段实施(本文档即实施基线,新窗口据此协作)
前置:[瞬扫与缓存优化设计](./2026-07-28-瞬扫与缓存优化-design.md)(本轮已落地的并发 + 信任 + 响应式修复)

---

## 0. 这份文档怎么用

本文是**自包含**的重构基线。新窗口协作时:先读本文 §1–§6 建立完整上下文,再按 §6 的阶段顺序执行(每阶段独立可验收、不破坏现有功能)。不需要回看聊天记录。

执行风格约定(来自项目 CLAUDE.md + 用户偏好):
- 中文;Windows + PowerShell(终端命令分隔符 `;`)。
- 独立的活儿优先派 subagent;主会话编排审阅。
- **UI 主观体验由用户本人在浏览器验收**;子代理只做客观机械核对(DOM class / computed style / 控制台报错 / 编译通过)。
- 核心算法改动配测试(Vitest,jsdom)。
- Ponytail:最小可用 diff、YAGNI、删优于增。

---

## 1. 背景:项目演进与积压的架构债

这个项目从**纯 JS 单根前端**起步(~17000 行),重构为 Vue3 + Vite + Pinia,后又加多文件夹。每次演进都**在旧骨架上长新肉**:

- 最初为**单根**设计 → 后来加多文件夹(snapshot/rehandle/RootSwitcher)是叠加上去的。
- 最初 SmartFile/SmartFolder 是**自带 DOM 反向引用 + 自管资源**的"胖模型" → Vue3 化后 DOM 部分退化(TreeNode 残留),但**资源自管(blobUrl)和静态注入(appState)保留了下来**。
- model 层至今会**自己改 `this`**,而 `this` 是原始对象还是 Vue3 代理取决于调用方传对了没有 → 这就是响应式陷阱的温床。

**结论:旧设计的两处核心约束——「SmartFile 自管 blobUrl 资源」和「model 自改 `this` + 静态注入 appState」——已经过时,是多数 bug 和性能上限的根因,应彻底重构,而非继续在其上打补丁。**

### 触发事件(本设计的直接起因)

[be2ffe3](#) 修了一个 bug:打开新文件夹后,所有子目录停在半透明(`isEmpty=true`)不更新。根因是 `initProject` 返回**原始 root**,`openFolderPicker` 把它传给后台扫描 → 在原始对象上改子文件夹 → **不触发响应式**。这**不是偶发**,是「model 自改 `this` + 调用方可能传原始对象」这一架构的必然产物。补丁式修复(强制传代理)治标;治本要 model 不再自跨 raw/proxy 边界改 `this`。

---

## 2. 第一性原理:平台约束 + 应用真实需求

### 2.1 File System Access API 的硬约束(不可变)

- `FileSystemDirectoryHandle.values()` 异步迭代器:只给 `kind` + `name`。**列目录免费**(一次目录读,O(条目数))。
- `FileSystemFileHandle.getFile()`:给 `File`(含 size/mtime/数据)。**每个文件一次 IO**(IPC 到浏览器文件后端)。
- **读不到目录 mtime**:`FileSystemDirectoryHandle` 只有 `kind`/`name`,无元数据访问器。→ 文件夹 mtime 不能当扫描依据。
- **并发**:`getFile()` 可并发调用(Promise)。串行 N 次 → 并发 N/批量 次,大文件夹可快一个量级。
- **无变更推送**:`FileSystemObserver` API 仍在推进/origin trial,稳定版不可靠,先不依赖。

### 2.2 应用对每个文件**真正**需要知道什么

| 信息 | 何时需要 | 来源 | 成本 |
|---|---|---|---|
| name / handle / type | 列表/树显示 | `values()` | 免费 |
| 缩略图 | 卡片进视口 | getFile + 解码 + 缩放;IDB 缓存(md5 键) | 首见必读;命中零 IO(md5 在 snapshot 里) |
| 原图 blobUrl | 弹窗/拖拽/复制 | getFile → createObjectURL | 按需,可池化共享 |
| 尺寸/EXIF/时长 | 属性面板/排序 | getFile + 解码 | 按需 |
| size/mtime | 排序(尺寸/日期)+ 变更检测 + 属性 | getFile | 按需;**列名不需要** |

**关键认知:列名免费,元数据要钱。把它们分开;有快照就信,元数据按可见卡片懒取并缓存。** 这两条决定了:重复打开同一文件夹 = 零 IO;首次打开 = 只花列目录的时间。

### 2.3 变更检测的最优信号

- 名字集合比对(`values()` 免费):能抓增删改名,免费,可读。**这是平台约束下的最优信号。**
- 它漏"原地同名同尺寸替换"(照片场景极罕见);"设置→重载项目"强制全量校验兜底。

---

## 3. 根缺陷诊断:SmartFile 的三重耦合

当前 `SmartFile` 把三件本不该在一起的事揉进了一个对象:

```
SmartFile = { handle, name, type, parent,     // 身份(纯数据,该有)
              blobUrl,                          // 浏览器资源(必须 revoke,生命周期复杂)
              file, _size, _lastModified,       // 元数据(需 IO)
              md5 }                              // 派生缓存(缩略图 key)
```

这一个耦合的**可观察后果**:

1. **逼着 scan 急切 getFile**:构造 SmartFile 要建 blobUrl([SmartFile.js:14](../../../src/models/SmartFile.js)) → scan 必须先 getFile 才能构造 → **堵死了"纯列表瞬扫"**(scan 无法只列名)。
2. **blobUrl 生命周期散落**:scan/refresh/rename/rehydrate 每条路径都要管 `createObjectURL`/`revokeObjectURL`;`.blobUrl` 被 6 处同步消费(thumbnail-strategies / metadata / useModal / AudioPlayer / PhotoCard / MediaModal),每处都暗含"此刻 blobUrl 已存在"的脆弱假设。这就是"纯列表"要触发跨 6 文件改造的根因——**耦合本身**就是障碍。
3. **放大响应式陷阱**:model 自改 `this`(scan 里 `this.files = ...`),而 `this` 是原始对象还是代理取决于调用方。→ be2ffe3 的半透明 bug。

**这三个后果同根同源。修耦合,三个一起消失;不修,只能逐个打补丁。**

### 次要债

- **`SmartFolder.appState` 静态注入**:为避免 model→store 循环依赖,用静态字段让 model 反向访问 store(`foldersData`/`rootHandle`)。能跑,但脆,是响应式陷阱的另一半温床。
- **`TreeNode` 残废化**:Vue3 化后只剩 `expanded`/`isEmpty`/`count`,DOM 部分已删;`count` 甚至没被用(SidebarTreeItem 用 `folder.files.length`)。一个类 + 一个全局 registry,纯包袱。
- **`scanned` 字段**:本轮移除了它唯一的消费者(startBackgroundScan 的守卫),现只剩序列化、无人读取。
- **`foldersData` 用 path 当 key**:path 在改名/移动后变,是不稳定身份键(但可读、ALL_MEDIA 聚合用,影响小,低优先)。

---

## 4. 目标架构:三关注点分离

### 4.1 列名(Listing,免费)

`scan` = 纯粹 `values()` 遍历,产出 `{files: [{name, handle, type}], subFolders: [{name, handle}]}`。**零 getFile。** 配合差集 + 信任短路(已实现)。

### 4.2 资源(Resource,对象 URL / File 缓存池)

新建 `src/services/fileResource.js`——**文件资源缓存池**,把"取 File + 建 blobUrl + 记 size/mtime"集中到一处,引用计数管理:

```js
// 概念示意(具体键策略见 §6 Phase 1 决策)
// pool: 某种 key -> { url, file, size, mtime, refs:Set<owner> }
async function acquire(handle, owner)        // 懒 getFile,返回 { url, size, mtime };refs++ 
function release(handleOrKey, owner)          // refs--,归零 revokeObjectURL
```

**收益**:同一文件的弹窗/卡片/拖拽**共享一次 getFile + 一个 URL**(省 IO + 内存);消费者只调 `acquire/release`,不再碰 `createObjectURL`/`revokeObjectURL`;SmartFile 不再持有 blobUrl。

### 4.3 派生缓存(Derived cache)

- **md5**:仍由缩略图层算(首次生成缩略图时,从已取的 File 算前 2MB),写回并进 snapshot。repeat-open 时 md5 已在 snapshot → 缩略图命中零 IO(现状已最优,保持)。
- **size/mtime**:从资源池的 File 取(getFile 顺带),缓存进池 + snapshot。

### 4.4 纯 model + store 持有变动(消灭响应式陷阱类)

- **model 层纯数据 + 纯函数**:`Folder`/`FileEntry` 是 plain 对象;`scanFolder(handle)` 是 `(input) -> result` 的纯函数(返回差集/列表,不改 `this`);`reconcile(folder, listing)` 也是纯函数。
- **store 持有树 + 整合所有变动**:`useFsStore` 拿 scan 结果,通过**代理**写回树。store 永远持代理,model 不跨 raw/proxy 边界 → **be2ffe3 那类 bug 不可能发生。**
- 删 `SmartFolder.appState` 静态注入;`foldersData` 注册移到 store。

---

## 5. 保留不动的(已是对的设计)

- **树镜像 FS**:自然结构。
- **snapshot / rehydrate 秒切根**:多文件夹秒切换的核心能力。
- **增量 diff + 信任名字集合短路**:变更检测的最优免费信号(本轮已实现,见 [SmartFolder.scan](../../../src/models/SmartFolder.js))。
- **并发 getFile + 并发可取消后台遍历**:本轮已实现([concurrency.js](../../../src/utils/concurrency.js))。
- **IntersectionObserver 懒缩略图 + 并发队列**:对的。
- **md5 当缩略图 key**:改名/移动后缓存仍命中。
- **`.trash` 镜像回收站、GPS/ID3/魔数算法**:已验证稳定。

---

## 6. 分阶段迁移路径

**总原则**:每阶段独立可验收、不破坏现有功能、可单独回滚。顺序按"收益/风险比"排,Phase 1 是后续的解锁项。

---

### Phase 1:文件资源池(解锁纯列表 + 杀 blobUrl 生命周期类 bug)

**目标**:把 blobUrl/File/size/mtime 从 SmartFile 抽到 `fileResource` 池;消费者改走池 API。SmartFile 降为纯身份。

**改哪些文件**:
- 新建 `src/services/fileResource.js`(`acquire`/`release`,引用计数,集中 revoke)。
- [SmartFile.js](../../../src/models/SmartFile.js):删 `blobUrl`/`file`/`_size`/`_lastModified` 字段;`size`/`lastModified` getter 改为读池(或保留为可被池填充的缓存槽,见决策);删 `ensureBlobUrl`/`dispose` 里的 URL 逻辑(改为 `release`)。**保留 `md5`**(缩略图层写回)。
- 6 个消费方改走池:`thumbnail-strategies.js`、`metadata.js`、`composables/useModal.js`、`components/AudioPlayer.vue`、`components/PhotoCard.vue`、`components/MediaModal.vue`。
- snapshot:仍可存 size/mtime/md5(repeat-open 零 IO 依赖它);`file`/`blobUrl` 本就不进 snapshot。

**关键设计决策(实施时定)** —— 池的键策略:
- (a) **owner-based(以 SmartFile 为 key)**:最简,等价于"把 blobUrl 外置成 Map<SmartFile,url>",集中生命周期。**不共享**(同文件多视图各自一份)。推荐先做这个——它已能解锁纯列表 + 杀生命周期 bug。
- (b) **handle-identity-based(以 `handle.isSameEntry` 判同文件)**:能共享(同文件多视图一个 URL),省 IO/内存。但 `isSameEntry` 异步、键管理复杂。作为 (a) 之后的升级,等共享成为瓶颈再做。
- **建议**:Phase 1 先 (a)。

**验收(客观)**:Vitest——池的 acquire/release 引用计数、归零 revoke、重复 acquire 不重复 getFile。`npm run lint`。用户浏览器——缩略图/弹窗/拖拽/音频/复制 行为与重构前一致。

**风险/回滚**:改动面广(6 消费方)但行为应等价;出问题最大可能在 UI 组件(AudioPlayer/PhotoCard 的响应式包装)。回滚=git revert 单提交。**不依赖后续阶段。**

---

### Phase 2:纯列表 scan + 后台并发补全(真正的瞬扫)

**依赖**:Phase 1(scan 不再需要为构造 SmartFile 而 getFile)。

**目标**:`scan` 改为 `values()` 纯列名(零 getFile);size/mtime 由后台并发补全 + 按需从池取。

**改哪些文件**:
- [SmartFolder.scan](../../../src/models/SmartFolder.js):拆成「listFolder(handle)→ 纯列名差集」+「enrich(并并发 getFile 补 size/mtime,写池 + 对象)」。信任短路保留(名字集合一致 → 零 IO)。
- [filesystem.js](../../../src/services/filesystem.js):phase-1 调 `listFolder` 秒显;phase-2 后台 `enrich`(并发,复用 `runConcurrent` + token)。
- 排序:size/date 排序需等后台补全或按可见窗口懒补;name 排序零依赖。**注意:sort-by-size/date 从"同步可得"变"稍候可得"**——这是唯一的可观察行为变化,需用户验收手感(可能要个轻量 loading 态)。

**验收(客观)**:Vitest——`listFolder` 零 getFile(用 spy 断言);`enrich` 信任路零 getFile、差异路只补差异。用户浏览器——大文件夹首开"瞬间出列表",慢盘/网络盘也快(这是并发方案拿不到的)。

**风险/回滚**:sort 手感变化是主要 UX 风险;后台补全要和响应式配套(Phase 3 之前,沿用"从 store 取代理"的临时约束)。回滚=git revert。

---

### Phase 3:纯 model + store 持有变动(消灭响应式陷阱类)

**目标**:scan 改为纯函数(入→出,不改 `this`);store 整合结果并持代理;删 `appState` 静态注入;`foldersData` 注册归 store。

**改哪些文件**:
- [SmartFolder.js](../../../src/models/SmartFolder.js)/[SmartFile.js](../../../src/models/SmartFile.js):`scan`/`reconcile` 改纯函数,返回新树/差集;删 `static appState`;构造不再注册 `foldersData`。
- [stores/fs.js](../../../src/stores/fs.js):接管 `foldersData` 注册;调 model 纯函数后,用代理写回树。
- [filesystem.js](../../../src/services/filesystem.js):改用 store 的整合入口(而非 model 自改)。

**验收(客观)**:Vitest——model 纯函数(同输入同输出,不改入参);store 整合测试(代理上写回触发响应式)。用户浏览器——多文件夹切换、增删文件、改名后,UI 全程同步(回归 be2ffe3 场景应天然免疫)。

**风险/回滚**:这是架构改动最大的一阶段,牵动 model/store/service 三层契约。务必配足测试。可拆成更小步(先纯函数化 scan,再移 appState,再移 foldersData 注册)逐提交。

---

### Phase 4:清理(低风险收尾)

- 删 `TreeNode`(把 `expanded` 并到 folder 字段或 UI store;`isEmpty` 改计算属性或 folder 字段);删 `treeNodeRegistry`。
- 删 `scanned` 字段 + 其 snapshot 序列化(同步改 fromSnapshot 与测试)。
- 顺手清本轮发现的其他死代码。

**验收**:全量测试 + lint + 用户冒烟。

---

## 7. 测试策略

- **平台约束**:真 FS Access API 在 jsdom 不可用 → 沿用本轮的**假 dirHandle 模式**(见 [smart-folder.test.js](../../../src/models/smart-folder.test.js) 的 `makeDirHandle`/`fileEntry`)。
- **纯函数(model)**:同输入同输出、不改入参——好测。
- **池(资源层)**:引用计数、归零 revoke、并发 acquire 不重复 getFile——好测。
- **响应式**:Pinia + 组件级触发难单测 → **用户浏览器验收**(符合其偏好);单测只覆盖纯逻辑。
- **回归基线**:每阶段前跑 `npm test`,确保不退化。当前基线 8 文件 47 测试全绿。

---

## 8. 明确不做(YAGNI)

- **Web Worker 跑 scan/缩略图**:纯列表后 UI 线程本就没重活;只对缩略图解码有意义,而它已懒加载 + 并发排队(4)。收益边际,复杂度高。
- **模型层虚拟化(不建 N 个对象)**:纯列表后每对象 ~4 字段,5000 个才几 KB;Gallery 渲染层已虚拟化。
- **缩略图 key 换 path+mtime**:repeat-open 时 md5 已在 snapshot、命中零 IO;首见文件本就要读内容。省的是 CPU 不是 IO,不值得丢"改名后缓存仍命中"。
- **每文件夹独立 snapshot 增量持久化**:snapshot 只在全后台扫完后存一次、且后台,非热路径。
- **handle-identity 池共享(Phase 1 先不做)**:见 §6 Phase 1 决策,先 owner-based。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Phase 1 改 6 消费方,UI 组件易错 | 先 owner-based(最小行为等价);UI 由用户验收;逐消费方小步提交 |
| Phase 2 sort-by-size/date 从同步变稍候 | 可见窗口懒补 + 轻量 loading 态;用户验手感,不合预期则保留后台补全为同步前置 |
| Phase 3 改动面最大、牵三层契约 | 拆更小步逐提交;每步配测试;model 纯函数化先行(低风险),appState/foldersData 后移 |
| 重构期与功能开发冲突 | 每阶段独立可发布;任一阶段后可停,系统仍可用 |
| 真机 FS Access 无法在 CI/单测覆盖 | 假 dirHandle 覆盖逻辑;用户浏览器做集成验收 |

---

## 10. 当前进度基线 + 参考索引

### 已落地(本轮,提交在 master)

- `ed3b24e` docs:瞬扫与缓存优化设计
- `c96547d` feat:并发原语 `runConcurrent` + 取消 token + CONFIG 档位
- `69c50bf` feat:`SmartFolder.scan` 并发 getFile + 信任名字集合短路;删 `SmartFile.refresh()` 死代码
- `f07cd1a` feat:`startBackgroundScan` 并发遍历 + 可取消 + 信任
- `be2ffe3` fix:后台扫描用代理 root,修打开新文件夹后子目录停在半透明不更新

当前:`scan` 已并发 getFile + 信任短路;后台遍历已并发可取消;响应式陷阱已补丁修复。基线 **8 文件 47 测试全绿,lint 干净**。`npm run build` 在沙箱内被单 HTML base64 内联杀(EXIT=127,baseline 同样失败,非代码问题;用户本地终端可正常 build)。

### 参考文档

- 设计总纲:`docs/superpowers/specs/2026-07-27-相册浏览器重构-design.md`
- 迁移完整性审查:`docs/superpowers/specs/2026-07-27-迁移完整性审查.md`
- 多文件夹管理:`docs/superpowers/specs/2026-07-28-多文件夹管理-design.md`(含"扫描响应式修复记录"——be2ffe3 的前车之鉴)
- 本轮前置:`docs/superpowers/specs/2026-07-28-瞬扫与缓存优化-design.md`
- 路线图:`docs/改造路线图.md`;遗留:`后续待办.md`
- 源工程(只读参考):`D:\repos\相册浏览器`

### 关键文件速查

- 模型:`src/models/{SmartFolder,SmartFile,TreeNode}.js`
- 服务:`src/services/{filesystem,scanCache,handleStore,db,thumbnail,thumbnail-strategies,metadata,operations,fileOps,recovery}.js`
- 并发原语(本轮新):`src/utils/concurrency.js`
- store:`src/stores/{fs,root,modal,...}.js`
- 消费 blobUrl 的 6 处:`src/services/{thumbnail-strategies,metadata}.js`、`src/composables/useModal.js`、`src/components/{AudioPlayer,PhotoCard,MediaModal}.vue`

---

## 一句话总结

**概念层(树镜像 + snapshot + 信任 + 懒缩略图)是对的,留着;执行层的一个根缺陷——SmartFile 把身份/资源(blobUrl)/派生缓存(md5)三重耦合,叠加 model 自改 `this` + 静态注入——是 bug 与性能上限的共同根因。把它拆开(资源池 + 纯 model + 纯列表 scan),响应式陷阱类、blobUrl 生命周期类、"无法纯列表瞬扫"三件事一起消失。分 4 阶段,每阶段独立可验收。**
