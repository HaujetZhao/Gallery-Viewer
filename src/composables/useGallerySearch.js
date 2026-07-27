// 画廊搜索状态(模块级单例)。搜索框(App fixed 右上)写 searchTerm,Gallery 读它过滤并回写计数。
import { ref } from 'vue';

const searchTerm = ref('');
const filteredCount = ref(0);
const totalCount = ref(0);

export function useGallerySearch() {
  return { searchTerm, filteredCount, totalCount };
}
