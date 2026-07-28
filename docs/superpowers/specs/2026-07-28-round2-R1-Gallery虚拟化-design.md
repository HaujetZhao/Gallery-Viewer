# Round 2 · R1:Gallery 虚拟化(万图不卡)

日期:2026-07-28
状态:设计已用户认可,待转 writing-plans 出实施计划
前置:
- round2 总文档:[2026-07-28-架构重构-round2-精修与扫描优化.md](./2026-07-28-架构重构-round2-精修与扫描优化.md)(Part 3 / R1)
- 重构进度(Phase 1-4 已完成):[2026-07-28-架构重构-进度记录.md](./2026-07-28-架构重构-进度记录.md)
参考实现:`C:\Users\Haujet\Desktop\英语学习\src\components\SentenceList.vue`(`@tanstack/vue-virtual` 动态行高用法;本项目取其更简的**固定行高**形态)

本文档自包含。新窗口先读本文件即可动手,不需回看聊天记录。

---

## 背景与目标

round2 三条线之一(Part 3 / R1)。**「万图不卡」是渲染层问题,不是扫描层**——扫描优化(R2/R3)管打开/切换快,本 R1 管一个文件夹里有上万图时滚动/显示不卡。两者是不同杠杆,都要做才达「万图不卡 + 消除不必要扫描」。

**目标**:Gallery 只渲染可视区(+overscan)的卡片,而非全量挂载。万图场景下 DOM 节点数 / IntersectionObserver 注册数 / canvas 数从 O(N) 降到 O(可视区)。

## 现状(为什么万图卡)

[Gallery.vue](../../../src/components/Gallery.vue) 无虚拟化:

- `displayFiles` 全量 → `columns` 列优先分桶(`cols[i % n].push(f)`)→ 每个文件挂一个 [PhotoCard](../../../src/components/PhotoCard.vue)。
- 每个 PhotoCard 经 `useThumbnail` 注册一个全局 IntersectionObserver target(canvas/img/object 元素)。
- 万图 = 万个组件实例 + 万个 observer target + 万个 canvas → 内存爆 + 首帧卡 + 滚动卡。

> 注:[gallery.css](../../../src/styles/gallery.css) 的 `.photo-card { content-visibility:auto; contain-intrinsic-size:auto var(--estimated-height) }` 是「穷人虚拟化」——浏览器跳过不可见卡片的**绘制**,但 **DOM 节点 / observer / 组件实例仍全量挂载**,所以没解决内存与首挂成本。本 R1 用真正的虚拟化接管(D6 移除它)。

**好消息(决定方案形态的关键)**:卡片高度是**固定**的——`.thumbnail-container { aspect-ratio:1/1; width:100% }`(高=列宽),`.card-info-filename/-meta` 是 `position:absolute` 不占文档流。所以每张卡片文档流高度 = 列宽,全局统一。固定行高均匀网格 → 虚拟化最简形态,**连参考实现 SubTap 那套 `measureElement` 动态测高都不需要**(估高永远准,无「向上滚估高→实测修正跳动」痛点)。

## 平台与参考

- 库:**`@tanstack/vue-virtual`**(~几 KB)。已验证同栈项目 SubTap 在用。装:`npm i @tanstack/vue-virtual`。本项目 Vue3 + 纯 JS + `vite-plugin-singlefile`/`vite-plugin-pwa`,与 SubTap 完全同栈,零摩擦。
- SubTap 用法(动态行高 + `measureElement`)见参考文件;**本项目行高固定,不需要 `measureElement`,比参考更简**。
- 选 TanStack 而非 `vue-virtual-scroller`:后者 `DynamicScroller` 向上滚「估高→实测修正」会跳(SubTap 注释实测);本项目虽用固定行高无此问题,但 TanStack API 更直接、维护更活跃,统一选它。

---

## 设计决策

### D1 按行虚拟化(不按列)

把 `displayFiles` **行优先**切片,每行 `colCount` 张。virtualizer `count = ceil(N / colCount)`,每个 virtual item 渲染**一整行**(横排 colCount 张 PhotoCard)。行高统一固定,一个 virtualizer 搞定。

**否决「按列」**(保留列分桶、每列一个 virtualizer):整页滚动下 N 个 virtualizer 协同复杂,且末行各列卡片数不齐致底部参差。复杂无收益。

**代价**:把 `columns`(列优先)改成 `rows`(行优先);`.gallery-grid` 从「flex row of 列」改成「track 内每行 flex row of 卡片」。必要的小重构,换虚拟化最简形态。

### D2 整页滚动 + `useWindowVirtualizer`(用户已定)

现状即整页滚动:`body { min-height:100vh; overflow-x:hidden }` 无 `overflow-y`,sidebar `position:fixed`,Gallery 撑高 body → 整页滚,header 随页滚走、sidebar 固定。

