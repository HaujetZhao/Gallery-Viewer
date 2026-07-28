# Round 2 · R1:Gallery 虚拟化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gallery 从全量挂载改为按行虚拟化,万图场景下 DOM/observer/canvas 从 O(N) 降到 O(可视区)。

**Architecture:** 固定行高均匀网格 + 整页滚动 → `@tanstack/vue-virtual` 按行切片(window 版 `useWindowVirtualizer`),`ResizeObserver` 测真实列宽定行高,`overscan:4` 覆盖 observer rootMargin(100px)。可测纯函数(`chunkRows`/`computeRowHeight`)抽到 `utils/` 做 TDD;组件层(虚拟化渲染)靠 lint + 现有测试绿 + 客观 DOM 核对 + 用户主观验收(项目无 `.vue` 组件测试惯例,jsdom 测不了真实虚拟化)。

**Tech Stack:** Vue 3 `<script setup>` / `@tanstack/vue-virtual` / Vitest + jsdom / 现有全局 CSS。

**设计依据:** [2026-07-28-round2-R1-Gallery虚拟化-design.md](../specs/2026-07-28-round2-R1-Gallery虚拟化-design.md)(已认可并 commit)

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `package.json` | 依赖 | 加 `@tanstack/vue-virtual` |
| `src/utils/gallery-layout.js` | 纯函数:`chunkRows`(行切片)、`computeRowHeight`(列宽→行高) | **新建** |
| `src/utils/gallery-layout.test.js` | 上述纯函数单测 | **新建** |
| `src/components/Gallery.vue` | 接入 virtualizer,列优先→行优先,移除 `columns`/`estHeight` | **重写 script + template** |
| `src/styles/gallery.css` | `.gallery-grid` 改定位容器、删 `.masonry-col`、加 `.gallery-track`/`.gallery-row`、移除 `.photo-card` 的 content-visibility | **改** |

---

## Task 1:装依赖 `@tanstack/vue-virtual`

**Files:**
- Modify: `package.json` / `package-lock.json`

- [ ] **Step 1: 安装**

```bash
npm i @tanstack/vue-virtual
```

预期:`package.json` dependencies 多出 `@tanstack/vue-virtual`。

- [ ] **Step 2: 确认版本写入**

```bash
node -e "console.log(require('./package.json').dependencies['@tanstack/vue-virtual'])"
```

预期:打印形如 `^3.x.x`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): 装 @tanstack/vue-virtual(R1 Gallery 虚拟化)"
```

---

## Task 2:纯函数 `gallery-layout.js`(TDD)

**Files:**
- Create: `src/utils/gallery-layout.js`
- Test: `src/utils/gallery-layout.test.js`

- [ ] **Step 1: 写失败测试**

创建 `src/utils/gallery-layout.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { chunkRows, computeRowHeight } from './gallery-layout';

