<script setup>
import { useWindowVirtualizer } from '@tanstack/vue-virtual';
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useGallerySearch } from '../composables/useGallerySearch';
import { useResponsiveViewport } from '../composables/useResponsiveViewport';
import { redrawSignal, unobserveAll } from '../composables/useThumbnail';
import { loadCapturedAtForFiles } from '../services/fileMeta';
import { useFsStore } from '../stores/fs';
import { useModalStore } from '../stores/modal';
import { useReorderStore } from '../stores/reorder';
import { useToastStore } from '../stores/uiToast';
import { useUserSettingsStore } from '../stores/userSettings';
import { BREAKPOINTS } from '../utils/breakpoints';
import { windowsCompareStrings } from '../utils/format';
import { buildSlots, chunkRows, computeRowHeight, dateSortValue } from '../utils/gallery-layout';
import { computeGridInsertIndex } from '../utils/reorder';
import PhotoCard from './PhotoCard.vue';

const fsStore = useFsStore();
const settings = useUserSettingsStore();
const modal = useModalStore();
const reorderStore = useReorderStore();
const toast = useToastStore();
const { searchTerm, debouncedTerm, filteredCount, totalCount, filterFavorite, filterNote, filterSets } = useGallerySearch();

const sortField = computed(() => settings.settings.sortField);
const sortAsc = computed(() => settings.settings.sortDirection === 'asc');
const { viewportWidth } = useResponsiveViewport();
// 列数 = columnCount 设置(单一真值,所见即所得,绝不运行时 min 钳制)。
// 仅在「gallery container 档位变化」时按档位值改写设置(<480→2 / <768→3 / <1100→4 / ≥1100 不动);
// 用 container 宽度(而非视口)——钉住侧栏导致 container 变窄也会正确降列。
// 用户手调滑块不被覆盖,grid 真实等于设置值。初始测量不改写(尊重已存设置)。
function bracketFor(w) {
  if (!w)
    return null;
  if (w < BREAKPOINTS.sm)
    return 2;
  if (w < BREAKPOINTS.md)
    return 3;
  if (w < BREAKPOINTS.lg)
    return 4;
  return null; // ≥lg:不限,保留用户设置
}
const colCount = computed(() => settings.settings.columnCount);
const containerWidth = ref(0);
const colBracket = computed(() => bracketFor(containerWidth.value));
// 仅 finite→finite 的真实变化才改写设置(oldB 为 null/undefined 时跳过初始挂载测量)
watch(colBracket, (b, oldB) => {
  if (b != null && oldB != null && b !== oldB)
    settings.set('columnCount', b);
});

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
  return viewportWidth.value < BREAKPOINTS.md ? MOBILE_GAP : DESKTOP_GAP;
}

const gridRef = ref(null);
const reorderGridRef = ref(null); // 重排态 grid 容器(拖拽落点查询用它)
const toolbarRef = ref(null); // 重排工具栏(拖拽时鼠标进入则暂停边缘感应滚动)

// 工具栏可拖动改位置:位置由 toolbarPos 驱动。x 为 null 时保持默认顶部居中;拖过就固定在拖到的像素位。
const toolbarPos = reactive({ x: null, y: 10 });
const toolbarStyle = computed(() => (toolbarPos.x === null
  ? { top: `${toolbarPos.y}px`, left: '50%', transform: 'translateX(-50%)' }
  : { top: `${toolbarPos.y}px`, left: `${toolbarPos.x}px`, transform: 'none' }));
let toolbarDrag = null; // { offX, offY } 拖把手的指针相对工具栏左上偏移
function onToolbarHandleDown(e) {
  if (e.button !== 0)
    return;
  const r = toolbarRef.value?.getBoundingClientRect();
  if (!r)
    return;
  const curX = toolbarPos.x === null ? r.left : toolbarPos.x; // 居中态取视觉 left,避免拖起瞬间跳位
  toolbarDrag = { offX: e.clientX - curX, offY: e.clientY - toolbarPos.y };
  window.addEventListener('pointermove', onToolbarHandleMove);
  window.addEventListener('pointerup', onToolbarHandleUp);
}
function onToolbarHandleMove(e) {
  if (!toolbarDrag)
    return;
  toolbarPos.x = e.clientX - toolbarDrag.offX;
  toolbarPos.y = e.clientY - toolbarDrag.offY;
}
function onToolbarHandleUp() {
  toolbarDrag = null;
  window.removeEventListener('pointermove', onToolbarHandleMove);
  window.removeEventListener('pointerup', onToolbarHandleUp);
}
// 重排态卡片的稳定 key:rename 会改 file.path,若 key=f.path 会触发卡片进出动画(哗啦啦);
// 用 WeakMap 给每个 file 引用分配稳定数字 key,rename 时引用不变 → key 不变 → 卡片只更新文件名文字,不进出。
const rkMap = new WeakMap();
let rkN = 0;
function rkOf(f) {
  let k = rkMap.get(f);
  if (k == null) {
    k = ++rkN;
    rkMap.set(f, k);
  }
  return k;
}
const colWidth = ref(0); // 列宽 px;作 prop 传 PhotoCard,供视频悬浮拓展算尺寸

