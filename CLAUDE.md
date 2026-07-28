# 相册浏览器 PWA

纯本地处理的相册浏览器。从原生 JS（~17000 行）重构为 Vue3 + Vite + Pinia。
**纯本地文件处理、不联网**（File System Access API，仅 Chrome/Edge/Opera）。

## 技术栈

- **Vue 3**（`<script setup>`，纯 JS，无 TypeScript）
- **Vite 5** + 双 build：`vite.config.js`（单 HTML）/ `vite.config.pwa.js`（PWA）
- **Pinia**（setup store 风格）
- **资源全内化**（零 CDN）：`@fortawesome/fontawesome-free` / `spark-md5` / `exifr` 均 npm 装 + ES import
- **idb-keyval**：轻量 KV over IndexedDB（多文件夹句柄 + 扫描快照持久化）
- **@tanstack/vue-virtual**：Gallery 按行虚拟化（万图不卡，整页滚动 + 实测行高）
- **质量基建**：`@antfu/eslint-config`（ESLint flat config）+ Vitest + `@vue/test-utils` + jsdom

## 常用命令

```bash
npm run dev        # 开发（用户跑）
npm run build      # 单 HTML(dist/index.html 自包含,可 file:// 离线)
npm run build:pwa  # PWA(SW + manifest,可安装/离线)
npm run icons      # 从 public/icon.svg 生成 192/512 PNG(@resvg/resvg-js)
npm run lint       # ESLint 检查(@antfu/eslint-config)
npm run lint:fix   # 自动修格式
npm run test       # Vitest 跑测试
npm run test:watch # 监听模式
```

## 目录结构

```
src/
├── main.js              # createApp + Pinia + 全局 CSS + font-awesome
├── App.vue              # 根布局(启动页/主界面 + 全局浮层 + 启动恢复多根)
├── config/              # CONFIG + UserSettings、FileTypes(纯数据)
├── models/              # SmartFile/SmartFolder(纯数据类+派生 getter)+ 同文件模块函数(scanFolder/enrichFolder/snapshot/CRUD/validate,P3 函数化)
├── services/            # fileResource(资源池) / filesystem(scan 整合+持久化调度) / handleStore(多根句柄) / scanCache(快照) / thumbnail+thumbnail-strategies(createImageBitmap) / metadata / db / recovery / operations(.trash) / fileOps / exif / gps / id3-parser
├── stores/              # Pinia: fs(含 rootDirty) / root(多根元数据) / modal / theme / userSettings / history / contextMenu / confirm / properties / uiToast
├── composables/         # useThumbnail / useModal / useSidebar(边缘拖拽调宽) / useScrollZone / useGallerySearch / useStorageEstimate
├── utils/               # concurrency(runConcurrent + cancelToken) / gallery-layout(虚拟化布局纯函数) / format / file(calculateMD5) / browser
├── components/          # Gallery(按行虚拟化) / PhotoCard / Sidebar / RootSwitcher / SidebarTreeItem / MediaModal / AudioPlayer / SettingsPanel / PropertiesPanel / ContextMenu / ConfirmDialog / Toast / BrowserUnsupportedWarning
└── styles/              # 全局 CSS(main.js import,组件用其 class)
docs/superpowers/        # specs(设计 + 实现记录)+ plans(实施计划)
后续待办.md              # 跨阶段遗留事项
改造路线图.md            # 重构后的改进路线(质量基建/句柄持久化/多文件夹/约定现代化)
```

## 关键约定（请遵守）

1. **model 层纯数据 + 模块函数、副作用归 service**（`models/` 不 import Pinia/Vue、不反向依赖 store）：
   - `SmartFile`/`SmartFolder` 是**纯数据类**（字段 + 派生 getter，无实例方法，P3 函数化）；所有行为是**同文件模块级函数**：`scanFolder` / `enrichFolder` / `folderToSnapshot` / `folderFromSnapshot` / `createFolder` / `validateFolder` / `ensureBlobUrl` / `renameFile` / `moveFile` / `disposeFile` 等。`scanFolder(folder,{trust})` 是纯函数——不改入参、不碰 `foldersData`、不 dispose，返回 `{files, subFolders, newFiles, newSubFolders, removedFiles, removedFolders}`。模板用的 getter（`path`/`isEmpty`/`name`/`size`/`blobUrl` 等）保留——Vue 响应式追踪属性访问，**勿函数化**。
   - **副作用集中 service 层**：`integrateScanResult(folder,result,fs)`（写回**代理** folder + 注册/删 foldersData + `disposeFile` removedFiles + 检测增删置 `rootDirty`）、`registerFolderTree`、`resetFoldersData`、`registerAndIntegrate`（P0-2：收口"set 进 Map→get 取代理→integrate"，新建 folder 必走）。⚠️ **写回必须是「代理」**（从 store 取或 `foldersData.get(path)`）；`createFolder` 返回的原始对象直接写回不触发响应式（见下方 reactive 陷阱）。
