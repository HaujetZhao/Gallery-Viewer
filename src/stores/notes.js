// 备注集合(md5 → 多行文本)。持久化走 user-data store({favorite,note} 聚合,md5 索引)。
// 懒加载:视窗触发 ensureLoaded 填镜像(与缩略图同流程)。Map 为响应式镜像(整体替换触发)。
// 空串视为无备注(userData.setNote 内部转 undefined + 写空删条目)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useGallerySearch } from '../composables/useGallerySearch';
import { ensureUserDataLoaded, setNote } from '../services/userData';

export const useNotesStore = defineStore('notes', () => {
  const notesMap = ref(new Map());

  // 由 thumbnail.js 视窗加载调。幂等:notesMap 已有该 md5 则跳过;
  // "已加载但无备注"的幂等性靠 userData.ensureUserDataLoaded 内部 loaded Map 缓存(二次调用直接返回缓存,不再 getUserData)。
  async function ensureLoaded(md5) {
    if (!md5 || notesMap.value.has(md5))
      return;
    const data = await ensureUserDataLoaded(md5);
    const note = data?.note;
    if (note && !notesMap.value.has(md5)) {
      const next = new Map(notesMap.value);
      next.set(md5, note);
      notesMap.value = next;
    }
    // 无 note 时不写入 notesMap——但 userData.ensureUserDataLoaded 已缓存该 md5,二次 ensureLoaded 直接返回,不再 getUserData
  }

  function getNote(md5) {
    return (md5 && notesMap.value.get(md5)) || '';
  }

  function has(md5) {
    return !!md5 && notesMap.value.has(md5);
  }

  async function setNoteWrapper(md5, text) {
    if (!md5)
      return;
    const next = new Map(notesMap.value);
    const trimmed = (text ?? '').trim();
    if (trimmed)
      next.set(md5, text);
    else
      next.delete(md5);
    notesMap.value = next;
    await setNote(md5, text);
    // R16-a:备注变更后失效全局筛选集合(若筛选开启则重拉,使新备注项即时可见)。
    useGallerySearch().invalidateFilterSets();
  }

  return { notesMap, ensureLoaded, getNote, has, setNote: setNoteWrapper };
});
