# 卡片样式 · detail(上图下信息整卡)— design

> 2026-08-01。批次 3 · R16-c。视觉伴侣 brainstorm 定稿。
> 前批卡片样式(R13 hover/always):见 [批次2 实现总结-续](./2026-08-01-交互改进批次2-实现总结-续.md)。
> 视觉伴侣会话产物:`.superpowers/brainstorm/2705-1785597969/`(card-styles / b-density / b-style)。

## 背景

R13 已落地两种卡片信息样式,都由 `userSettings.cardStyle` 控制,PhotoCard 根元素挂 `card-style-<style>` class:

- **hover**(默认):上下信息条绝对定位**叠在方形缩略图上**,hover 滑入、移开隐藏。
- **always**:同上叠层,但常驻显示;badge/爱心被推到"下移 100%"位置常显。

两种的信息条都是**图片之上的半透明渐变层**。R16-c 要第三种:信息条挪到图片**下方**,成为卡片独立的下半部分——"上图下信息,整体一张卡"。

## 选定方案(视觉伴侣定稿)

经三屏 mockup 迭代确认:**B1 紧凑两行 · 一体式**。

- **布局**:方形缩略图在上 + 下方一条紧凑信息区(两行),信息区紧贴图片、同背景色,**整卡一个圆角块**(图片顶满到卡边,与现状 `photo-card` 一致)。
- **信息区内容**(两行,固定高度):
  - 第 1 行:文件名(单行省略,左对齐)
  - 第 2 行:大小 · 日期(meta 行,与现状 `.card-info-meta` 内容一致)
- **固定高度**:信息区高度固定(虚拟化要求,见下)。文件名超长 → 省略号截断,不撑高。

### 显式排除(不做)

- **C 原图比例瀑布流**:视觉最自然但破坏「按行虚拟化」(行高不再固定),需换瀑布流布局算法,代价过大,不做。
- **B3 分辨率显示**:meta 不加分辨率列(信息密度过高)。
- **爱心 / 媒体角标挪进信息区**:仍保留在图片上(见下)。

## 交互(默认,不再单独确认)

| 元素 | detail 模式行为 |
|---|---|
| 整卡 hover | 仍轻微上浮(`translateY(-6px)` + 大阴影),与 hover/always 一致 |
| ❤ 收藏爱心 | 原位(不 hover 下移);**未收藏默认隐藏、卡片 hover 显空心,已收藏常显实心**(沿用 hover 模式显隐,仅去掉下移) |
| ▶ 媒体角标(视频时长等) | **常驻图上右上角原位**(同上,不下移) |
| md5 备注 | **保留现状**:hover 时胶囊叠在缩略图中央(`.note-overlay`),不进信息区 |
| 文件名点击 | 仍触发 inline 重命名(`RenameInput`,复用现有) |
| 未收藏爱心 | md5 已算但未收藏时:沿用现状规则(收藏按钮 hover 显空心);detail 下因爱心常驻,改为 md5 已算即常驻、未收藏显示空心 |

> 爱心显隐细节:detail 下爱心位置固定原位(不下移),但显隐沿用 hover 模式——未收藏时默认隐藏、卡片 hover 时显空心,已收藏常显实心红。md5 未算仍不显示。

## 实现落点

### 1. 配置 + 设置面板(开关入口)

- [config/index.js](../../src/config/index.js) `DEFAULTS.cardStyle` 注释补 `detail`(值不变,仍默认 `'hover'`)。
- [SettingsPanel.vue](../../src/components/SettingsPanel.vue) `cardStyleOptions` 加一项:
  ```js
  { value: 'detail', label: '图下信息' }
  ```
  分段按钮组自动渲染第三项(已有 `v-for`),无需改模板。

### 2. PhotoCard.vue(CSS 重排,DOM 几乎不动)

现有 DOM 顺序已是 `thumbnail-container → card-info-filename → card-info-meta`,正好是 detail 要的「图 → 文件名 → meta」垂直顺序。**只需用 CSS 把后两者从绝对叠层重排为图下方正常流**:

