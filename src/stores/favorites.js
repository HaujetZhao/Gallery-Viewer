// 收藏集合(md5 为 key)。持久化走 user-data store({favorite,note} 聚合,md5 索引)。
// 懒加载:视窗触发时 ensureLoaded 填镜像(与缩略图同流程)。Set 为响应式镜像(整体替换触发)。
// 全局"筛选收藏"(R16-a)届时用 cursor 全扫 user-data store(本 plan 不实现)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ensureUserDataLoaded, setFavorite } from '../services/userData';

export const useFavoritesStore = defineStore('favorites', () => {
  const favSet = ref(new Set());

  // 由 thumbnail.js 视窗加载调:userData 取回后,若 favorite 则入 Set。
  // 幂等:已 in Set 不重复。整体替换触发响应式(.has 不追踪,故 replace)。
  async function ensureLoaded(md5) {
    if (!md5 || favSet.value.has(md5))
      return;
    const data = await ensureUserDataLoaded(md5);
    if (data?.favorite && !favSet.value.has(md5)) {
      const next = new Set(favSet.value);
      next.add(md5);
      favSet.value = next;
    }
  }

  function isFavorite(md5) {
    return !!md5 && favSet.value.has(md5);
  }

  async function toggle(md5) {
    if (!md5)
      return;
    const next = new Set(favSet.value);
    const favorited = next.has(md5);
    if (favorited)
      next.delete(md5);
    else
      next.add(md5);
    favSet.value = next;
    await setFavorite(md5, !favorited);
  }

  return { favSet, ensureLoaded, isFavorite, toggle };
});
