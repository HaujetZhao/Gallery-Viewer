# 相册浏览器 PWA

纯本地处理的相册浏览器。从原生 JS（~17000 行）重构为 Vue3 + Vite + Pinia。
**纯本地文件处理、不联网**（File System Access API，仅 Chrome/Edge/Opera）。

## 技术栈

- **Vue 3**（`<script setup>`，纯 JS，无 TypeScript）
- **Vite 5** + 双 build：`vite.config.js`（单 HTML）/ `vite.config.pwa.js`（PWA）
- **Pinia**（setup store 风格）
- **资源全内化**（零 CDN）：`@fortawesome/fontawesome-free` / `spark-md5` / `exifr` 均 npm 装 + ES import
- **idb-keyval**：轻量 KV over IndexedDB（多文件夹句柄 + 扫描快照持久化）
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
├── models/              # SmartFile / SmartFolder(scan 增量 + toSnapshot/fromSnapshot rehydrate) / TreeNode(纯数据节点)
├── services/            # db / filesystem(switchToRoot) / handleStore(多根句柄) / scanCache(扫描快照) / recovery / thumbnail / metadata / id3 / gps / exif / operations(.trash) / fileOps
├── stores/              # Pinia: fs / root(多根元数据) / modal / theme / userSettings / history / contextMenu / confirm / properties / uiToast
├── composables/         # useThumbnail / useModal / useSidebar(边缘拖拽调宽) / useScrollZone / useGallerySearch / useStorageEstimate
├── components/          # Gallery / PhotoCard / Sidebar / RootSwitcher / SidebarTreeItem / MediaModal / AudioPlayer / SettingsPanel / PropertiesPanel / ContextMenu / ConfirmDialog / Toast / BrowserUnsupportedWarning
└── styles/              # 全局 CSS(main.js import,组件用其 class)
docs/superpowers/        # specs(设计)+ plans(实施计划)
后续待办.md              # 跨阶段遗留事项
改造路线图.md            # 重构后的改进路线(质量基建/句柄持久化/多文件夹/约定现代化)
```

## 关键约定（请遵守）

1. **model 层保持纯逻辑**（`models/` 不 import Pinia/Vue）。`SmartFolder.appState` 由 `stores/fs.js` 静态注入（`SmartFolder.appState = { get rootHandle(), get foldersData() }`），避免 model 反向依赖 store。SmartFile/SmartFolder 的 `toSnapshot`/`fromSnapshot`（rehydrate，多文件夹秒切换用）是纯数据操作，符合此约定。
2. **service 层操作 store**：`services/` 内部 `useFsStore()` / `useToastStore()` 等直接调（在函数体内，不在模块顶层）。
3. **CSS 全局复用**：`src/styles/` 的全局 CSS（`main.js` 全局 import）。组件**不重写这些 CSS**，模板直接用其 class（如 `.photo-card` / `.masonry-col` / `.tree-node` / `.modal-audio-player`）。组件 scoped 样式只补 CSS 里没有的。
4. **核心算法已迁移稳定**：scan 增量、GPS 坐标转换（魔数）、ID3 解析、`.trash` 镜像回收站、calculateMD5（前 2MB 缓存键）已照搬并验证；后续改动需配测试。
5. **跨组件状态进 Pinia store；组件私有状态用 `ref`/`reactive`**。
6. **主题切换**：`useThemeStore.applyTheme` 用 `document.documentElement.style.setProperty` 注入 CSS 变量（切主题先清残留再设新值，见 [theme.js](src/stores/theme.js)）。

> import 风格：相对 import 省略 `.js` 扩展名（Vite 默认解析，`.vue` 同样省略）。

> ⚠️ **Vue3 reactive 陷阱**：后台异步任务（如 `startBackgroundScan`）改 store 中的对象时，**必须从 store 取代理引用**（如传 `fs.rootFolder`），不要持有原始对象——改原始对象不触发响应式，UI 不更新。详见 [多文件夹设计](docs/superpowers/specs/2026-07-28-多文件夹管理-design.md) 的扫描响应式修复记录。

## 双 build

- **单 HTML**（`vite-plugin-singlefile`）：所有 JS/CSS/字体 base64 内联进单个 `dist/index.html`，可 `file://` 双击离线运行。
- **PWA**（`vite-plugin-pwa`）：独立外链 SW + manifest（无法内联进单 HTML，故两套 config）。`workbox.globPatterns` 含 `woff2`（字体进预缓存）。

两套 build 共用 `dist/`，验证时注意先清。

## 多文件夹（秒切换）

打开过的根文件夹记录在 IDB，可在 Sidebar 顶部 RootSwitcher 切换 / 移除 / 打开新。切换用 `scanCache` 缓存的扫描快照（`SmartFolder.fromSnapshot` 秒重建）+ 后台 scan 校验一致性。运行时仍单根（一次一个 currentRoot）。详见 [多文件夹设计](docs/superpowers/specs/2026-07-28-多文件夹管理-design.md)。

## 后续待办

见 [后续待办.md](后续待办.md) + [改造路线图.md](改造路线图.md)。每轮验收后追加。

## 文档

- 设计总纲：`docs/superpowers/specs/2026-07-27-相册浏览器重构-design.md`
- 迁移完整性审查：`docs/superpowers/specs/2026-07-27-迁移完整性审查.md`（重构后对比原版的差异 / 修复 / 约定现代化）
- 多文件夹管理设计：`docs/superpowers/specs/2026-07-28-多文件夹管理-design.md`
- 改造路线图：`docs/改造路线图.md`
- 各阶段实施计划：`docs/superpowers/plans/`
- 源工程（只读参考）：`D:\repos\相册浏览器`（原生 JS 原版）