// 整页滚动:useWindowVirtualizer(window 版)。行高用 measureElement 动态实测——
// 每行 ref 回调挂 virtualizer.measureElement,实测高度(含 detail 信息条),无需 DETAIL_INFO_HEIGHT 假设。
// estimateSize 仅作未测量行的滚动条估算(detail 给 ~52 余量,实测会修正;不与 CSS 精确同步)。
// 行高 = 等比卡高 + gap,常态必有非零高度;仅退出重排的过渡帧会量到 0(见 measureElement 注释)。
function estimateRowHeight() {
  return computeRowHeight(containerWidth.value, colCount.value, currentGap(), settings.settings.cardStyle === 'detail' ? 52 : 0);
}
const virtualizer = useWindowVirtualizer({
  get count() { return rows.value.length; },
  estimateSize: estimateRowHeight,
  overscan: 4, // 4 行 ≈ 1200px,覆盖 useThumbnail observer 的 rootMargin(100px)
  measureElement: (el) => {
    const h = el?.getBoundingClientRect().height ?? 0;
    // 退出重排过渡期行内容尚未排布,可能有一帧量到 0 高度。若把「仅 gap」的 15px 缓存进 itemSizeCache,
    // getTotalSize 会少算整行 → 页面高度不对,滚动到该行才重测回弹。0 高度是瞬时空帧,用 estimate 兜底
    // (estimate = 卡高 + gap,恰等于该行真实高度),等排布完成再被实测修正,高度始终稳定。
    if (h <= 0)
      return estimateRowHeight();
    return Math.round(h + currentGap());
  },
});

function measureContainer() {
  const el = gridRef.value;
  if (!el)
    return;
  // 重排时 gallery-grid 被 .reorder-hidden(display:none)隐藏 → clientWidth 为 0。
  // 不要用 0 覆盖上次的实测宽(否则 estimateSize 退化成 0,track 高度骤缩,退出重排那帧白屏)。
  if (el.clientWidth <= 0)
    return;
  containerWidth.value = el.clientWidth; // 供列数档位判定 + estimateSize
  // 列宽直接由 container 算(供卡片悬浮拓展读 --col-width),不再依赖行高反推。
  const gap = currentGap();
  colWidth.value = (el.clientWidth - (colCount.value - 1) * gap) / colCount.value;
}

let ro = null;
// gridRef 在 v-else(有文件)才渲染:出现时首次 measure + observe;卸载时 disconnect。
// ResizeObserver 只跟 container 宽度(列数/列宽);行高由 virtualizer.measureElement 各行自测。
watch(gridRef, (el) => {
  if (!el || typeof ResizeObserver === 'undefined')
    return;
  measureContainer();
  ro?.disconnect();
  ro = new ResizeObserver(measureContainer);
  ro.observe(el);
});
// 列数/卡片样式变化 → 重算列宽;行高由 measureElement 自动重测(各行 ResizeObserver 触发)。
watch(colCount, measureContainer);
watch(() => settings.settings.cardStyle, () => {
  measureContainer();
  virtualizer.value?.measure(); // cardStyle 切换:已测量行重测
});

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

// —— 重排模式:多列拖拽落点 + 边缘滚动 + 应用流程 ——
// 右键「进入重排模式」入口在 App.vue 的 .container 上(覆盖 header/gallery/footer 整个内容区)。

// dragover:实时按指针算落点,moveSelectedTo 重排 → TransitionGroup FLIP 挤压。
function onReorderDragover(e) {
  if (!reorderStore.active || !reorderStore.dragging)
    return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const grid = reorderGridRef.value;
  if (!grid)
    return;
  const nonDragged = grid.querySelectorAll('.photo-card:not(.reorder-selected)');
  if (!nonDragged.length)
    return;
  // 用 offsetLeft/offsetTop(布局终态)而非 getBoundingClientRect:FLIP 动画期间后者返回
  // 元素"飞过去"的过渡位置,落点会在「行末↔下行首」间反复翻转 → moveSelectedTo 反复触发 → 来回闪。
  // offsetTop 不受 transform 影响,落点基于稳定终态 → 鼠标静止即不震荡。
  // ponytail: dragover 每次遍历几百卡 O(n);万图升级=空间索引
  const parent = nonDragged[0].offsetParent;
  const pr = parent.getBoundingClientRect();
  const rects = [...nonDragged].map(el => ({
    left: pr.left + el.offsetLeft,
    top: pr.top + el.offsetTop,
    bottom: pr.top + el.offsetTop + el.offsetHeight,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }));
  const insertAt = computeGridInsertIndex(e.clientX, e.clientY, rects);
  reorderStore.moveSelectedTo(insertAt);
}
function onReorderDrop(e) {
  if (!reorderStore.active || !reorderStore.dragging)
    return;
  e.preventDefault();
  reorderStore.dragging = false; // 落定(dragend 也清,双保险)
}

