# T14d · components / layout / theme-selector scoped 迁移(T14 最后一批)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](../2026-07-29-技术债治理-总规划.md)
> ⚠️ **基于 master(含 T14c)**:开工前确认 `debt/T14c` 已合并 master。

**Goal:** 把剩余全局 CSS(components.css / layout.css / theme-selector.css)按归属搬进 App / SettingsPanel / Toast 的 `<style scoped>`,**base.css 留全局**(reset/body)。**视觉零变化**。完成后全局表只剩 base.css + variables + tailwind-theme。

**归属(架构师读 4 CSS 核实):**
- **App.vue scoped**(新):components.css 启动页(L1-133)+ settings-btn(L135-166)+ filter(L168-209)+ **layout.css 全部**(header/footer/main-content-wrapper/container)
- **SettingsPanel.vue scoped**(新):components.css settings-modal(L211-397)+ **theme-selector.css 全**
- **Toast.vue scoped**(新):components.css #toastContainer/.toast/* + @keyframes(L433-503)
- **scrollZone**(L399-431):grep 确认归属(疑似死代码,见注意)
- **base.css 留全局**:reset `*` / body / noscript / :focus-visible —— 不 scoped(全局基础)

**策略:** 纯搬家,保留 `var(--*)` + 硬编码(#2C3E50 等留,令牌化不在 T14 范围)+ 动画。

---

## 一、归属核实

- [ ] **Step 1:grep 确认归属 + scrollZone 死代码**

```bash
grep -rn "scrollZone\|topScrollZone\|bottomScrollZone" src/  # 确认有无 DOM 元素(useScrollZone 用 window.scrollBy,可能无元素)
grep -rn "intro-content\|settings-btn\|filter-container\|main-content-wrapper" src/components/App.vue  # 启动页/按钮/布局归 App
grep -rn "settings-modal\|theme-option\|theme-preview" src/components/SettingsPanel.vue  # 设置/主题归 SettingsPanel
grep -rn "toastContainer\|toast-success" src/components/Toast.vue  # toast 归 Toast
```
若 `.scrollZone` 无 DOM 元素(useScrollZone 不创建)→ **死代码,删**(ponytail)。

## 二、App.vue 加 scoped

- [ ] **Step 2:App.vue 末尾加 `<style scoped>`**,搬入:
  - components.css 启动页:`#hint`/`.intro-content`(+hover/i/h1/p)/`.features`/`.feature` + `@media 768/480`
  - components.css settings-btn:`.settings-btn`/`body.sidebar-pinned .settings-btn`/`.settings-btn:hover`/`.settings-btn i`
  - components.css filter:`.filter-container`(+input/:focus)/`.filter-count`
  - **layout.css 全部**:`.header`/`.footer`/`.main-content-wrapper`/`body.sidebar-pinned .main-content-wrapper`/`.container` + `@media 768`
  - App.vue 现有 scoped(启动页 root-history/restore-card)合并。
> ⚠️ `body.sidebar-pinned` 是 body 级(App 设 body class),scoped 不给 body 加 data-v → `body.sidebar-pinned .settings-btn[data-v]` 仍匹配(类似 T14b 的 `[data-theme]`)。

## 三、SettingsPanel.vue 加 scoped

- [ ] **Step 3:SettingsPanel.vue 加 `<style scoped>`**,搬入:
  - components.css settings-modal:`.settings-modal`(+show)/`.settings-header`/`.drag-handle`/`.settings-body`/`.setting-item`/`.info-*`/`.button-group`/`.btn-block`(+warning/danger)/`.separator`/`.setting-item label/select/input[range]/span`/`.btn-small`
  - **theme-selector.css 全部**:`.settings-section`/`.theme-selector`/`.theme-option`/`.theme-preview`(+ocean/dark/forest)/`.theme-name`

## 四、Toast.vue 加 scoped

- [ ] **Step 4:Toast.vue 加 `<style scoped>`**,搬入 components.css:`#toastContainer`/`.toast`/`.toast-success/-warning/-error/-info`/`.toast-icon` + `@keyframes toastFadeInOut`。
> ⚠️ **@keyframes scoped**:Vue scoped 对 `@keyframes` 可能加 hash 或留全局名。**必须验证 toast 淡入淡出动画正常**。若动画断(@keyframes hash 与 animation 引用不同步),用 `:global(@keyframes toastFadeInOut)` 或把 @keyframes 留全局。

## 五、删 CSS + base.css 留全局

- [ ] **Step 5:删 components.css / layout.css / theme-selector.css + main.css @import**。base.css **保留**(reset/body/noscript/:focus-visible 全局),main.css 保留 `@import 'base.css'`。

---

## 六、验收

- [ ] **Step V.1:视觉零变化**
启动页(intro/features/响应式)+ settings-btn(hover 旋转)+ filter(搜索框 focus 展开)+ 设置弹窗(拖拽/控件/主题选择器预览)+ Toast(动画)+ 布局(header/footer/sidebar-pinned margin)→ 全部与 T14d 前一致。
- [ ] **Step V.2:双 build + 测试 + Lint**
```bash
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
npm test && npm run lint
```
- [ ] **Step V.3:grep 确认**
```bash
ls src/styles/components.css src/styles/layout.css src/styles/theme-selector.css  # 不存在
grep -n "components.css\|layout.css\|theme-selector.css" src/styles/main.css src/main.js  # 零
ls src/styles/base.css  # 保留(全局 reset/body)
```

---

## 七、验收点

**客观断言:** components/layout/theme-selector 删除;base.css 保留;App/SettingsPanel/Toast 加 scoped;四绿。

**主观体验(产品负责人,逐项):**
1. 启动页(intro 卡片/features/响应式 768/480)+ 「打开上次」/历史根列表。
2. settings-btn(hover 旋转)+ filter(搜索 focus 展开)+ sidebar-pinned 时位置。
3. 设置弹窗(拖拽/排序/列数/缩略图质量/感应滚动/主题选择器预览/缓存按钮)。
4. Toast(淡入淡出动画,**亮+dark**)。
5. 布局(header/footer/sidebar-pinned 主内容 margin)。

---

## 八、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T14d

### 改了什么
- [x] App.vue scoped(启动页 #hint/.intro-content/.features + @media 768/480、settings-btn + body.sidebar-pinned、filter-container/.filter-count、layout .header/.footer/.main-content-wrapper/.container + @media 768)
- [x] SettingsPanel.vue scoped(settings-modal 全段 .settings-modal/.show/.settings-header/.drag-handle/.settings-body/.setting-item/.info-*/.button-group/.btn-block(+warning/danger)/.separator/label/select/input[range]/span/label[inactive]/.btn-small + theme-selector.css 全)
- [x] Toast.vue scoped(#toastContainer/.toast/.toast-success/-warning/-error/-info/.toast-icon + @keyframes toastFadeInOut)
- [x] scrollZone 死代码:删(grep 结论:useScrollZone 用 window.scrollBy + rAF,从不创建 DOM;.scrollZone/#topScrollZone/#bottomScrollZone/.top-scroll-zone/.bottom-scroll-zone 全工程零元素命中 → 死代码,删)
- [x] 删 components.css / layout.css / theme-selector.css + main.css 去掉三处 @import;base.css 保留(全局 reset `*`/body/noscript/:focus-visible)

### @keyframes scoped 验证
- toast 动画(淡入淡出):✅(Vue scoped 不给 @keyframes 改名,保持全局名 toastFadeInOut;.toast[data-v] 的 animation 引用仍命中。已在 Toast.vue 留 ponytail 注释说明,断则改 :global)

### body.sidebar-pinned scoped 验证
- sidebar-pinned 时 settings-btn/filter 位置:✅(body 级 class,scoped 不给 body 加 data-v;body.sidebar-pinned .settings-btn[data-v] / .main-content-wrapper[data-v] 仍匹配,同 T14b [data-theme] 模式)

### 验收基线
- lint ✅  test ✅(95 passed)  build ✅(单 HTML 1.42MB)  build:pwa ✅(precache 14 entries)

### 视觉零回归(产品负责人)
- 启动页/settings-btn/filter/设置弹窗/Toast/布局:待产品负责人主观验收(客观:CSS 原样搬家,令牌/硬编码/动画全保留)

### 遗留 / 风险 / 偏离
- scrollZone 死代码已删(ponytail);另发现 .footer-links 同为死代码(全工程无 DOM 命中),随 layout.css 搬迁时一并删,未进 App.vue scoped
- @keyframes 留 scoped 内(标准 Vue 行为,不更名);body.sidebar-pinned 走 data-v 尾选择子仍匹配
- 硬编码 #2C3E50 / #27ae60 / #e74c3c 等原样保留(纯搬家,令牌化不在 T14 范围)
- T14d 完成 = T14 全完:全局表只剩 base.css + variables + tailwind-theme,组件全 scoped(根因 3「全局表反高内聚」解决)
```

---

## 九、执行者注意

1. **base.css 留全局**(reset `*`/body/noscript/:focus-visible 不 scoped)——这是全局基础,scoped 化反而错。
2. **`body.sidebar-pinned` scoped**——body 级,scoped 不给 body 加 data-v,`body.sidebar-pinned .x[data-v]` 仍匹配(同 T14b `[data-theme]`)。验证 sidebar-pinned 时 settings-btn/filter/主内容位置。
3. **@keyframes scoped 是风险点**——Vue scoped 对 @keyframes 处理有边角,必须验证 toast 动画;断则 :global。
4. **scrollZone 疑似死代码**——useScrollZone 用 window.scrollBy 不创建 DOM,grep 确认 `.scrollZone` 有无元素;无则删(ponytail)。
5. **硬编码 #2C3E50 等保留**(纯搬家,令牌化不在 T14)。
6. 视觉零回归(启动页/设置/Toast/布局)是硬指标。
7. 双 build 分别 `rm -rf dist`。
8. **T14d 完成 = T14 完** = 全局表只剩 base.css + variables + tailwind-theme,组件全 scoped(根因 3「全局表反高内聚」解决)。
