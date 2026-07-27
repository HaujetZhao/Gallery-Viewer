// 文件夹删除业务。两步确认 + 物理 removeEntry recursive(不可逆,不进撤销栈)。
import { useConfirmStore } from '../stores/confirm.js';
import { useFsStore } from '../stores/fs.js';
import { useToastStore } from '../stores/uiToast.js';
import { refreshFolder, loadFolder } from './filesystem.js';

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
  if (!ok) return;

  try {
    const path = folder.path;
    await folder.delete(); // SmartFolder.delete: removeEntry recursive + 从 parent.subFolders 移除
    fs.foldersData.delete(path);
    if (folder.parent) await refreshFolder(folder.parent);
    if (fs.currentFolder === folder) await loadFolder(folder.parent);
    toast.success(`文件夹 "${folder.name}" 已删除`);
  } catch (err) {
    if (err.name === 'NotAllowedError') toast.error('没有权限删除文件夹');
    else if (err.name === 'InvalidModificationError') toast.error('文件夹不为空或正在使用中');
    else toast.error('删除失败: ' + err.message);
  }
}
