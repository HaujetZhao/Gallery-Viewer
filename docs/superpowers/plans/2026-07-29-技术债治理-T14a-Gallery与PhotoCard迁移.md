# T14a · Gallery + PhotoCard scoped 迁移(T14 第一批,混合策略)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](2026-07-29-技术债治理-总规划.md)
> ⚠️ **基于 master(含 T12)**:开工前确认 `debt/T12` 已合并 master。

**Goal:** 把 [gallery.css](../../../src/styles/gallery.css)(260 行)按归属移进 [Gallery.vue](../../../src/components/Gallery.vue) + [PhotoCard.vue](../../../src/components/PhotoCard.vue) 的 `<style scoped>`,**视觉零变化**(纯样式搬家 + scoped 隔离),消灭「样式与组件分离」反高内聚。

**策略(T14 混合:scoped 为主):** gallery.css 已大量令牌化(`var(--*)`),债是「分离」非「令牌不用」。复杂交互(hover 联动滑入/虚拟化布局/gradient/cubic-bezier)保留在 scoped(用 CSS 变量),**不强换 utility**(那样模板塞满 `hover:`/任意值 class,可读性更差、回归风险高)。简单部分后续批次可用 utility。

**Tech Stack:** Vue 3 scoped CSS

---

## 一、样式归属(架构师读 gallery.css 核实)

| 归 Gallery.vue scoped | 归 PhotoCard.vue scoped |
|---|---|
| `.gallery-container` | `.photo-card`(+ `:hover`/`.renaming`/`.context-menu-active`/`.dragging`/`:active`) |
| `.gallery-grid` / `.gallery-track` | `.thumbnail-container` |
| `.gallery-row`(+ `@media max-width:768px` gap) | `.thumbnail-canvas` / `.thumbnail-img` / `.thumbnail-svg` |
| `.empty-state` / `.empty-icon` | `.loading-indicator`(+ `i` / `.hidden`) |
| | `.media-badge`(+ `.badge-gif/svg/video/audio` + hover 联动) |
| | `.card-info-filename` / `.card-info-meta`(+ hover 联动) |
| | `.file-name` / `.file-meta` / `.file-size` / `.file-date`(+ `i`) |

---

## 二、Gallery.vue 加 scoped

- [ ] **Step 1:Gallery.vue 末尾加 `<style scoped>`**,把 gallery.css 的 Gallery 归属样式(上表左列)整段移入(保留 `var(--*)` + `@media`)。

```vue
<style scoped>
.gallery-container { /* 从 gallery.css 搬 */ ... }
.empty-state { ... }
.empty-icon { ... }
.gallery-grid { ... }
.gallery-track { ... }
.gallery-row { ... }
@media (max-width: 768px) {
  .gallery-row { gap: 5px; }
}
</style>
```

> ⚠️ **scoped 注意**:`.gallery-row` 是 Gallery 内的 div,scoped 正常。PhotoCard 是子组件——Gallery scoped **不会**穿透到 PhotoCard 内部(也不需要,PhotoCard 样式归它自己 scoped)。别用 `:deep` 去样式化 PhotoCard。

## 三、PhotoCard.vue 加 scoped

- [ ] **Step 2:PhotoCard.vue 末尾加 `<style scoped>`**,把 gallery.css 的 PhotoCard 归属样式(上表右列)整段移入(保留 `var(--*)` + 复杂动画/伪类联动/gradient)。

```vue
<style scoped>
.photo-card { /* 从 gallery.css 搬,保留 var(--bg-primary)/var(--radius-lg)/var(--shadow-sm)/cubic-bezier */ ... }
.photo-card:hover, .photo-card.renaming, .photo-card.context-menu-active { ... }
.photo-card:active:not(.renaming):not(.context-menu-active) { ... }
.photo-card.dragging { ... }
.thumbnail-container { ... }
.thumbnail-canvas, .thumbnail-img { ... }
/* ... 其余 photo-card 归属样式 ... */
</style>
```

> ⚠️ `.photo-card:hover .media-badge` 这类**同组件内**伪类联动,scoped 正常(scoped 给 .photo-card 和 .media-badge 都加 data 属性,选择器匹配)。`.renaming`/`.context-menu-active`/`.dragging` 是动态 class,scoped 应用 OK。

## 四、删 gallery.css + main.css 引用

- [ ] **Step 3:删除 `src/styles/gallery.css`**(样式已全移入 scoped)。**
```css
/* 删这行 */ @import 'gallery.css';
```

---

## 五、验收

