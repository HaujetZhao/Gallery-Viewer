// 撤销栈 store。搬自源码 js/operation-history.js 的 OperationHistory 单例。
// 文件级操作(删除/重命名/移动)进栈,Ctrl+Z 撤销;文件夹删除不进栈。
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { schedulePersist } from '../services/filesystem';
import { FileDeleteOperation, FileMoveOperation, FileRenameOperation } from '../services/operations';
import { useFsStore } from './fs';
import { useRootStore } from './root';

const MAX_SIZE = 50;

export const useHistoryStore = defineStore('history', () => {
  const stack = ref([]);

  async function executeOperation(op) {
    await op.execute();
    stack.value.push(op);
    if (stack.value.length > MAX_SIZE)
      stack.value.shift();
    const fs = useFsStore();
    fs.rootDirty = true; // R3:rename/delete/move 后标树脏,下次 persistIfDirty 持久化
    // R3-3:debounced 持久化(1s 合并连续改名/删除/移动)。之前只置 dirty 无 persist 路径,
    //       rename 后关浏览器重开会丢改动 —— 现由 schedulePersist 兜底落 IDB。
    schedulePersist(useRootStore().currentRootId);
  }
  async function undoLastOperation() {
    if (!stack.value.length)
      throw new Error('没有可撤销的操作');
    // 先 peek 不 pop:undo 失败则 op 留栈顶可重试(T02 Bug2)。
    // 旧实现先 pop 再 await,undo 抛错 → op 永久出栈 + .trash 镜像成孤儿 + 仍落盘半撤销状态。
    const op = stack.value[stack.value.length - 1];
    await op.undo(); // 失败则抛出,下方不执行(op 留栈、不落盘)
    stack.value.pop(); // 成功才 pop
    const fs = useFsStore();
    fs.rootDirty = true; // undo 也改了树
    schedulePersist(useRootStore().currentRootId); // undo 同样 debounced 持久化
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