// document 级 preventDefault 消除 HTML5 drag 禁用光标(照搬 RootSwitcher)+ 跟踪指针供边缘滚动用。
// HTML5 拖拽不触发 mousemove,故 useScrollZone(常驻边缘感应)在拖拽时失效——这里用 dragover 跟踪 + rAF 单独滚。
const REORDER_SCROLL_ZONE = 150; // 顶/底感应区高度(px)
let dragClientY = -1; // 最近一次 dragover 的视口 y;-1=未收到(不滚)
let scrollRaf = null;

function onDocDrag(e) {
  if (!reorderStore.dragging)
    return;
  e.preventDefault();
  if (e.dataTransfer)
    e.dataTransfer.dropEffect = 'move';
  // 鼠标在工具栏上时不感应滚动(工具栏在顶部,否则会被当作顶区持续向上滚)
  const tb = toolbarRef.value?.getBoundingClientRect();
  if (tb && e.clientX >= tb.left && e.clientX <= tb.right && e.clientY >= tb.top && e.clientY <= tb.bottom) {
    dragClientY = -1;
    return;
  }
  dragClientY = e.clientY;
}
// rAF 边缘滚动:指针在顶/底 150px 内,按距边缘距离线性加速(最快 ~15px/帧 ≈ 900px/s)。
function reorderScrollTick() {
  if (!reorderStore.dragging) {
    scrollRaf = null;
    return;
  }
  if (dragClientY >= 0) {
    const vh = window.innerHeight;
    let amount = 0;
    if (dragClientY < REORDER_SCROLL_ZONE) {
      amount = -Math.round((1 - dragClientY / REORDER_SCROLL_ZONE) * 15); // 顶区向上
    }
    else if (dragClientY > vh - REORDER_SCROLL_ZONE) {
      const fromBottom = vh - dragClientY;
      amount = Math.round((1 - fromBottom / REORDER_SCROLL_ZONE) * 15); // 底区向下
    }
    if (amount !== 0)
      window.scrollBy({ top: amount, behavior: 'instant' });
  }
  scrollRaf = requestAnimationFrame(reorderScrollTick);
}
watch(() => reorderStore.dragging, (d) => {
  if (d) {
    dragClientY = -1;
    document.addEventListener('dragover', onDocDrag);
    document.addEventListener('dragenter', onDocDrag);
    scrollRaf = requestAnimationFrame(reorderScrollTick);
  }
  else {
    document.removeEventListener('dragover', onDocDrag);
    document.removeEventListener('dragenter', onDocDrag);
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
  }
});

