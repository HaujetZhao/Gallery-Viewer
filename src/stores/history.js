// 撤销栈 store。搬自源码 js/operation-history.js 的 OperationHistory 单例。
// 文件级操作(删除/重命名/移动)进栈,Ctrl+Z 撤销;文件夹删除不进栈。
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { FileDeleteOperation, FileMoveOperation, FileRenameOperation } from '../services/operations';
import { afterFolderMutation } from '../services/persistence';
import { isDegradedFSA } from '../utils/browser';
import { useFsStore } from './fs';

const MAX_SIZE = 50;

export const useHistoryStore = defineStore('history', () => {
  const stack = ref([]);

  async function executeOperation(op) {
    // 总闸:降级只读(无根句柄)一律拦写回,兜住 UI 任何漏堵的右键/Delete/拖拽/F2/Ctrl+Z。
    if (isDegradedFSA() && !useFsStore().rootHandle)
      throw new Error('只读模式(降级)不支持文件写入操作');
    await op.execute();
    stack.value.push(op);
    if (stack.value.length > MAX_SIZE)
      stack.value.shift();
    // 树变更 → 标受影响文件夹脏 + debounced 持久化(per-folder:rename/delete 标父夹,move 标源+目标)。
    for (const f of op.getAffectedFolders())
      afterFolderMutation(f);
  }
  async function undoLastOperation() {
    if (!stack.value.length)
      throw new Error('没有可撤销的操作');
    // 先 peek 不 pop:undo 失败则 op 留栈顶可重试(T02 Bug2)。
    // 旧实现先 pop 再 await,undo 抛错 → op 永久出栈 + .trash 镜像成孤儿 + 仍落盘半撤销状态。
    const op = stack.value[stack.value.length - 1];
    await op.undo(); // 失败则抛出,下方不执行(op 留栈、不落盘)
    stack.value.pop(); // 成功才 pop
    for (const f of op.getAffectedFolders())
      afterFolderMutation(f); // undo 也改了树 → 标脏 + debounced 持久化
    return op;
  }
  function clear() {
    stack.value = [];
  }

  // 便捷函数(对应源码 *WithHistory)
  const deleteFile = f => executeOperation(new FileDeleteOperation(f));
  const renameFile = (f, newName) => executeOperation(new FileRenameOperation(f, f.name, newName));
  const moveFile = (f, target) => executeOperation(new FileMoveOperation(f, target));

  const canUndo = computed(() => stack.value.length > 0);
  const lastDescription = computed(() =>
    stack.value.length ? stack.value[stack.value.length - 1].getDescription() : null,
  );

  return {
    stack,
    canUndo,
    lastDescription,
    executeOperation,
    undoLastOperation,
    clear,
    deleteFile,
    renameFile,
    moveFile,
  };
});
