# 卡片 Hover 双样式：上浮 / 放大拓展

## 背景

此前所有卡片 hover 都是**上浮**（`translateY(-6px)`）；视频另有「悬浮按原始比例拓展弹出」功能（`<video>` 自身变大、卡片不动）。用户希望把 hover 行为收敛为**全局两种样式、设置面板切换**：

- **上浮(lift，默认)**：保持现状——hover 上提，不拓展。
- **放大(expand)**：不提起来，媒体缩略图按**原始比例**向外弹出覆盖邻卡，露全图。

「放大」覆盖**图片(canvas) + GIF(img) + 视频(video)**。为此缩略图从方形改为**原始比例（最短边 = targetSize）**——否则图片/GIF 无原始比例像素可露全图。旧方形缓存失效、一次性重生成（可接受）。

## 关键约束

- **卡片在网格保持方形占位**（`aspect-ratio:1/1` 容器 + 固定行高虚拟化不动）；原始比例只是「存储形状 + hover 弹出」，不影响布局/行高/虚拟化。
- **展开是纯 overlay**：媒体元素绝对定位 + 居中（`left/top:50% + translate(-50%,-50%)`），脱离文档流不撑高卡片/行。

## 改动

### 1. 设置项 `cardHoverStyle`（`'lift' | 'expand'`，默认 `'lift'`）
- [src/config/index.js](src/config/index.js) `DEFAULTS` 加字段；[SettingsPanel.vue](src/components/SettingsPanel.vue) 分段按钮（上浮/放大）。store 自动继承/持久化。

### 2. 缩略图管线 → 原始比例（最短边 = targetSize）
- [coverFit.js](src/utils/coverFit.js) 新增 `fitOriginalRatioParams(srcW, srcH, targetSize)` → `{dw, dh}`（`ratio = targetSize/min(srcW,srcH)`；注意非 `min(targetSize/srcW,...)` 那是长边）。
- [thumbnail-worker.js](src/services/thumbnail-worker.js)：解码后按 `bitmap` 宽高建原比例画布，满幅 draw。
- [thumbnail-strategies.js](src/services/thumbnail-strategies.js) 主线程兜底同步（图片/视频帧/音频封面）；默认方形图标保持方形。
- **缓存失效**：缓存 key `${md5}_${width}` → 加 `_r` 后缀（[db.js](src/services/db.js) `thumbnailKey`），旧方形自动 miss。
- 显示：`drawBlobToCanvas` 按 blob 尺寸设 canvas → 原比例 canvas；方形容器 `object-fit:cover` 裁切，显示与现状一致。

### 3. PhotoCard 泛化 expand（图片/GIF/视频）
- `readMediaDims(el)`：VIDEO→videoWidth/Height；CANVAS→el.width/height；IMG→naturalWidth/Height；svg→null。
- `mediaDims` ref 由 `watch([loaded, mediaEl])` 填入（媒体加载后）。
- `mediaExpand` computed 复用 `computeVideoExpand(colWidth, w, h)`，条件：hover + `!editing` + expand 样式 + 尺寸齐。**不设整卡在视口限制**（能悬停即可展开）。
- CSS 泛化：`.thumbnail-canvas/.img/.video` 绝对定位+居中+`max-width:none`（破 Tailwind preflight 的 `max-width:100%` 横向钳制）；`.photo-card.media-expanding` 溢出可见 + `min-width/height:0`（防 grid min-content 撑爆）。

### 4. 可见性统一：`isVisible` 观察「卡片」而非媒体元素
- [useThumbnail.js](src/composables/useThumbnail.js)：`playObserver` 从观察 `<video>` 改为观察**卡片根**（`cardElRef`，threshold 1.0=整卡在视口），所有媒体都挂（图片也需 isVisible）。
- 视频播放 `shouldPlay = isVisible && (auto||hover)`——媒体展开后出视口不翻转 isVisible（卡片稳定），无展开边界问题，也免去原先 `mediaExpanded` 状态位与振荡处理。

### 5. 层级（z-index）
- 展开卡/含展开卡的行：**950**（`.photo-card.media-expanding` + `.gallery-row:has(.media-expanding)`——虚拟化行有 transform 创建 z-index:auto 的 stacking context，把卡内 z-index 封在 0，须用 `:has()` 提整行才能盖过侧栏 900）。
- 侧栏 900；设置按钮/搜索框 **1000**、设置面板 **1001**（顶在展开画面上方，可点）。

### 6. 其他
- **重命名不展开**：`mediaExpand` 加 `!editing`（防展开盖住重命名框）。
- **设置面板不触发感应滚动**：SettingsPanel `defineExpose({ panelEl })`，App 纳入 `useScrollZone` 的 `excludeRefs`。

## 复用
- `computeVideoExpand`（gallery-layout.js）任意媒体复用。
- `drawBlobToCanvas`（thumbnail-strategies.js）按 blob 尺寸设 canvas。
- SettingsPanel 分段按钮模式、`useScrollZone` 排除区机制、Tailwind preflight 已知行为。

## 验证
- `npm run lint` / `test`（新增 `fitOriginalRatioParams` 单测）/ `build`。
- 浏览器 + CDP：上浮/放大切换；图片/GIF/视频展开；方形缩略图缓存被 `_r` 替代；无网格撑爆/行高不变；侧栏与顶部 UI 层级；重命名不展开；设置面板不触发感应滚动。

## 后续待办
- 图片展开若因 colWidth>targetSize 放大模糊，可后续在 hover 时用原图 blob 重渲染高分辨率版本（本次不做）。
