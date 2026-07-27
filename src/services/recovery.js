// 句柄失效恢复服务。搬自源码 js/recovery.js。
// 失效检测由调用方触发(validate 失败 / NotFoundError);本服务负责:找祖先→重扫→递归扫新增子目录。
// syncTreeStructure(源码 sidebar)阶段5 接入;handleFileNotFound 推迟阶段6 gallery。
import { useFsStore } from '../stores/fs';
import { startBackgroundScan } from './filesystem';

// 文件夹失效恢复。返回恢复后的可用祖先 SmartFolder,或 null(根也失效)。
export async function handleFolderNotFound(folderData) {
  const fs = useFsStore();
  console.warn('文件夹可能已失效:', folderData?.name);

  const validAncestor = await folderData.findValidAncestor();
  if (!validAncestor) {
    console.error('无法恢复:根目录已失效,请重新打开文件夹');
    fs.rootHandle = null; // 回启动页,让用户重开
    return null;
  }

  // 重扫祖先(增量算法,返回 newSubFolders)
  const scanResult = await validAncestor.scan();
  // 阶段5: 接入 syncTreeStructure(validAncestor) —— Vue 响应式渲染 subFolders,可能多余
  validAncestor.treeNode?.refreshState();

  // 对新增子文件夹递归后台扫描
  if (scanResult.newSubFolders?.length) {
    for (const newFolder of scanResult.newSubFolders) {
      await startBackgroundScan(newFolder);
    }
  }
  return validAncestor;
}

// 包裹文件夹操作:NotFoundError/handle 失效时自动恢复 + 重试一次。
export async function safelyExecuteFolderOperation(folderData, operation) {
  try {
    return await operation();
  } catch (err) {
    if (
      err.name === 'NotFoundError' ||
      err.message?.includes('not found') ||
      err.message?.includes('not exist')
    ) {
      const recovered = await handleFolderNotFound(folderData);
      if (recovered) {
        return await operation(); // 恢复成功,重试
      }
    }
    throw err;
  }
}

// 包裹文件操作:失效时记录(handleFileNotFound 阶段6 接入),不重试,抛原错误。
export async function safelyExecuteFileOperation(fileData, operation) {
  try {
    return await operation();
  } catch (err) {
    if (
      err.name === 'NotFoundError' ||
      err.message?.includes('not found') ||
      err.message?.includes('not exist')
    ) {
      console.warn('文件可能已失效:', fileData?.name);
      // 阶段6 gallery: 接入 handleFileNotFound(fileData)
    }
    throw err;
  }
}
