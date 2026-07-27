// 画廊搜索状态(模块级单例)。搜索框(App fixed 右上)写 searchTerm,Gallery 读 debouncedTerm 过滤并回写计数。
// searchTerm 即时跟随输入框;debouncedTerm 延迟 300ms 同步,避免大画廊每键全量重排。
import { ref, watch } from 'vue';

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

export function useGallerySearch() {
  return { searchTerm, debouncedTerm, filteredCount, totalCount };
}
