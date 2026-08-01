// 多根记录 store(响应式元数据,给 UI 读)。是 handleStore 的响应式镜像:
// 启动从 handleStore 加载,修改时同步写回 handleStore(持久化)。handle 不进响应式 store。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as handleStore from '../services/handleStore';

export const useRootStore = defineStore('root', () => {
  const roots = ref([]); // [{ id, name, fileCount, lastUsed }]
  const currentRootId = ref(null);

  // 从 handleStore 加载元数据(排除 handle)。
  async function loadFromHandleStore() {
    const all = await handleStore.loadAll();
    roots.value = all.map(({ id, name, fileCount, lastUsed }) => ({ id, name, fileCount, lastUsed }));
  }

  function add(id, name, fileCount, lastUsed) {
    roots.value.push({ id, name, fileCount, lastUsed });
  }

  function remove(id) {
    roots.value = roots.value.filter(r => r.id !== id);
    if (currentRootId.value === id)
      currentRootId.value = null;
  }

  // 更新响应式 roots + 同步持久化到 handleStore。
  async function updateMeta(id, patch) {
    const r = roots.value.find(it => it.id === id);
    if (r)
      Object.assign(r, patch);
    await handleStore.update(id, patch);
  }

  // R1:按 id 顺序重排响应式 roots + 同步 handleStore(与 updateMeta 同款"两边同步")。
  async function reorder(ids) {
    const map = new Map(roots.value.map(r => [r.id, r]));
    roots.value = ids.map(id => map.get(id)).filter(Boolean);
    await handleStore.reorder(ids);
  }

  function setCurrent(id) {
    currentRootId.value = id;
  }

  return { roots, currentRootId, loadFromHandleStore, add, remove, updateMeta, reorder, setCurrent };
});
