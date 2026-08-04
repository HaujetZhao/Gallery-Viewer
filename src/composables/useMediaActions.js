// R16-b / R19:modal 内当前媒体的内容菜单(供右上角按钮 ① 弹出)。
// 项:收藏 / 备注 / 重命名 / 属性。备注/重命名/属性均走属性面板(方案 A),靠 focusNote / focusRename 区分直达行为。
// 纯函数:不持状态,每次调用读最新 store(favorites 收藏态实时反映)。
import { useFavoritesStore } from '../stores/favorites';
import { usePropertiesStore } from '../stores/properties';

export function buildMediaMenu(file) {
  const favorites = useFavoritesStore();
  const properties = usePropertiesStore();
  const hasMd5 = !!file?.md5;
  return [
    {
      label: favorites.isFavorite(file?.md5) ? '取消收藏' : '收藏',
      icon: 'fas fa-heart',
      disabled: !hasMd5,
      action: () => hasMd5 && favorites.toggle(file.md5),
    },
    { label: '备注', icon: 'fas fa-edit', action: () => properties.open(file, { focusNote: true }) },
    { label: '重命名', icon: 'fas fa-i-cursor', action: () => properties.open(file, { focusRename: true }) },
    { label: '属性', icon: 'fas fa-info-circle', action: () => properties.open(file) },
  ];
}
