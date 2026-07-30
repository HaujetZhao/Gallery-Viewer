# T14c · modal + sidebar scoped 迁移(拆多组件)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](../2026-07-29-技术债治理-总规划.md)
> ⚠️ **基于 master(含 T14b)**:开工前确认 `debt/T14b` 已合并 master。

**Goal:** modal.css + sidebar.css 按归属拆进各自组件 `<style scoped>`,**视觉零变化**(纯搬家)。

**两个 CSS 都要拆多组件(比 T14b 的 1:1 复杂):**
- [modal.css](../../../src/styles/modal.css)(398 行)→ **MediaModal.vue**(L1-98 modal 壳 + 媒体元素 + loader)+ **AudioPlayer.vue**(L100-403 音频播放器)
- [sidebar.css](../../../src/styles/sidebar.css)(217 行)→ **Sidebar.vue**(#sidebar/header/container)+ **SidebarTreeItem.vue**(.tree-node*)+ **RenameInput.vue**(.renaming-input,T12 全局→加 scoped)

**策略(同 T14a/b):** 纯搬家,保留 `var(--*)` + Tailwind preflight 修复 + 动画。

---

## 一、归属核实(执行者动手前 grep 每个选择器)

- [x] **Step 1:grep 每个 class/id 确认归属组件**

```bash
# modal.css 选择器归属
grep -rn "modal-audio-player\|audio-cover\|progress-bar\|control-btn\|volume-slider\|visualizer-bar" src/components/  # 预期:AudioPlayer.vue
grep -rn "modal-content\|modal-media\|modal-image\|svg-container\|modal-video\|\"loader\"" src/components/          # 预期:MediaModal.vue
# sidebar.css 选择器归属
grep -rn "sidebar-resize-handle\|sidebar-header\|pinSidebarBtn\|folderContainer\|separator-line" src/components/    # 预期:Sidebar.vue
grep -rn "tree-node\|tree-sub-list\|folderTreeRoot" src/components/                                                  # 预期:SidebarTreeItem.vue
grep -rn "renaming-input" src/components/                                                                            # 预期:RenameInput.vue
```
**`.modal-audio`(L80)归属存疑**——grep 确认是 MediaModal 的 `<audio>` 还是 AudioPlayer 内,归对应组件。跨组件共用的别盲搬,反馈。

## 二、modal.css 拆 MediaModal + AudioPlayer

- [x] **Step 2:MediaModal.vue 加 scoped(L1-98)**

modal 壳 + 媒体元素搬入 MediaModal.vue `<style scoped>`:`.modal`/`.modal.hidden`/`.modal-content`/`.modal-media`/`.modal-image`/`#modalImage`/`.svg-container`(+svg)/`.modal-video`/`.modal-audio`(grep 定归属)/`.loader`/`.loader.hidden`。
> ⚠️ **保留 `#modalImage/.modal-image` 的 `max-width: none`**(L43-51)——这是 b13c89a 修的 Tailwind preflight 回归(modal 大图被钳高瘦),**勿删**。

- [x] **Step 3:AudioPlayer.vue 加 scoped(L100-403)**

音频播放器搬入 AudioPlayer.vue `<style scoped>`:`.modal-audio-player`/`.audio-player-wrapper`/`.audio-cover*`/`.cover-*`/`.audio-visualizer`/`.visualizer-bar`/`.audio-info`/`.audio-title`/`.audio-artist`/`.audio-album`/`.audio-controls`/`.progress-*`/`.time-display`/`.control-*`/`.play-btn`/`.volume-*`/`.audio-element` + `@media max-width:600px`。

- [x] **Step 4:删 modal.css + main.css `@import 'modal.css'`**

## 三、sidebar.css 拆 Sidebar + SidebarTreeItem + RenameInput

- [x] **Step 5:Sidebar.vue 加 scoped**

`#sidebar`/`#sidebar-content`/`.sidebar-resize-handle`/`#sidebar::after`/`#sidebar:hover`/`#sidebar.pinned`/`.sidebar-header`/`.sidebar-header h3`/`#pinSidebarBtn`/`#virtualContainer`/`#folderContainer`(+scrollbar/ul)/`.separator-line` + `@media max-width:768px`。
> id 选择器 scoped:`#sidebar[data-v]` 仍匹配 Sidebar 根元素(元素同时有 id + data-v)。

- [x] **Step 6:SidebarTreeItem.vue 加 scoped**

`.tree-sub-list`/`.tree-node`(+ `.root-node`/`.context-menu-active`/`.active`/`.drag-over`/`.empty-folder`)/`.tree-node-count`/`#folderTreeRoot`(grep 定归属)。

- [x] **Step 7:RenameInput.vue 加 scoped(移 .renaming-input)**

T12 时 `.renaming-input` 在 sidebar.css 全局(token 化)。T14c 移入 RenameInput.vue `<style scoped>`(RenameInput 加 scoped)。RenameInput 被 PhotoCard/PropertiesPanel 嵌入,scoped 随实例应用。

- [x] **Step 8:删 sidebar.css + main.css `@import 'sidebar.css'`**

---

## 四、验收

- [x] **Step V.1:视觉零变化**
大图 modal / SVG / 视频 / **音频播放器(封面/可视化/进度/控制/音量)** / 侧栏(展开/折叠/拖拽调宽/pin/树节点状态/拖拽接收)/ 重命名框 → 全部与 T14c 前一致。
- [x] **Step V.2:双 build + 测试 + Lint**
```bash
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
npm test && npm run lint
```
- [x] **Step V.3:grep 确认**
```bash
ls src/styles/modal.css src/styles/sidebar.css  # 不存在
grep -n "modal.css\|sidebar.css" src/styles/main.css src/main.js  # 零
```

---

## 五、验收点

**客观断言:** modal.css + sidebar.css 删除;MediaModal/AudioPlayer/Sidebar/SidebarTreeItem/RenameInput 各有 scoped 含对应样式;四绿。

**主观体验(产品负责人,逐项):**
1. 大图 modal(尤其大图不被钳高瘦——preflight 修复保留)+ SVG + 视频。
2. **音频播放器**:封面/可视化/进度条拖拽/播放控制/音量 + 响应式。
3. 侧栏:展开折叠 / 拖拽调宽 / pin / 树节点(hover/active/拖拽接收/空文件夹)/ 重命名框(token 化,亮+dark)。

---

## 六、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T14c

### 改了什么
- [x] MediaModal scoped(modal 壳+媒体+loader,保留 #modalImage max-width:none)
- [x] AudioPlayer scoped(音频播放器 L100-403 + 跨组件 .modal-media)
- [x] Sidebar scoped(#sidebar/header/container/**#folderTreeRoot** + ALL_MEDIA 的 .tree-node 基础/hover/active)
- [x] SidebarTreeItem scoped(.tree-node* 完整块/.tree-sub-list/.tree-node-count)
- [x] RenameInput scoped(.renaming-input)
- [x] 删 modal.css + sidebar.css + main.css 两处 @import

### .modal-audio 归属(grep 核实)
- **死代码,删而非搬**:grep 全 src 无 `class="modal-audio"`(仅 `modal-audio-player`);audio 已走 AudioPlayer 组件,useModal.js 的 `closest(...)` 用的是 `audio` 标签 + `.modal-audio-player`。原 L80 规则无人命中,删后视觉零变化。

### 验收基线
- lint ✅  test ✅(15 文件/95 例)  build ✅(单 HTML 1.04s,1.42MB)  build:pwa ✅(914ms,SW + manifest + woff2 预缓存 14 条)

### 视觉零回归(产品负责人) — 待验收
- 大图 modal / 音频播放器 / 侧栏 / 树 / 重命名框:待产品负责人上手验收

### 遗留 / 风险 / 偏离
1. **`.modal-audio` 死代码删除**(非盲搬):grep 确认无使用,ponytail 删除优先。
2. **`.modal-media` 跨组件共用**:MediaModal 的 img/video/svg + AudioPlayer 根 div 都带此类 → 两边 scoped 各放一份(不漏 AudioPlayer 根 div)。
3. **`.tree-node` 跨组件共用**:Sidebar 的 ALL_MEDIA li + SidebarTreeItem li 都用 → 基础+hover+active 进 Sidebar.vue,完整块(含 root-node/drag-over/empty-folder/tree-node-count/tree-sub-list)进 SidebarTreeItem.vue。
4. **`.svg-container svg` → `.svg-container :deep(svg)`**:svg 由 `v-html="svgText"` 注入(无 data-v),裸后代选择器 scoped 编译后匹配不到,必须 `:deep` 穿透。行为/视觉零变化。
5. **`#folderTreeRoot` grep 修正归 Sidebar.vue**(模板 [Sidebar.vue:46](src/components/Sidebar.vue#L46) `<ul id="folderTreeRoot">`),非文档 Step6 猜测的 SidebarTreeItem。
6. **`#folderContainer ul` 合并 + 删死选择器**:原 `#folderContainer ul, .virtualContainer ul` 中 `.virtualContainer ul` 是死选择器(模板是 `id=virtualContainer` 非 class),合并为单条 `#folderContainer ul{list-style/padding/border}`。
7. **preflight `max-width:none` 保留**(b13c89a 修复,`#modalImage/.modal-image`),注释里标注出处,勿删。
8. **renaming-input scoped 后嵌入正常**:RenameInput 是独立组件,scoped data-v 随自身实例应用,被 PhotoCard([L96](src/components/PhotoCard.vue#L96))/PropertiesPanel([L144](src/components/PropertiesPanel.vue#L144)) 嵌入时样式正常,不依赖父组件 scoped。
9. **id 选择器 scoped 安全**:`#sidebar[data-v]`/`#pinSidebarBtn[data-v]`/`#folderTreeRoot[data-v]` 等仍匹配(元素同时有 id + data-v)。
10. **commit**:a29b039 refactor(7 文件 +567/-471,git 识别 sidebar.css→Sidebar.vue 57% rename)。
```

---

## 七、执行者注意

1. **先 grep 核实归属**(Step 1)——modal.css/sidebar.css 都拆多组件,边界靠 grep 定。`.modal-audio`/`#folderTreeRoot` 等存疑的务必 grep。
2. **保留 `#modalImage/.modal-image` 的 `max-width: none`**(b13c89a 修的 preflight 回归,勿删,否则大图高瘦)。
3. **id 选择器 scoped 安全**——`#sidebar[data-v]` 仍匹配(元素有 id + data-v)。
4. **.renaming-input 移 RenameInput scoped**(T12 全局→T14c scoped);RenameInput 被 PhotoCard/PropertiesPanel 嵌入,scoped 随实例应用,验证两处重命名框样式正常。
5. 纯搬家,视觉零回归是硬指标。
6. 双 build 分别 `rm -rf dist`。