- [ ] **Step V.1:视觉零变化(关键——纯搬家)**
打开任意文件夹 → 画廊网格 / 卡片 / 缩略图 / hover 滑入文件名&meta / 媒体 badge / 拖拽样式 / 空状态,**全部与 T14a 前一致**。逐项对比(可双窗口对比 T14a 前 build)。
- [ ] **Step V.2:双 build + 测试 + Lint**
```bash
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
npm test && npm run lint
```
- [ ] **Step V.3:grep 确认**
```bash
ls src/styles/gallery.css   # 应不存在
grep -n "gallery.css" src/styles/main.css   # 零
```

---

## 六、验收点

**客观断言:**
- gallery.css 删除;main.css 不再 @import;Gallery.vue + PhotoCard.vue 各有 scoped 含对应样式;test/lint/build 四绿。

**主观体验(产品负责人,关键——视觉零回归):**
- 网格布局 / 卡片样式 / hover 滑入(文件名+meta)/ 媒体 badge / 拖拽半透明 / 空状态 → 全部与之前一致。

---

## 七、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T14a

### 改了什么
- [x] Gallery.vue 加 scoped(gallery-container/empty-state/empty-icon/grid/track/row + @media max-width:768px)
- [x] PhotoCard.vue 加 scoped(photo-card 全套状态 + thumbnail-container/canvas/img/svg + loading-indicator + media-badge hover 联动 + badge-* + card-info-filename/meta hover 联动 + file-name/meta/size/date,共 22 条选择器)
- [x] 删 gallery.css(261 行)+ main.css @import
- [x] 顺手修订 Gallery.vue:52 注释悬空引用(gallery.css 已删 → 下方 scoped)

### 涉及文件
- src/components/Gallery.vue(+51 行:scoped + 注释修订)
- src/components/PhotoCard.vue(+217 行:scoped)
- src/styles/gallery.css(删,-261 行)
- src/styles/main.css(删 1 行 @import)

### 验收基线(全绿)
- lint ✅  test ✅(15 文件 / 95 用例)  build ✅(101 modules,dist/index.html 内联)  build:pwa ✅(precache 14 entries)
- grep 确认:src 内零 `gallery.css` 引用;两 .vue 各 1 个 `style scoped` 块

### 视觉零回归(产品负责人逐项 —— 待主观验收)
- 网格/卡片/hover 滑入(文件名+meta)/badge/拖拽/空状态:待产品负责人浏览器上手逐项核对

### 遗留 / 风险 / 偏离
- **scoped 安全性已静态论证(无样式丢失)**:渲染到页面的缩略图元素全是 PhotoCard template 静态 `<canvas/img/object>`(Vue 渲染,带 data-v 属性);`strategy.createThumbnailElement()` 经全项目 grep 确认**零调用点**(源码搬迁遗留死代码,创建的元素从未进 DOM)。故 scoped 选择器 `.thumbnail-canvas[data-v-xxx]` 等能完整匹配渲染元素。
- 动态 class(`.renaming`/`.context-menu-active`/`.dragging`)当前 PhotoCard template 未绑定(死代码预留样式),但 data-v 挂在元素上,未来若有逻辑加这些 class,scoped 照常匹配 —— 照原样搬,不删不改。
- 伪类联动(`.photo-card:hover .media-badge` 等)全在 PhotoCard 单组件内,scoped 应用正常,**未用 :deep**。
- gallery-row gap 双源(scoped CSS gap 15/5 + Gallery.js DESKTOP_GAP/MOBILE_GAP)未统一(文档列为可选,不扩大 T14a);仅修订了指向已删 gallery.css 的悬空注释。
- 未提交 git(等产品负责人主观验收后)。
```

---

## 八、执行者注意

1. **纯搬家,零样式改动**——任何 `var(--*)`/动画/gradient/伪类原样搬,别顺手"优化"(那是后续)。若想改视觉,**停,反馈**。
2. **scoped 不穿透子组件**——Gallery scoped 只样式化 Gallery 自己的元素;PhotoCard 样式在 PhotoCard scoped。别用 :deep。
3. **伪类联动同组件内正常**——`.photo-card:hover .media-badge` 都在 PhotoCard 内,scoped 应用 OK。
4. **视觉零变化是硬指标**——逐项对比,任何偏差说明 scoped 漏了某选择器(可能归属错或需 :deep,反馈)。
5. **gallery-row gap(15/5)与 Gallery.js DESKTOP_GAP/MOBILE_GAP 双源**:scoped 后同组件,可顺手统一(单一源)——但可选,别扩大 T14a。
6. 双 build 分别 `rm -rf dist`。