- `.photo-card.card-style-detail`:
  - `.thumbnail-container`:取消作为绝对定位上下文的效果——实际上保持 `position: relative`(图内子元素 badge/fav/note 仍相对它定位),但其后的信息块改为**正常文档流**(不再绝对定位叠在图上)。
  - `.card-info-filename`:从 `position:absolute; bottom:0; transform:translateY(100%)` 改为 `position: static`;背景渐变换成与卡同色的实底(或透明,继承卡背景);文件名左对齐、单行省略;`min-height` 固定一行。
  - `.card-info-meta`:从 `position:absolute; top:0; transform:translateY(-100%)` 改为 `position: static`;背景渐变换透明(继承卡背景);meta 行保持 flex space-between。
  - `.media-badge` / `.fav-btn`:**撤销 hover 下移**——detail 模式下 `transform: none`(常驻原位);爱心 md5 已算即 `opacity:1`。
  - `.note-overlay`:**不改**(保留 hover 胶囊)。
- 整卡圆角 / overflow hidden / 阴影沿用 `.photo-card` 现有(一体式即"图片顶满卡边 + 信息区同背景",无需额外 padding)。

> 信息区总高度由 CSS 固定(文件名 1 行 + meta 1 行 + padding),记为常量 `DETAIL_INFO_HEIGHT`(实现时按 PhotoCard 实测校准,预期 ~44px)。

### 3. 虚拟化行高(gallery-layout + Gallery)

这是 detail 模式的**核心约束**:[gallery-layout.js:26](../../src/utils/gallery-layout.js#L26) `computeRowHeight` 现返回 `colWidth + gap`(依赖方形图 = 卡高)。detail 模式卡高 = 方形图 + 信息区,行高必须随之增大,否则虚拟化行与实际卡片高度错位、出现重叠/空白。

- [gallery-layout.js](../../src/utils/gallery-layout.js) `computeRowHeight` 增一个参数(如 `extraPerCard = 0`):
  ```js
  return colWidth + extraPerCard + gap;
  ```
  保持纯函数、可单测;`extraPerCard` 由调用方按 cardStyle 决定(detail = `DETAIL_INFO_HEIGHT`,其他 = 0)。doc 注释同步更新"行高 = 列宽 + 信息区 + gap"。
- [Gallery.vue:133](../../src/components/Gallery.vue#L133) `measureRowHeight` 读 `settings.cardStyle`,detail 时把 `DETAIL_INFO_HEIGHT` 作为 `extraPerCard` 传入。
- `DETAIL_INFO_HEIGHT` 常量定义在 gallery-layout.js(PhotoCard 与 Gallery 共用同一来源,避免漂移):export 出来,PhotoCard CSS 用同一数值(或 PhotoCard 只管视觉、Gallery 行高用常量,二者用注释互相指认校准)。

> ponytail: `extraPerCard` 一个参数 + 一个常量,不做"策略对象 / 行高提供者"抽象;未来真有第二种非零 extra 再说。

### 4. 响应式追踪(无需改)

`cardStyle` 走 `useUserSettingsStore`(响应式),PhotoCard 的 `cardStyleClass` 已是 computed,设置面板切换即时生效。Gallery 的 `measureRowHeight` 需在 `cardStyle` 变化时重算 → 加 `watch(cardStyle, measureRowHeight)`(若现有 watch 未覆盖)。

## 测试

- [gallery-layout.test.js] 补用例:`computeRowHeight(w, cols, gap, DETAIL_INFO_HEIGHT)` 返回 `colWidth + DETAIL_INFO_HEIGHT + gap`;`extraPerCard=0` 时与旧公式一致(回归)。
- 客观断言(可委派子代理 / DOM 核对):detail 模式下 `.card-info-filename` / `.card-info-meta` 的 `position` 为 `static`、`.media-badge` 的 `transform` 为 `none`。
- 主观验收(用户本人浏览器):信息区观感、行高无错位、爱心/角标常驻位置、切换样式流畅。

## 影响面 / 风险

- **行高公式改动**是唯一触及虚拟化核心的点;纯函数 + 单测兜底,风险可控。
- detail 模式下行高变大 → 同样视窗可见行数减少(预期,用户已知密度换信息)。
- 不动 hover/always 两种既有样式(`extraPerCard=0` 回归原公式)。
