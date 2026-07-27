// 撤销栈 store。搬自源码 js/operation-history.js 的 OperationHistory 单例。
// 文件级操作(删除/重命名/移动)进栈,Ctrl+Z 撤销;文件夹删除不进栈。
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { FileDeleteOperation, FileRenameOperation, FileMoveOperation } from '../services/operations';

const MAX_SIZE = 50;

export const useHistoryStore = defineStore('history', () => {
  const stack = ref([]);

  async function executeOperation(op) {
    await op.execute();
    stack.value.push(op);
    if (stack.value.length > MAX_SIZE) stack.value.shift();
  }
  async function undoLastOperation() {
    if (!stack.value.length) throw new Error('没有可撤销的操作');
    const op = stack.value.pop();
    await op.undo();
    return op;
  }
  function clear() {
    stack.value = [];
  }

  // 便捷函数(对应源码 *WithHistory)
  const deleteFile = (f) => executeOperation(new FileDeleteOperation(f));
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
