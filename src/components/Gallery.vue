<script setup>
import { useWindowVirtualizer } from '@tanstack/vue-virtual';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useGallerySearch } from '../composables/useGallerySearch';
import { redrawSignal, unobserveAll } from '../composables/useThumbnail';
import { loadCapturedAtForFiles } from '../services/fileMeta';
import { useFsStore } from '../stores/fs';
import { useModalStore } from '../stores/modal';
import { useUserSettingsStore } from '../stores/userSettings';
import { windowsCompareStrings } from '../utils/format';
import { buildSlots, chunkRows, computeRowHeight, dateSortValue, DETAIL_INFO_HEIGHT } from '../utils/gallery-layout';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const { searchTerm, debouncedTerm, filteredCount, totalCount, filterFavorite, filterNote, filterSets } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const colCount = computed(() => settings.settings.columnCount);

// R8:会话内稳定排序。冻结序号 frozenOrder(Map<file, number>),displayFiles 按冻结序号排,
// 不再读 live name/size/mtime → rename/delete/move/enrich 不再"飞走"。
// 仅在 ①currentFolder 变(切走切回/点侧栏)②改排序方式 ③enrich 完成(size/date 沉淀) 时重冻。
const frozenOrder = ref(new Map());
let orderCounter = 0;
const settled = ref(false); // 当前 folder 的 size/date 是否已按 enrich 结果重冻
// —— 冻结排序空位(fixed order + holes)——
// slotCount:已分配最大序号 + 1(冻结跨度)。删除/移出不缩 → 空位保留;追加文件才增。
const slotCount = ref(0);
// 是否在筛选(搜索/收藏/备注):筛选时压缩显示(不留空位),非筛选时按冻结序号保留删除/移出的空位。
const isFiltering = computed(() => !!(debouncedTerm.value || filterFavorite.value || filterNote.value));
// 非筛选时的固定空位槽:ordinal → 当前仍在 folder.files 的文件,删除/移出的留 null(空位)。
const slots = computed(() => buildSlots(fsStore.currentFolder?.files || [], frozenOrder.value, slotCount.value));

// 按当前排序键算有序列表(冻结时用;size/mtime 缺失兜底排末尾)
function sortByKey(files) {
  const dir = sortAsc.value ? 1 : -1;
  return [...files].sort((a, b) => {
    if (sortField.value === 'name')
      return windowsCompareStrings(a.name, b.name) * dir;
    if (sortField.value === 'size')
      return ((a.size ?? Infinity) - (b.size ?? Infinity)) * dir;
    return ((dateSortValue(a) ?? Infinity) - (dateSortValue(b) ?? Infinity)) * dir; // date:EXIF 拍摄时间优先,否则文件时间
  });
}

// 重冻:按当前排序键给当前 folder 全部文件盖递增序号(铺满,无空位)。
function freeze() {
  const files = fsStore.currentFolder?.files || [];
  const m = new Map();
  sortByKey(files).forEach((f, i) => m.set(f, i));
  frozenOrder.value = m;
  orderCounter = files.length;
  slotCount.value = files.length;
}

// date 排序:先把持久化的 EXIF 拍摄时间(md5→file-meta)读进各文件 _meta,再重冻。
// 否则冻结在视窗懒加载前跑,dateSortValue 回退文件时间——重进文件夹/切 date 排序后 EXIF 时间不生效。
// 只读 store、不重抽 EXIF(快);非 date 不处理(调用方已 sync freeze)。期间切走则放弃。
async function refineDateOrder() {
  const folder = fsStore.currentFolder;
  if (sortField.value !== 'date' || !folder?.files)
    return;
  await loadCapturedAtForFiles(folder.files);
  if (fsStore.currentFolder !== folder)
    return;
  freeze();
}

// 当前 folder 是否全部 enrich 完成(size 就绪)。size/date 排序需待 enrich 后重冻一次。
const allEnriched = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  return files.length > 0 && files.every(f => f.size != null);
});

