import { get, set } from 'idb-keyval';
// 收藏集合(md5 为 key)。idb-keyval 持久化;Set 为响应式镜像(同 handleStore/root 两边同步思路)。
// isFavorite/toggle 给 UI 读;启动 load()。GIF/SVG 无 md5 不参与(调用方按 file.md5 判定是否显示爱心)。
import { defineStore } from 'pinia';
import { ref } from 'vue';

const KEY = 'favorites';

export const useFavoritesStore = defineStore('favorites', () => {
  const favSet = ref(new Set());

  async function load() {
    try {
      const arr = await get(KEY);
      favSet.value = new Set(arr || []);
    }
    catch (e) {
      console.warn('收藏加载失败:', e);
    }
  }

  function isFavorite(md5) {
    return !!md5 && favSet.value.has(md5);
  }

  async function toggle(md5) {
    if (!md5)
      return;
    const next = new Set(favSet.value);
    if (next.has(md5))
      next.delete(md5);
    else
      next.add(md5);
    favSet.value = next; // 整体替换触发响应式(.has 不追踪,故 replace)
    try {
      await set(KEY, [...next]);
    }
    catch (e) {
      console.warn('收藏保存失败:', e);
    }
  }

  return { favSet, load, isFavorite, toggle };
});
