import { useFavoritesStore } from '../stores/favorites';
import { useHistoryStore } from '../stores/history';
import { usePropertiesStore } from '../stores/properties';
import { useToastStore } from '../stores/uiToast';

// 统一删除入口(右键菜单 / Delete 键共用):移入 .trash 回收站,可 Ctrl+Z 撤销。
// 与右键删除一致的 toast 文案,键盘(见 App.vue Delete 分支)复用避免重复。
export async function deleteFileWithToast(file) {
  const history = useHistoryStore();
  const toast = useToastStore();
  try {
    await history.deleteFile(file);
    toast.success('已移动到 .trash 回收站(Ctrl+Z 撤销)');
  }
  catch (e) {
    toast.error(`删除失败: ${e.message}`);
  }
}

// 统一文件操作右键菜单(收藏 / 备注 / 属性 / 重命名 / 删除)。
// 重命名需父触发 UI(显示 RenameInput),故接 onRename callback。
// 备注 / 属性 都打开属性面板(R14 备注多行编辑在面板内);备注入口 focusNote 直达备注栏。
// @param onRename  (file) => void  父的重命名触发(设 editing=true)
// @returns { fileMenu(file) => menuItem[] }
export function useFileActions(onRename) {
  const properties = usePropertiesStore();
  const favorites = useFavoritesStore();

  async function onDelete(file) {
    await deleteFileWithToast(file);
  }

  function fileMenu(file) {
    const hasMd5 = !!file.md5;
    return [
      // R16-b:收藏(md5 未就绪时禁用——GIF/SVG/未进视窗本就不支持收藏)。
      {
        label: favorites.isFavorite(file.md5) ? '取消收藏' : '收藏',
        icon: 'fas fa-heart',
        disabled: !hasMd5,
        action: () => hasMd5 && favorites.toggle(file.md5),
      },
      // R16-b:备注(打开属性面板并直达备注栏)。
      { label: '备注', icon: 'fas fa-edit', action: () => properties.open(file, { focusNote: true }) },
      { label: '属性', icon: 'fas fa-info-circle', action: () => properties.open(file) },
      { label: '重命名', icon: 'fas fa-i-cursor', action: () => onRename(file) },
      { divider: true },
      { label: '删除', icon: 'fas fa-trash-alt', danger: true, action: () => onDelete(file) },
    ];
  }

  return { fileMenu };
}
