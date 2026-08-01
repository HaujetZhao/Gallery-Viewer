import { get, set } from 'idb-keyval';
// 备注集合(md5 为 key → 多行文本)。idb-keyval 持久化;Map 为响应式镜像(同 favorites 套路)。
// get/set/has 给 UI 读;空串视为无备注(set 时删除 key);启动 load()。无 md5 文件不参与。
import { defineStore } from 'pinia';
import { ref } from 'vue';

const KEY = 'notes';

export const useNotesStore = defineStore('notes', () => {
  const notesMap = ref(new Map());

  async function load() {
    try {
      const arr = await get(KEY);
      notesMap.value = new Map(arr || []);
    }
    catch (e) {
      console.warn('备注加载失败:', e);
    }
  }

  function getNote(md5) {
    return (md5 && notesMap.value.get(md5)) || '';
  }

  function has(md5) {
    return !!md5 && notesMap.value.has(md5);
  }

  async function setNote(md5, text) {
    if (!md5)
      return;
    const next = new Map(notesMap.value);
    const trimmed = (text ?? '').trim();
    if (trimmed)
      next.set(md5, text);
    else
      next.delete(md5); // 空串视为无备注 → 删 key
    notesMap.value = next; // 整体替换触发响应式
    try {
      await set(KEY, [...next]);
    }
    catch (e) {
      console.warn('备注保存失败:', e);
    }
  }

  return { notesMap, load, getNote, has, setNote };
});
