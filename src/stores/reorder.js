// 重排模式 store。进入后强制名称排序、卡片可拖拽重排;「应用」把当前顺序固化成文件名前缀。
// 跨 Gallery/PhotoCard/工具栏共享态,故进 store(约定 7)。降级只读下 enter 拦截。
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { BatchRenameOperation } from '../services/operations';
import { isDegradedFSA } from '../utils/browser';
import { windowsCompareStrings } from '../utils/format';
import { composeName, padWidth, seqForIndex } from '../utils/reorder';
import { useFsStore } from './fs';
import { useHistoryStore } from './history';
import { useUserSettingsStore } from './userSettings';

export const useReorderStore = defineStore('reorder', () => {
  const fs = useFsStore();
  const settings = useUserSettingsStore();

  const active = ref(false);
  const order = ref([]); // 重排中的文件数组(真实视觉顺序,A→B→C…)
  const selected = ref(new Set()); // 选中的 file 引用集合(Set<SmartFile>,靠引用相等)
  const direction = ref('asc'); // 模式内编号方向(只影响 seqForIndex,不改视觉 order)
  const applying = ref(false); // 「应用」执行中(工具栏禁用)
  const dragging = ref(false); // 拖拽中(选中集合半透明);PhotoCard dragstart 置 true、dragend/drop 置 false
  const applyProcessed = ref(0); // 已处理文件数(进度)
  const applyTotal = ref(0);
  let savedSortField = null; // 进入时快照,退出恢复(单字段:只 sortField 被改成 name,direction 没动)

  function enter() {
    if (isDegradedFSA())
      return; // 降级兜底:UI 层已拦,这里再兜
    const folder = fs.currentFolder;
    if (!folder)
      return;
    savedSortField = settings.settings.sortField;
    settings.set('sortField', 'name'); // 强制名称排序作起点(用户要求)
    // 编号方向取进入时的排序方向作起点;模式内切方向只改本 ref,不写回 settings
    direction.value = settings.settings.sortDirection === 'desc' ? 'desc' : 'asc';
    const dir = direction.value === 'asc' ? 1 : -1;
    order.value = [...folder.files].sort((a, b) => windowsCompareStrings(a.name, b.name) * dir);
    selected.value = new Set();
    applying.value = false;
    applyProcessed.value = 0;
    applyTotal.value = 0;
    active.value = true;
  }

  function cancel() {
    if (savedSortField != null)
      settings.set('sortField', savedSortField);
    active.value = false;
    order.value = [];
    selected.value = new Set();
    applying.value = false;
  }

  function toggleSelect(file) {
    const s = new Set(selected.value);
    if (s.has(file))
      s.delete(file);
    else
      s.add(file);
    selected.value = s; // 重新赋值触发响应(Set 原位改不触发)
  }
  function clearSelect() {
    selected.value = new Set();
  }
  function selectOneOnly(file) {
    selected.value = new Set([file]);
  }
  function isSelected(file) {
    return selected.value.has(file);
  }

  // 拖拽落定:把 selected 从 order 移除,整体插到 rest 的 insertAt。
  function moveSelectedTo(insertAt) {
    const sel = new Set(selected.value);
    if (!sel.size)
      return;
    const moving = order.value.filter(f => sel.has(f));
    const rest = order.value.filter(f => !sel.has(f));
    const at = Math.max(0, Math.min(insertAt, rest.length));
    rest.splice(at, 0, ...moving);
    order.value = rest;
  }

  // 按「当前 order + direction」构造批量重命名条目(过滤掉原名==新名的无变化项)。
  function buildEntries() {
    const total = order.value.length;
    const width = padWidth(total);
    const entries = [];
    order.value.forEach((file, index) => {
      const seq = seqForIndex(index, total, direction.value);
      const newName = composeName(file.name, seq, width);
      if (file.name !== newName)
        entries.push({ file, oldName: file.name, newName });
    });
    return entries;
  }

  // 应用:执行 BatchRenameOperation。onProgress(processed,total,failed)。
  // 返回 { done, failed, errors }。finally 收尾退出(恢复排序、active=false)。
  async function apply(onProgress) {
    const entries = buildEntries();
    if (!entries.length) {
      cancel();
      return { done: 0, failed: 0, errors: [] };
    }
    applying.value = true;
    applyProcessed.value = 0;
    applyTotal.value = entries.length;
    const history = useHistoryStore();
    const op = new BatchRenameOperation(entries);
    try {
      await history.executeOperation(op, (processed, failed) => {
        applyProcessed.value = processed;
        onProgress?.(processed, entries.length, failed);
      });
      const fr = op.failureReport;
      return { done: entries.length, failed: fr?.failed ?? 0, errors: fr?.errors ?? [] };
    }
    finally {
      applying.value = false;
      cancel(); // 成功/失败都收尾:恢复排序、退出模式(改名后名称排序正显示新前缀顺序)
    }
  }

  // 模式中切走文件夹 → 自动放弃(不写回),避免跨夹污染。
  watch(() => fs.currentFolder, () => {
    if (active.value)
      cancel();
  });

  return {
    active,
    order,
    selected,
    direction,
    applying,
    dragging,
    applyProcessed,
    applyTotal,
    enter,
    cancel,
    toggleSelect,
    clearSelect,
    selectOneOnly,
    isSelected,
    moveSelectedTo,
    buildEntries,
    apply,
  };
});