// 过滤 + 按 frozenOrder 稳定排序(用 debouncedTerm;过滤只隐藏、不改相对序)。
// R16-a:搜索词 + 收藏/备注筛选叠加(AND)。收藏/备注筛选用全量 md5 集合(filterSets,开关开启时由
// useGallerySearch 懒拉 getAllUserData 填充);md5 未算(未进视窗)的文件在筛选下按"不通过"处理(保守,避免假命中)。
const displayFiles = computed(() => {
  const files = fsStore.currentFolder?.files || [];
  const term = debouncedTerm.value.toLowerCase();
  const order = frozenOrder.value;
  const favOn = filterFavorite.value;
  const noteOn = filterNote.value;
  const favSet = filterSets.value.fav;
  const noteSet = filterSets.value.note;
  return files
    .filter(f => f.path.toLowerCase().includes(term))
    .filter(f => (!favOn || favSet.has(f.md5)) && (!noteOn || noteSet.has(f.md5)))
    .sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
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

// 会话内新进入文件(move-in / 后台扫描新增 / 撤销还原)→ 追加末尾序号,不触发整体重冻。
// 源取「内容副本」而非数组引用——addFile/removeFile 是原位 push/splice,引用不变,只看引用不会触发。
// 撤销还原的文件已有原序号(删除不删 frozenOrder)→ 不被追加,回原位槽;仅真·新文件走追加。
watch(
  () => [...(fsStore.currentFolder?.files || [])],
  (files) => {
    const m = frozenOrder.value;
    let changed = false;
    for (const f of files) {
      if (!m.has(f)) {
        m.set(f, orderCounter++);
        changed = true;
      }
    }
    if (changed) {
      frozenOrder.value = new Map(m);
      slotCount.value = orderCounter;
    }
  },
);
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
// 非筛选:用「冻结空位槽」(删除/移出留空,其余不重排);筛选:用压缩后的 displayFiles(搜索/收藏/备注不留空位)。
const rows = computed(() => chunkRows(isFiltering.value ? displayFiles.value : slots.value, colCount.value));

// 行高 = 列宽(thumbnail aspect-ratio 1/1)+ 行间 gap。
// 桌面 gap 15 / 移动 gap 5,与下方 scoped .gallery-row gap 一致。
const DESKTOP_GAP = 15;
const MOBILE_GAP = 5;
function currentGap() {
  return window.matchMedia('(max-width: 768px)').matches ? MOBILE_GAP : DESKTOP_GAP;
}

const gridRef = ref(null);
const rowHeight = ref(300); // 初值;ResizeObserver 实测后覆盖(弃旧 estHeight 公式)
const colWidth = ref(0); // 列宽 px;作 prop 传 PhotoCard,供视频悬浮拓展算尺寸

// 整页滚动:用 useWindowVirtualizer(window 版,observe window 的 resize/scroll 事件,
// 而非 ResizeObserver.observe(window)——后者因 window 非 Element 会抛错)。固定行高,无需 measureElement。
// 固定行高依赖缩略图 1:1 方形;未来若引入非方形缩略图策略,需改用 measureElement 或动态行高,否则布局错位。
const virtualizer = useWindowVirtualizer({
  get count() { return rows.value.length; },
  estimateSize: () => rowHeight.value,
  overscan: 4, // 4 行 ≈ 1200px,覆盖 useThumbnail observer 的 rootMargin(100px)
});
// 行高变化 → 重算 getTotalSize,track 高度跟随
watch(rowHeight, () => virtualizer.value?.measure());

function measureRowHeight() {
  const el = gridRef.value;
  if (!el)
    return;
  // detail 样式卡内多了图下方信息区(固定 DETAIL_INFO_HEIGHT),行高随之增大,否则虚拟化行错位。
  const cardStyle = settings.settings.cardStyle;
  const extraPerCard = cardStyle === 'detail' ? DETAIL_INFO_HEIGHT : 0;
  rowHeight.value = computeRowHeight(el.clientWidth, colCount.value, currentGap(), extraPerCard);
  // 列宽 = 行高 - 额外高度 - gap(供卡片悬浮拓展读 --col-width)。
  colWidth.value = rowHeight.value - extraPerCard - currentGap();
}

let ro = null;
// gridRef 在 v-else(有文件)才渲染:出现时首次 measure + observe;卸载时 disconnect。
watch(gridRef, (el) => {
  if (!el || typeof ResizeObserver === 'undefined')
    return;
  measureRowHeight();
  ro?.disconnect();
  ro = new ResizeObserver(measureRowHeight);
  ro.observe(el);
});
// 列数变化(宽度不变但列宽变)也要重测
watch(colCount, () => measureRowHeight());
// 卡片样式变化(detail 多出信息区高度)也要重测
watch(() => settings.settings.cardStyle, () => measureRowHeight());

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
    // R8:切走切回 / 点侧栏 → 重冻顺序(reset settled,等 enrich 完再沉一次 size/date)。
    settled.value = false;
    freeze(); // 立即初步冻结(首屏渲染)
    refineDateOrder(); // date:后台补 EXIF 时间后重冻(异步,不阻塞首屏)
    // 整页滚动:切换文件夹必须回顶。useWindowVirtualizer 按当前 scrollY 渲染可视行,
    // 不归零会停在旧文件夹的滚动位置 → 渲染新文件夹中间行(错位 + 转圈)。
    window.scrollTo(0, 0);
  },
);