describe('chunkRows', () => {
  it('空数组返回空', () => {
    expect(chunkRows([], 3)).toEqual([]);
  });
  it('5 项 n=2 → 3 行(末行 1 项)', () => {
    expect(chunkRows([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
  it('n=1 → 每项一行', () => {
    expect(chunkRows([0, 1, 2], 1)).toEqual([[0], [1], [2]]);
  });
  it('n >= length → 单行', () => {
    expect(chunkRows([0, 1], 5)).toEqual([[0, 1]]);
  });
  it('n <= 0 → 空(防御)', () => {
    expect(chunkRows([0, 1, 2], 0)).toEqual([]);
    expect(chunkRows([0, 1, 2], -1)).toEqual([]);
  });
});

describe('computeRowHeight', () => {
  it('width=1000 colCount=4 gap=15 → 列宽 238.75 + gap = 253.75', () => {
    // 列宽 = (1000 - 3*15)/4 = 955/4 = 238.75;行高 = 238.75 + 15 = 253.75
    expect(computeRowHeight(1000, 4, 15)).toBeCloseTo(253.75, 5);
  });
  it('colCount=1 → width + gap', () => {
    expect(computeRowHeight(500, 1, 15)).toBe(515);
  });
  it('width<=0 → 0', () => {
    expect(computeRowHeight(0, 4, 15)).toBe(0);
  });
  it('colCount<=0 → 0', () => {
    expect(computeRowHeight(1000, 0, 15)).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run src/utils/gallery-layout.test.js
```

预期:FAIL,`Failed to resolve import "./gallery-layout"`(模块不存在)。

- [ ] **Step 3: 写实现**

创建 `src/utils/gallery-layout.js`:

```js
// Gallery 虚拟化布局纯函数(可单测,不依赖 Vue/DOM)。
// chunkRows:行优先切片,每行 n 项(末行可不足)。
// computeRowHeight:由容器宽度算固定行高 = 列宽(thumbnail aspect-ratio 1/1)+ 行间 gap。

/**
 * 行优先切片。
 * @param {Array} list
 * @param {number} n 每行项数
 * @returns {Array<Array>} 行数组;n<=0 返回 []
 */
export function chunkRows(list, n) {
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * 由容器宽度计算固定行高。行高 = 列宽 + gap(列宽即卡片高,thumbnail aspect-ratio 1/1)。
 * @param {number} containerWidth gallery-grid 实际宽度(clientWidth)
 * @param {number} colCount 列数
 * @param {number} gap 列/行间距
 * @returns {number} 行高;containerWidth<=0 或 colCount<=0 返回 0
 */
export function computeRowHeight(containerWidth, colCount, gap) {
  if (containerWidth <= 0 || colCount <= 0) return 0;
  const colWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  return colWidth + gap;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run src/utils/gallery-layout.test.js
```

预期:PASS(9 个 it 全过)。

- [ ] **Step 5: Commit**

```bash
git add src/utils/gallery-layout.js src/utils/gallery-layout.test.js
git commit -m "feat(utils): gallery-layout 纯函数 chunkRows/computeRowHeight(R1)"
```

---

## Task 3:Gallery.vue + gallery.css 虚拟化改造

> vue 与 css 必须一起改才不破坏渲染,合并为一个 commit。

**Files:**
- Rewrite: `src/components/Gallery.vue`(script + template)
- Modify: `src/styles/gallery.css`

- [ ] **Step 1: 重写 `src/components/Gallery.vue`**

完整新内容:

```vue
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useWindowVirtualizer } from '@tanstack/vue-virtual';
import { useGallerySearch } from '../composables/useGallerySearch';
import { redrawSignal, unobserveAll } from '../composables/useThumbnail';
import { useFsStore } from '../stores/fs';
import { useModalStore } from '../stores/modal';
import { useUserSettingsStore } from '../stores/userSettings';
import { windowsCompareStrings } from '../utils/format';
import { chunkRows, computeRowHeight } from '../utils/gallery-layout';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const { searchTerm, debouncedTerm, filteredCount, totalCount } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const colCount = computed(() => settings.settings.columnCount);

// 过滤 + 排序(用 debouncedTerm,避免每键全量重排)
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = debouncedTerm.value.toLowerCase();
  let list = files.filter(f => f.path.toLowerCase().includes(term));
  const dir = sortAsc.value ? 1 : -1;
  list = [...list].sort((a, b) => {
    if (sortField.value === 'name')
      return windowsCompareStrings(a.name, b.name) * dir;
    // enrich 前 size/lastModified undefined → 兜底排末尾(enrich 写 _meta 后响应式重排)
    if (sortField.value === 'size')
      return ((a.size ?? Infinity) - (b.size ?? Infinity)) * dir;
    return ((a.lastModified ?? Infinity) - (b.lastModified ?? Infinity)) * dir;
  });
  return list;
});
// 回写计数(搜索框 fixed 右上读)。computed 不应有副作用,用 watch 同步。
watch(
  [displayFiles, () => fsStore.currentFolder?.files],
  ([list, files]) => {
    filteredCount.value = list.length;
    totalCount.value = (files || []).length;
  },
  { immediate: true },
);

// 行优先切片:每行 colCount 张,供 virtualizer 按行窗口化。
const rows = computed(() => chunkRows(displayFiles.value, colCount.value));

// 行高 = 列宽(thumbnail aspect-ratio 1/1)+ 行间 gap。
// 桌面 gap 15 / 移动 gap 5,与 gallery.css 的 .gallery-row gap 一致。
const DESKTOP_GAP = 15;
const MOBILE_GAP = 5;
function currentGap() {
  return window.matchMedia('(max-width: 768px)').matches ? MOBILE_GAP : DESKTOP_GAP;
}

const gridRef = ref(null);
const rowHeight = ref(300); // 初值;ResizeObserver 实测后覆盖(弃旧 estHeight 公式)

// 整页滚动:用 useWindowVirtualizer(window 版,observe window 的 resize/scroll 而非 ResizeObserver.observe(window))。固定行高,无需 measureElement。
const virtualizer = useWindowVirtualizer({
  get count() { return rows.value.length; },
  estimateSize: () => rowHeight.value,
  overscan: 4, // 4 行 ≈ 1200px,覆盖 useThumbnail observer 的 rootMargin(100px)
});
// 行高变化 → 重算 getTotalSize,track 高度跟随
watch(rowHeight, () => virtualizer.value?.measure());

function measureRowHeight() {
  const el = gridRef.value;
  if (!el) return;
  rowHeight.value = computeRowHeight(el.clientWidth, colCount.value, currentGap());
}

let ro = null;
// gridRef 在 v-else(有文件)才渲染:出现时首次 measure + observe;卸载时 disconnect。
watch(gridRef, (el) => {
  if (!el || typeof ResizeObserver === 'undefined') return;
  measureRowHeight();
  ro?.disconnect();
  ro = new ResizeObserver(measureRowHeight);
  ro.observe(el);
});
// 列数变化(宽度不变但列宽变)也要重测
watch(colCount, () => measureRowHeight());

const rerunKey = ref(0);
watch(
  () => settings.settings.thumbnailSize,
  () => {
    rerunKey.value++;
    unobserveAll();
  },
);
// 重绘信号:forceRegenerateCurrentThumbnails 删缓存后 ++ → 卡片重挂载重新生成
watch(redrawSignal, () => {
  rerunKey.value++;
});

function openPreview(file) {
  modal.open(file, displayFiles.value);
}

watch(
  () => fsStore.currentFolder,
  () => {
    unobserveAll();
    searchTerm.value = '';
    debouncedTerm.value = ''; // 立即清,不等 debounce
  },
);
onBeforeUnmount(() => {
  unobserveAll();
  ro?.disconnect();
});
</script>

<template>
  <div id="galleryContainer" class="gallery-container">
    <div v-if="displayFiles.length === 0" class="empty-state">
      <i class="fas fa-images empty-icon" />
      <p>{{ debouncedTerm ? '没有匹配的文件' : '此文件夹为空' }}</p>
    </div>
    <div v-else ref="gridRef" class="gallery-grid">
      <div class="gallery-track" :style="{ height: `${virtualizer.getTotalSize()}px` }">
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
  </div>
</template>
```

- [ ] **Step 2: 改 `src/styles/gallery.css`**

**(a)** `.gallery-grid` 改为定位容器(原 flex row of 列 → track 撑高的定位容器):

```css
.gallery-grid {
    position: relative;
    width: 100%;
}
```

(删除原 `display: flex; flex-direction: row; gap: 15px; align-items: flex-start;`)

**(b)** 删除整块 `.masonry-col { ... }`。

**(c)** 在 `.gallery-grid` 之后新增:

```css
/* 虚拟化:track 由 virtualizer.getTotalSize() 撑高,行绝对定位 translateY */
.gallery-track {
    position: relative;
    width: 100%;
}

.gallery-row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: row;
    gap: 15px;
}

.gallery-row > .photo-card {
    flex: 1;
    min-width: 0;
}
```

**(d)** `.photo-card` 移除这两行(虚拟化已控制 DOM 数,穷人虚拟化退役):

```css
    content-visibility: auto;
    contain-intrinsic-size: auto var(--estimated-height, 300px);
```

**(e)** 文件末尾的移动端 `@media (max-width: 768px)` 改为(原 `.gallery-grid`/`.masonry-col` gap → `.gallery-row` gap):

```css
@media (max-width: 768px) {
    .gallery-row {
        gap: 5px;
    }
}
```

- [ ] **Step 3: lint**

```bash
npm run lint
```

预期:无 error(可能有无关 warning;若有 Gallery.vue/gallery.css 相关 error,修)。

- [ ] **Step 4: 全量测试确认绿**

```bash
npm test
```

预期:全 PASS(含新 `gallery-layout.test.js` 的 9 个 + 现有 59 个)。

- [ ] **Step 5: build 确认编译通过**

```bash
npm run build
```

预期:build 成功生成 `dist/index.html`(单 HTML 自包含)。

- [ ] **Step 6: Commit**

```bash
git add src/components/Gallery.vue src/styles/gallery.css
git commit -m "feat(gallery): R1 按行虚拟化(列优先→行优先,ResizeObserver 实测行高,移除 content-visibility)"
```

---

## Task 4:验证与验收清单(交付用户)

> 客观 DOM 核对需在真实浏览器 + 真实文件夹(File System Access API 授权需用户手势,无法自动化),故交用户在 DevTools 跑;主观体验由用户验收(用户偏好:UI 体验自验)。

- [ ] **Step 1: 自动化验证(已由 Task 3 Step 3-5 覆盖)**

lint ✓ / 全量 test ✓ / build ✓。

- [ ] **Step 2: 交付用户的验收清单**

启动 `npm run dev`,打开一个大文件夹(几千~上万图),在 DevTools Console 核对:

```js
// 客观核对:DOM 节点数应远小于文件总数(只渲染可视 + overscan)
document.querySelectorAll('.photo-card').length        // ≈ 可视行数 × colCount + 4 × colCount
document.querySelectorAll('.gallery-row').length       // 可视行 + overscan
document.querySelector('.gallery-track').style.height  // = 行数 × 行高,scroll 无跳动
```

变更 colCount / 窗口 resize:行高重算、track 跟随、卡片不错位。

主观体验点(用户判断):
- 万图滚动顺不顺;
- 缩略图是否及时出现(不空卡);
- resize / 切列数无跳动;
- `rerunKey`(改 thumbnailSize / 强制重生成)正常;
- modal 打开 / 搜索过滤 / 右键菜单 / 内联重命名正常。

---

## Self-Review(计划自审)

**Spec 覆盖:**
- D1 按行 → Task 3(rows computed + 模板 gallery-row)。✓
- D2 window scroll → Task 3(useWindowVirtualizer,window 版)。✓
- D3 实测行高/弃 estHeight → Task 2(computeRowHeight)+ Task 3(ResizeObserver + watch rowHeight→measure)。✓
- D4 observer 协同/overscan → Task 3(overscan:4,useThumbnail 不改)。✓
- D5 rerunKey 保留 → Task 3(rerunKey 逻辑原样保留)。✓
- D6 移除 content-visibility → Task 3 Step 2(d)。✓
- D7 canvas 重挂默认接受 → 不需代码(验收驱动)。✓
- GAP 移动端 → Task 3(currentGap matchMedia + css @media)。✓
- gridRef 边界 → Task 3(watch(gridRef) 而非 onMounted)。✓
- unobserveAll 保留 → Task 3(切文件夹 watch + onBeforeUnmount 保留)。✓

**Placeholder 扫描:** 无 TBD/TODO;所有代码块完整。✓

**类型/命名一致:** `chunkRows`/`computeRowHeight` 在 Task 2 定义、Task 3 import 一致;`gridRef`/`rowHeight`/`virtualizer`/`rows`/`colCount` 全程一致;`currentGap` 与 css gap 值(15/5)一致。✓

**范围:** 单一聚焦(Gallery 虚拟化),单 plan 可实现。✓
