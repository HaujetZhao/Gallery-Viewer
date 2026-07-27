# 相册浏览器 PWA

纯本地处理的相册浏览器。从原生 JS（~17000 行）重构为 Vue3 + Vite + Pinia。
**纯本地文件处理、不联网**（File System Access API，仅 Chrome/Edge/Opera）。

## 技术栈

- **Vue 3**（`<script setup>`，纯 JS，无 TypeScript）
- **Vite 5** + 双 build：`vite.config.js`（单 HTML）/ `vite.config.pwa.js`（PWA）
- **Pinia**（setup store 风格）
- **资源全内化**（零 CDN）：`@fortawesome/fontawesome-free` / `spark-md5` / `exifr` 均 npm 装 + ES import

## 常用命令

```bash
npm run dev        # 开发（用户跑）
npm run build      # 单 HTML(dist/index.html 自包含,可 file:// 离线)
npm run build:pwa  # PWA(SW + manifest,可安装/离线)
npm run icons      # 从 public/icon.svg 生成 192/512 PNG(@resvg/resvg-js)
```

## 目录结构

```
src/
├── main.js              # createApp + Pinia + 全局 CSS + font-awesome
├── App.vue              # 根布局(启动页/主界面 + 全局浮层)
├── config/              # CONFIG + UserSettings、FileTypes(纯数据)
├── models/              # SmartFile / SmartFolder(scan 增量) / TreeNode(纯数据节点)
├── services/            # db / filesystem / recovery / thumbnail / metadata / id3 / gps / exif / operations(.trash) / fileOps
├── stores/              # Pinia: fs / modal / theme / userSettings / history / contextMenu / confirm / properties / uiToast
├── composables/         # useThumbnail / useModal / useSidebar / useScrollZone / useGallerySearch / useStorageEstimate
├── components/          # Gallery / PhotoCard / Sidebar / SidebarTreeItem / MediaModal / AudioPlayer / SettingsPanel / PropertiesPanel / ContextMenu / ConfirmDialog / Toast / BrowserUnsupportedWarning
└── styles/              # 搬自源码的 11 个 CSS(全局 import,组件用其 class)
docs/superpowers/        # specs(设计)+ plans(各阶段实施计划)
后续待办.md              # 跨阶段遗留事项(已知小问题 + 修复方向)
```

## 关键约定（请遵守）

1. **model 层保持纯逻辑**（`models/` 不 import Pinia/Vue）。`SmartFolder.appState` 由 `stores/fs.js` 静态注入（`SmartFolder.appState = { get rootHandle(), get foldersData() }`），避免 model 反向依赖 store。
2. **service 层操作 store**：`services/` 内部 `useFsStore()` / `useToastStore()` 等直接调（在函数体内，不在模块顶层）。
3. **CSS 全局复用**：`src/styles/` 的全局 CSS（`main.js` 全局 import）。组件**不重写这些 CSS**，模板直接用其 class（如 `.photo-card` / `.masonry-col` / `.tree-node` / `.modal-audio-player`）。组件 scoped 样式只补 CSS 里没有的。
4. **核心算法已迁移稳定**：scan 增量、GPS 坐标转换（魔数）、ID3 解析、`.trash` 镜像回收站、calculateMD5（前 2MB 缓存键）已照搬并验证；后续改动需配测试。
5. **跨组件状态进 Pinia store；组件私有状态用 `ref`/`reactive`**。
6. **主题切换**：`useThemeStore.applyTheme` 用 `document.documentElement.style.setProperty` 注入 CSS 变量（切主题先清残留再设新值，见 [theme.js](src/stores/theme.js)）。

> import 风格：相对 import 省略 `.js` 扩展名（Vite 默认解析，`.vue` 同样省略）。

## 双 build

- **单 HTML**（`vite-plugin-singlefile`）：所有 JS/CSS/字体 base64 内联进单个 `dist/index.html`，可 `file://` 双击离线运行。
- **PWA**（`vite-plugin-pwa`）：独立外链 SW + manifest（无法内联进单 HTML，故两套 config）。`workbox.globPatterns` 含 `woff2`（字体进预缓存）。

两套 build 共用 `dist/`，验证时注意先清。

## 后续待办

见 [后续待办.md](后续待办.md)——跨阶段遗留事项 + [迁移完整性审查](docs/superpowers/specs/2026-07-27-迁移完整性审查.md)后的待排期项（滚动指示条 / Ctrl+C toast 等）+ 约定现代化方向。每轮验收后追加。

## 文档

- 设计总纲：`docs/superpowers/specs/2026-07-27-相册浏览器重构-design.md`
- 迁移完整性审查：`docs/superpowers/specs/2026-07-27-迁移完整性审查.md`（重构后对比原版的差异 / 修复 / 约定现代化）
- 各阶段实施计划：`docs/superpowers/plans/`
- 源工程（只读参考）：`D:\repos\相册浏览器`（原生 JS 原版）