// 应用:执行批量重命名(可 Ctrl+Z 撤销,故无需二次确认对话框)。进度靠 store.applyProcessed/applyTotal。
async function doApply() {
  if (reorderStore.applying)
    return;
  try {
    const report = await reorderStore.apply();
    if (report.failed > 0)
      toast.warning(`已重命名 ${report.done - report.failed} 个,失败 ${report.failed} 个(Ctrl+Z 撤销)`);
    else if (report.done > 0)
      toast.success(`已重命名 ${report.done} 个文件(Ctrl+Z 撤销)`);
    else
      toast.info('顺序未变化,无需重命名');
  }
  catch (e) {
    toast.error(`应用失败: ${e?.message ?? e}`);
  }
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

// 退出重排模式 → 重冻:应用后文件名已变,需按新名重排显示;取消则顺序未变(重冻无害)。
// 必要:若进重排前就是「名称排序」,cancel 恢复 sortField 值未变 → 上面的 watch 不触发 → 不重冻 → 卡在旧冻结序。
// 同时保持 scrollY:重排态(非虚拟化全量 DOM)切回虚拟化时内容高度骤变,浏览器会 clamp scrollY。
watch(() => reorderStore.active, (now, wasActive) => {
  if (wasActive && !now) {
    const y = window.scrollY; // 退出前(重排态)的滚动位置
    settled.value = false;
    freeze();
    refineDateOrder();
    nextTick(() => window.scrollTo(0, y));
  }
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
  document.removeEventListener('dragover', onDocDrag);
  document.removeEventListener('dragenter', onDocDrag);
  if (scrollRaf)
    cancelAnimationFrame(scrollRaf);
});
</script>

<template>
  <div id="galleryContainer" class="gallery-container">
    <!-- 重排模式工具栏 -->
    <div v-if="reorderStore.active" ref="toolbarRef" class="reorder-toolbar" :style="toolbarStyle">
      <div class="rt-handle" title="拖动调整位置" @pointerdown="onToolbarHandleDown">
        <i class="fas fa-grip" />
      </div>
      <button
        class="rt-btn rt-apply"
        :disabled="reorderStore.applying || reorderStore.order.length < 2"
        title="把当前顺序作为数字前缀写入文件名"
        @click="doApply"
      >
        <i class="fas fa-check" /> 应用重排
      </button>
      <button class="rt-btn rt-cancel" :disabled="reorderStore.applying" @click="reorderStore.cancel">
        <i class="fas fa-xmark" /> 取消
      </button>
      <span v-if="reorderStore.applying" class="rt-status">重命名中 {{ reorderStore.applyProcessed }}/{{ reorderStore.applyTotal }}</span>
      <span v-else class="rt-status">已选 {{ reorderStore.selected.size }} / 共 {{ reorderStore.order.length }}</span>
    </div>

    <div v-if="!reorderStore.active && displayFiles.length === 0" class="empty-state">
      <i class="fas fa-images empty-icon" />
      <p>{{ debouncedTerm ? '没有匹配的文件' : '此文件夹为空' }}</p>
    </div>
    <!-- gallery-grid 常驻 DOM:重排时用 .reorder-hidden 隐藏(display:none)而非卸载——
         这样缩略图/布局保持热,退出重排即秒显,避免整树重挂触发缩略图异步重载闪白。
         虚拟化行在隐藏期间仍跟随窗口滚动渲染(预热可视区缩略图)。 -->
    <div
      v-else
      ref="gridRef"
      class="gallery-grid"
      :class="{ 'reorder-hidden': reorderStore.active }"
      :style="{ '--col-count': colCount }"
    >
      <div class="gallery-track" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="vi in virtualizer.getVirtualItems()"
          :key="vi.key"
          :ref="virtualizer.measureElement"
          class="gallery-row"
          :data-index="vi.index"
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
    <!-- 重排态:非虚拟化 TransitionGroup(全量渲染,FLIP 挤压)。仅重排时挂载。 -->
    <div
      v-if="reorderStore.active"
      ref="reorderGridRef"
      class="reorder-grid"
      :style="{ '--col-count': colCount }"
      @dragover="onReorderDragover"
      @drop="onReorderDrop"
    >
      <TransitionGroup name="reorder-flip">
        <PhotoCard
          v-for="f in reorderStore.order"
          :key="rkOf(f)"
          :file="f"
          :target-size="settings.settings.thumbnailSize"
          :reorder-mode="true"
        />
      </TransitionGroup>
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
/* 重排时隐藏普通网格(display:none)而非卸载:保缩略图/布局热,退出重排即秒显无闪白。
   display:none 让隐藏网格不占布局(不撑高页面),虚拟化行仍随窗口滚动预热可视区缩略图。 */
.gallery-grid.reorder-hidden {
    display: none;
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
    z-index: var(--z-expanded-card);
}

@media (max-width: 768px) {
    .gallery-row {
        gap: 5px;
    }
}

/* —— 重排模式 —— */
/* 工具栏:悬浮(fixed 顶部居中),脱离文档流不挤压卡片——进入重排模式时卡片位置不跳。
   定位(left/top/transform)由内联 toolbarStyle 驱动(默认居中,拖把手后固定到像素位)。 */
.reorder-toolbar {
    position: fixed;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--bg-primary);
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    flex-wrap: wrap;
    backdrop-filter: blur(8px);
}
/* 拖把手:工具栏位置调整抓手(左侧,不影响内部按钮点击)。 */
.rt-handle {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    margin-left: -6px;
    cursor: grab;
    color: var(--text-secondary);
    user-select: none;
}
.rt-handle:active {
    cursor: grabbing;
}
.rt-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: none;
    border-radius: var(--radius-md, 8px);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
    transition: opacity 0.2s ease, transform 0.1s ease;
}
.rt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.rt-btn:not(:disabled):active {
    transform: translateY(1px);
}
.rt-apply {
    background: #27ae60;
}
.rt-cancel {
    background: #95a5a6;
}
.rt-status {
    font-size: 13px;
    color: var(--text-secondary);
    margin-left: 4px;
}

/* 重排 grid:普通 grid 流式(非虚拟化),列数沿用 columnCount 设置。 */
.reorder-grid {
    display: grid;
    grid-template-columns: repeat(var(--col-count, 4), 1fr);
    gap: 15px;
    width: 100%;
}
/* TransitionGroup FLIP 挤位:落点变化时其余卡片平滑移动。 */
.reorder-flip-move {
    transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
}
@media (max-width: 768px) {
    .reorder-grid {
        gap: 5px;
    }
}
</style>
