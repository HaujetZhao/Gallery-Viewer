// 画廊搜索与筛选状态(模块级单例)。搜索框(App fixed 右上)写 searchTerm,Gallery 读 debouncedTerm 过滤并回写计数。
// searchTerm 即时跟随输入框;debouncedTerm 延迟 300ms 同步,避免大画廊每键全量重排。
// R16-a:新增 filterFavorite / filterNote 两个开关,开启时叠加全量 md5 集合过滤(AND,与搜索词也叠加)。
import { ref, watch } from 'vue';
import { getAllUserData } from '../services/db';

const searchTerm = ref('');
const debouncedTerm = ref('');
const filteredCount = ref(0);
const totalCount = ref(0);

let timer = null;
watch(searchTerm, (v) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    debouncedTerm.value = v;
  }, 300);
});

// ===== R16-a 收藏/备注筛选 =====
// 全局筛选需"全量 md5 集合",而 favorites/notes store 是视窗懒加载镜像(不含未进视窗的文件),
// 故开启筛选时调 getAllUserData() cursor 全扫 user-data store 建两个 Set,缓存到本次筛选会话。
const filterFavorite = ref(false);
const filterNote = ref(false);
// filterSets 为响应式:整体替换触发 Gallery 的 displayFiles computed 重算。
// 初值空集 → 仅在开关开启且集合已就绪时才参与过滤(未就绪视作"无命中",保守)。
const filterSets = ref({ fav: new Set(), note: new Set() });
const filterSetsReady = ref(false);
let loadingPromise = null;

async function loadFilterSets() {
  const all = await getAllUserData();
  filterSets.value = {
    fav: new Set(all.filter(d => d.favorite === true).map(d => d.md5)),
    note: new Set(all.filter(d => d.note).map(d => d.md5)),
  };
  filterSetsReady.value = true;
}

// 开关开启且集合未就绪 → 拉一次(去重并发)。
function ensureFilterSets() {
  if (!filterSetsReady.value && !loadingPromise) {
    loadingPromise = loadFilterSets().finally(() => {
      loadingPromise = null;
    });
  }
  return loadingPromise;
}

// 失效并按需重拉:用户 toggle 收藏 / 改备注后,集合需刷新,否则新收藏项在筛选下不可见。
// 仅在至少一个开关开启时才重拉(关闭时集合本就不参与过滤,惰性不拉)。
function invalidateFilterSets() {
  if (!filterFavorite.value && !filterNote.value)
    return;
  filterSetsReady.value = false;
  ensureFilterSets();
}

watch([filterFavorite, filterNote], ([fav, note]) => {
  if ((fav || note) && !filterSetsReady.value)
    ensureFilterSets();
});

export function useGallerySearch() {
  return {
    searchTerm,
    debouncedTerm,
    filteredCount,
    totalCount,
    filterFavorite,
    filterNote,
    filterSets,
    filterSetsReady,
    invalidateFilterSets,
  };
}