用 `useWindowVirtualizer`(**window 版**:observe window 的 resize/scroll 事件,而非 `ResizeObserver.observe(window)`——后者因 window 非 Element 会抛 `TypeError`)。`useVirtualizer`(element 版)的 `getScrollElement` 必须返回 Element,不能给 window。**不碰布局,不改滚动习惯**。header 仍随页滚走(现状)。

### D3 行高测真实列宽,弃 `estHeight` 公式(关键)

行高 = 卡片文档流高度 = **列宽**(`.thumbnail-container` aspect-ratio 1/1)+ 行间 gap(15px)。

- 用 **ResizeObserver** 监听 `.gallery-grid` 容器实际宽度 → 列宽 = `(宽 - (colCount-1)*GAP) / colCount` → `rowHeight = 列宽 + GAP`。
- 弃现有 `estHeight = (innerWidth-300)/colCount + 60`:它**不准**(没算 gap、border-box、flex 实际分配;`+60` 是给 `contain-intrinsic-size` 的含 meta 估算)。实测消除 track 高度误差 → 滚动条不跳。
- **触发重算**:窗口 resize / sidebar 宽变 / `colCount` 变。`thumbnailSize` **不影响行高**(卡片高 = 列宽,与缩略图 target-size 无关)。
- `rowHeight` 变化时调 `virtualizer.value.measure()` 重算 `getTotalSize()`。
- ⚠️ GAP 在移动端 `@media (max-width:768px)` 现为 5px、桌面 15px。行高测量里的 GAP 须随断点变(实现读 CSS 变量或 matchMedia),不能写死 15。详见「具体落点」。

### D4 observer 协同(不改 `useThumbnail`)

`useThumbnail` 全局单例 observer(rootMargin `100px`)**不改**。虚拟化只挂可视 + overscan 行的卡片,这些卡片 `onMounted` 自动 observe、移出可视 `onBeforeUnmount` 自动 unobserve——现有生命周期天然配合,observer 逻辑零改动。

**`overscan` 必须 ≥ observer rootMargin(100px)覆盖的行数**:行高约 200–400px,100px < 1 行,`overscan: 4` 行(~1200px 缓冲)绰绰有余 → 保证预渲染的卡片已进 observer 触发缩略图加载,滚动时不出现「空卡等加载」。

> 切文件夹时 Gallery 现有的 `unobserveAll()` + 清搜索 watch(`watch(() => fsStore.currentFolder, ...)` + `onBeforeUnmount`)保留不动,不在本 R1 改动范围。

### D5 `rerunKey` 保留

`redrawSignal` / `thumbnailSize` 变 → `rerunKey++` → 进 PhotoCard `:key` → 可视区卡片重挂重新生成。虚拟化后**只重挂可视区**(现状重挂全部),反而更省。逻辑保留不变。

### D6 移除 `content-visibility:auto` + `contain-intrinsic-size`

虚拟化已控制 DOM 数,这两条的活被接管,留着是双重,且 `contain-intrinsic-size` 的估算高度会和虚拟化 track 高度冲突。移除 `.photo-card` 的这两条 + `--estimated-height` CSS 变量 + `estHeight` computed。简化。

### D7 canvas 重挂重画:默认接受,LRU 池后置(验收驱动)

虚拟化卸载卡片 = 销毁 canvas;滚回重挂 = 新 canvas 重画。重画走 `generateThumbnail`,**md5 缓存命中 → 从 IDB 读 blob → 重绘 canvas**(零文件 IO,但有一次 IDB 读 + canvas 绘制)。万图快速来回滚会反复挂卸重画。

**默认接受**(缓存命中足够快),**先不做 canvas LRU 池**(过早优化)。若验收发现滚动有「卡片闪 loading 转圈」观感,再上 LRU 池(卸载不销毁、复用最近 N 张 canvas)作后续优化。

---

## 具体落点

### 依赖

```bash
npm i @tanstack/vue-virtual
```

### 数据:行优先切片(替代 `columns`)

```js
const GAP = 15 // 桌面;移动端 5px,见 D3 注意点
const colCount = computed(() => settings.settings.columnCount)
const rows = computed(() => {
  const n = colCount.value
  const list = displayFiles.value
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
})
```

### virtualizer 配置

```js
import { useWindowVirtualizer } from '@tanstack/vue-virtual'

const gridRef = ref(null)
const rowHeight = ref(300) // 初值,ResizeObserver 实测后覆盖
const virtualizer = useWindowVirtualizer({
  get count() { return rows.value.length },
  estimateSize: () => rowHeight.value,
  overscan: 4,
})
watch(rowHeight, () => virtualizer.value?.measure())
```

### 行高实测(ResizeObserver)