// R8:改排序方式 → 立即重冻(reset settled,等 enrich 完再沉一次)。
watch([sortField, sortAsc], () => {
  settled.value = false;
  freeze();
  refineDateOrder(); // date:补 EXIF 时间后重冻
});

// R8:size/date 排序:enrich 完成后(_meta 补齐)重冻一次,之后冻结直到下一触发点。
watch(allEnriched, async (ok) => {
  if (ok && !settled.value) {
    await refineDateOrder(); // date:补 EXIF 时间后 freeze;非 date:no-op
    if (sortField.value !== 'date')
      freeze(); // 非 date 由这里冻(原行为)
    settled.value = true;
  }
});

// R8:组件挂载时若已有 currentFolder,先冻一次(主界面带 folder 挂载场景)。
freeze();
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
    <div v-else ref="gridRef" class="gallery-grid" :style="{ '--col-count': colCount }">
      <div class="gallery-track" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="vi in virtualizer.getVirtualItems()"
          :key="vi.key"
          class="gallery-row"
          :style="{ transform: `translateY(${vi.start}px)` }"
        >
          <template
            v-for="(f, c) in rows[vi.index]"
            :key="f ? `${f.path}-${rerunKey}-${c}` : `empty-${rerunKey}-${c}`"
          >
            <PhotoCard
              v-if="f"
              :file="f"
              :target-size="settings.settings.thumbnailSize"
              :col-width="colWidth"
              @click="openPreview(f)"
            />
            <!-- 空位(null 槽):渲染占位元素占住 1fr 列——若什么都不渲染,grid 自动排布会把右侧卡片左移填补空位 -->
            <div v-else class="gallery-empty-cell" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 画廊容器 */
.gallery-container {
    min-height: 400px;
    position: relative;
    flex: 1;
}

.empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-secondary);
    /* 使用CSS变量 */
}

.empty-icon {
    font-size: 4rem;
    margin-bottom: 20px;
    color: var(--color-gray-400);
    /* 使用CSS变量 */
}

.gallery-grid {
    position: relative;
    width: 100%;
}

/* 虚拟化:track 由 virtualizer.getTotalSize() 撑高,行绝对定位 translateY */
.gallery-track {
    position: relative;
    width: 100%;
}

.gallery-row {
    position: absolute;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(var(--col-count, 4), 1fr);
    gap: 15px;
}

/* 删除/移出后保留的空位占位:占住 1fr 列(否则 grid 自动排布把右侧卡左移填补)。
   ⚠️ 勿设 width:100%; aspect-ratio:1/1 —— grid 项默认 align-self:stretch 竖向往行高拉伸
   (如 216px),此时 aspect-ratio 1/1 会把列宽反推成=高(216 宽),撑爆该 1fr 轨道,
   挤缩同排其余卡片(大小/位置都变)。留空即可,靠默认 stretch 填满 grid 区域(=正常卡片 box)。 */
.gallery-empty-cell {
}

/* 虚拟化行有 transform:translateY(创建 z-index auto 的 stacking context,层级 0)→ 卡内任何 z-index 都被
   封在 0,盖不过侧栏(#sidebar z-index:900)。含展开卡(media-expanding)的行提 z-index 到 950,让弹出的
   媒体能横向盖过侧栏。:has() Chrome/Edge 支持(本应用仅 Chrome/Edge/Opera)。 */
.gallery-row:has(.photo-card.media-expanding) {
    z-index: 950;
}

@media (max-width: 768px) {
    .gallery-row {
        gap: 5px;
    }
}
</style>
