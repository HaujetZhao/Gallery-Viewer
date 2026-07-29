// 文件夹删除业务。两步确认 + 物理 removeEntry recursive(不可逆,不进撤销栈)。
import { deleteFolder } from '../models/SmartFolder';
import { useConfirmStore } from '../stores/confirm';
import { useFsStore } from '../stores/fs';
import { useToastStore } from '../stores/uiToast';
import { loadFolder, refreshFolder, switchToAllPhotos } from './folderActions';

export async function handleDeleteFolder(folder) {
  if (!folder.parent) {
    useToastStore().error('无法删除根文件夹');
    return;
  }
  const confirm = useConfirmStore();
  const fs = useFsStore();
  const toast = useToastStore();

  const hasContent = folder.files.length > 0 || folder.subFolders.length > 0;
  const ok = await confirm.show({
    title: '确认删除文件夹',
    message: `即将删除文件夹:<br><code>${folder.name}</code><br><br>${
      hasContent ? '<span style="color:#e67e22;">⚠️ 此文件夹不为空!</span><br>' : ''
    }<span style="color:#7f8c8d;">删除操作复杂且无法撤销</span>`,
    hasContent,
  });
  if (!ok)
    return;

  try {
    // deleteFolder:removeEntry recursive + 从 parent.subFolders 移除(folder 及其整棵子树随之脱离 rootFolder 树)。
    // 无需清缓存 —— deleteFolder 已 splice parent.subFolders,子树脱离 rootFolder 树即被 GC;
    // ALL_MEDIA 若在用,末尾 switchToAllPhotos 重聚合自然不含已删子树。
    await deleteFolder(folder);
    if (folder.parent)
      await refreshFolder(folder.parent);
    if (fs.currentFolder === folder)
      await loadFolder(folder.parent);
    else if (fs.currentFolder === fs.allMediaFolder)
      await switchToAllPhotos();
    toast.success(`文件夹 "${folder.name}" 已删除`);
  }
  catch (err) {
    if (err.name === 'NotAllowedError')
      toast.error('没有权限删除文件夹');
    else if (err.name === 'InvalidModificationError')
      toast.error('文件夹不为空或正在使用中');
    else toast.error(`删除失败: ${err.message}`);
  }
}