```js
let ro = null
function measureRowHeight() {
  const w = gridRef.value?.clientWidth ?? 0
  const n = colCount.value
  if (w <= 0 || n <= 0) return
  const gap = currentGap() // 桌面 15 / 移动 5,见 D3
  const colW = (w - (n - 1) * gap) / n
  if (colW > 0) rowHeight.value = colW + gap
}
onMounted(() => {
  measureRowHeight()
  ro = new ResizeObserver(measureRowHeight)
  ro.observe(gridRef.value)
})
onBeforeUnmount(() => ro?.disconnect())
// colCount 变化也要重测(watch colCount → measureRowHeight)
```

> `currentGap()`:桌面 15px、`@media(max-width:768px)` 5px。用 `window.matchMedia('(max-width:768px)').matches` 选值,或把 gap 收成 CSS 变量 `--gallery-gap` 由 JS 读。二选一,plan 细化。

> ⚠️ **边界(必须处理)**:`gridRef` 在 `v-else`(有文件)分支才渲染,空状态时为 `null`。`onMounted` 时若 `displayFiles` 为空,`ro.observe(null)` 会抛 `TypeError`。且从空→非空切换时 `gridRef` 才首次出现。故首次 `measure` + `observe` 不能只放 `onMounted`,须 `watch(gridRef, el => { if (!el) return; measureRowHeight(); ro?.observe(el) })`(或 `nextTick`)在其出现时触发,`observe` 前判空。

### 模板结构

```html
<div v-else ref="gridRef" class="gallery-grid">
  <div class="gallery-track" :style="{ height: virtualizer.getTotalSize() + 'px' }">
    <div
      v-for="vi in virtualizer.getVirtualItems()"
      :key="vi.key"
      class="gallery-row"
      :style="{ transform: `translateY(${vi.start}px)` }"
    >
      <PhotoCard
        v-for="(f, c) in rows[vi.index]"
        :key="`${f.path}-${rerunKey}-${c}`"
        :file="f"
        :target-size="settings.settings.thumbnailSize"
        @click="openPreview(f)"
      />
    </div>
  </div>
</div>
```

### CSS 变更([gallery.css](../../../src/styles/gallery.css))

- `.gallery-grid`:从 `display:flex; flex-direction:row` 改为 `position:relative; width:100%`(由内层 track 撑高)。
- **删** `.masonry-col`。
- **新增** `.gallery-track { position:relative; width:100% }`。
- **新增** `.gallery-row { position:absolute; left:0; right:0; display:flex; flex-direction:row; gap:15px }`(替代 masonry-col 的横排;移动端 gap 5px)。
- `.gallery-row > .photo-card { flex:1; min-width:0 }`(列等宽)。
- `.photo-card`:**移除** `content-visibility:auto` + `contain-intrinsic-size:auto var(--estimated-height,...)`。
- 移除 `estHeight` computed + `--estimated-height` 注入。

---

## 不做(YAGNI)

- **canvas LRU 池**(D7 后置,验收驱动)。
- **`scrollToIndex`**:无需求——MediaModal 是全屏覆盖,不依赖 Gallery 滚动;搜索只过滤不定位。
- **按列切法**(D1 否决)。

## 验收

**客观(我可机械核对)**:
- mock 万图(构造 10000 文件)下 `document.querySelectorAll('.photo-card').length` ≈ 可视行 × colCount + overscan × colCount,远小于 10000。
- 全局 observer 的 target 数同量级(`useThumbnail` 单例,target = 可视卡片数)。
- `.gallery-track` height ≈ `rows.length × rowHeight`,滚动无跳动。
- `colCount` ±1 / 窗口 resize:`rowHeight` 重算、track 跟随、卡片不错位。
- 现有测试仍绿;Gallery 若有快照/单测需更新。

**主观(用户本人在浏览器验)**:万图滚动顺不顺、缩略图是否及时出现、resize/切列数无跳动、`rerunKey` 重生成正常、modal 打开 / 搜索过滤 / 右键菜单正常。

## 与 round2 其他线的关系

- **R5(批量写 `_meta` 修 sort 风暴)协同**:虚拟化后只有可视区卡片在 DOM,enrich 重排时只重排可视区 rows,sort 风暴成本随虚拟化自然下降。R1 先行不阻塞 R5;两者都让大文件夹更顺。
- **R2/R3(扫描优化)**独立,与 R1 不交互。

---

## 一句话总结

固定行高均匀网格 + 整页滚动 → `@tanstack/vue-virtual` 按行切片、`useWindowVirtualizer`(window 版)、ResizeObserver 测真实列宽定行高、overscan 覆盖 observer rootMargin。万图下 DOM/observer/canvas 从 O(N) 降到 O(可视区)。现有 `useThumbnail`/`rerunKey` 不改,移除 `content-visibility` 穷人虚拟化,canvas LRU 池验收驱动后置。