2. **service 层操作 store**：`services/` 内部 `useFsStore()` / `useToastStore()` 等直接调（在函数体内，不在模块顶层）。
3. **资源走 fileResource 池**（[fileResource.js](src/services/fileResource.js)）：blobUrl/File 集中管理（`acquire`/`destroy`/`peek`，带 in-flight 去重 + inflight cancel）。SmartFile 是池的门面（`blobUrl`/`size`/`lastModified` 是 getter）。**不要直接 `URL.createObjectURL`/`revokeObjectURL`**；size/mtime 单源在 `SmartFile._meta`（响应式），不进池。
4. **持久化走 schedulePersist**：改树（scan 命中增删 / rename / delete / move）由 `integrateScanResult` 或 `history` 置 `fs.rootDirty=true` + `schedulePersist(id)`（1s debounce 合并写，不阻塞点击）。**不要直接 `saveScan`**。切根前 `flushPendingPersist` 落盘旧根（reload 用 `cancelPendingPersist`——重扫从盘重建）；`persistIfDirty` 仅 dirty 时 `folderToSnapshot`+`countAllFiles`。关浏览器/切后台由 `visibilitychange:hidden` 触发 `flushPendingPersist` 兜底（P0-3）。
5. **CSS 全局复用**：`src/styles/` 的全局 CSS（`main.js` 全局 import）。组件**不重写这些 CSS**，模板直接用其 class（如 `.photo-card` / `.gallery-row` / `.tree-node` / `.modal-audio-player`）。组件 scoped 样式只补 CSS 里没有的。
6. **核心算法稳定**：scan 纯列表差集 + 信任名字集合短路、enrich 并发 getFile 补 size/mtime、GPS（魔数）、ID3、`.trash` 镜像回收站、calculateMD5（前 2MB 缓存键——**内容寻址：跨文件夹/复制副本的同图共享一份缩略图缓存（size+mtime 做不到，mtime 随复制变）；md5 随快照持久化 → 秒切零重算；按需计算（视窗触发）非万张预扫。chunkSize 锁定保旧 IDB key 兼容，不动**）。后续改动配测试。
7. **跨组件状态进 Pinia store；组件私有状态用 `ref`/`reactive`**。
8. **主题切换**：`useThemeStore.applyTheme` 用 `document.documentElement.style.setProperty` 注入 CSS 变量（切主题先清残留再设新值，见 [theme.js](src/stores/theme.js)）。

> import 风格：相对 import 省略 `.js` 扩展名（Vite 默认解析，`.vue` 同样省略）。

> 并发：getFile 批处理 / 后台目录遍历用 `runConcurrent`（[concurrency.js](src/utils/concurrency.js)，并发上限 + 错误隔离）；后台遍历带 `makeCancelToken`，切根时 bump token 退出在途任务。

> ⚠️ **Vue3 reactive 陷阱**：后台异步任务改 store 对象时**必须从 store 取代理**（`fs.rootFolder` / `foldersData.get(path)`），不要用 `createFolder` / `initProject` 返回的原始对象——改原始对象不触发响应式（子目录停在半透明不更新）。新建 folder 一律走 `registerAndIntegrate`（set 进 reactive Map 取代理再 integrate，P0-2 收口）；`scanAndPersist`/`flushPendingPersist` 内部已统一 `useFsStore().rootFolder` 取代理。详见 [架构重构 round1 spec](docs/superpowers/specs/2026-07-28-架构重构-资源层分离与纯model-design.md) + [round4 model 函数化](docs/superpowers/specs/2026-07-29-架构重构-round4-第一性原理审查与model函数化.md)。

## 双 build

- **单 HTML**（`vite-plugin-singlefile`）：所有 JS/CSS/字体 base64 内联进单个 `dist/index.html`，可 `file://` 双击离线运行。
- **PWA**（`vite-plugin-pwa`）：独立外链 SW + manifest（无法内联进单 HTML，故两套 config）。`workbox.globPatterns` 含 `woff2`（字体进预缓存）。

两套 build 共用 `dist/`，验证时注意先清。

## 多文件夹（秒切换 + 按需校验）

打开过的根文件夹记录在 IDB，可在 Sidebar 顶部 RootSwitcher 切换 / 移除 / 打开新。切换用 `scanCache` 缓存的扫描快照（`SmartFolder.fromSnapshot` 秒重建，零 IO）显示；后台 `rootEagerScan` 只扫 root 一层（顶层增删即时），深层 `handleFolderClick` 按需 trust 校验（名字集合一致零 IO）；变更（`rootDirty`）才 `schedulePersist` 落盘，切根前 `flushPendingPersist` 保旧根。运行时仍单根（一次一个 currentRoot）。详见 [多文件夹设计](docs/superpowers/specs/2026-07-28-多文件夹管理-design.md) + [round2 扫描优化](docs/superpowers/specs/2026-07-28-架构重构-round2-精修与扫描优化.md)。

## 后续待办

见 [后续待办.md](后续待办.md) + [改造路线图.md](改造路线图.md)。每轮验收后追加。

## 文档

- 设计总纲：`docs/superpowers/specs/2026-07-27-相册浏览器重构-design.md`
- 迁移完整性审查：`docs/superpowers/specs/2026-07-27-迁移完整性审查.md`（重构后对比原版的差异 / 修复 / 约定现代化）
- 多文件夹管理设计：`docs/superpowers/specs/2026-07-28-多文件夹管理-design.md`
- 架构重构（资源层分离 + 纯 model + 纯列表 scan）：`docs/superpowers/specs/2026-07-28-架构重构-资源层分离与纯model-design.md` + 进度记录 + round2（虚拟化 / 扫描优化）+ round3（性能 polish）及各实现记录
- 改造路线图：`docs/改造路线图.md`
- 各阶段实施计划：`docs/superpowers/plans/`
- 源工程（只读参考）：`D:\repos\相册浏览器`（原生 JS 原版）
