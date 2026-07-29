import { useHistoryStore } from '../stores/history';
import { usePropertiesStore } from '../stores/properties';
import { useToastStore } from '../stores/uiToast';

// 统一文件操作右键菜单(属性 / 重命名 / 删除)。
// 重命名需父触发 UI(显示 RenameInput),故接 onRename callback。
// @param onRename  (file) => void  父的重命名触发(设 editing=true)
// @returns { fileMenu(file) => menuItem[] }
export function useFileActions(onRename) {
  const history = useHistoryStore();
  const properties = usePropertiesStore();
  const toast = useToastStore();

  async function onDelete(file) {
    try {
      await history.deleteFile(file);
      toast.success('已移动到 .trash 回收站(Ctrl+Z 撤销)');
    }
    catch (e) {
      toast.error(`删除失败: ${e.message}`);
    }
  }

  function fileMenu(file) {
    return [
      { label: '属性', icon: 'fas fa-info-circle', action: () => properties.open(file) },
      { label: '重命名', icon: 'fas fa-edit', action: () => onRename(file) },
      { divider: true },
      { label: '删除', icon: 'fas fa-trash-alt', danger: true, action: () => onDelete(file) },
    ];
  }

  return { fileMenu };
}
