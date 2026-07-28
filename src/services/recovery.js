import { findValidFolderAncestor, scanFolder } from '../models/SmartFolder';
// 句柄失效恢复服务。搬自源码 js/recovery.js。
// 失效检测由调用方触发(validate 失败 / NotFoundError);本服务负责:找祖先→重扫→递归扫新增子目录。
// syncTreeStructure(源码 sidebar)阶段5 接入;handleFileNotFound 推迟阶段6 gallery。
import { useFsStore } from '../stores/fs';
import { integrateScanResult, startBackgroundScan } from './filesystem';

// 文件夹失效恢复。返回恢复后的可用祖先 SmartFolder,或 null(根也失效)。
// Phase 3 Step 1:scanFolder(纯函数) + integrateScanResult(写回 validAncestor 代理)。
// M5 修复:newSubFolders 先注册 foldersData 取代理后 startBackgroundScan(否则传原始对象不响应式)。
export async function handleFolderNotFound(folderData) {
  const fs = useFsStore();
  console.warn('文件夹可能已失效:', folderData?.name);

  const validAncestor = await findValidFolderAncestor(folderData);
  if (!validAncestor) {
    console.error('无法恢复:根目录已失效,请重新打开文件夹');
    fs.rootHandle = null; // 回启动页,让用户重开
    return null;
  }

  // 重扫祖先(scanFolder 纯函数 + integrateScanResult 写回代理 validAncestor)
  // integrateScanResult 内含:写回 files/subFolders + refreshState + 注册 newSubFolders + 删 removedFolders。
  const result = await scanFolder(validAncestor);
  integrateScanResult(validAncestor, result, fs);

  // 对新增子文件夹递归后台扫描(M5:newSubFolders 已由 integrateScanResult 注册 foldersData,
  // 此处 get 取代理后 startBackgroundScan,不再传 result.newSubFolders 里的原始对象)。
  if (result.newSubFolders?.length) {
    for (const newFolder of result.newSubFolders) {
      const proxy = fs.foldersData.get(newFolder.path);
      if (proxy)
        await startBackgroundScan(proxy);
    }
  }
  return validAncestor;
}

// 包裹文件夹操作:NotFoundError/handle 失效时自动恢复 + 重试一次。
export async function safelyExecuteFolderOperation(folderData, operation) {
  try {
    return await operation();
  }
  catch (err) {
    if (
      err.name === 'NotFoundError'
      || err.message?.includes('not found')
      || err.message?.includes('not exist')
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
  }
  catch (err) {
    if (
      err.name === 'NotFoundError'
      || err.message?.includes('not found')
      || err.message?.includes('not exist')
    ) {
      console.warn('文件可能已失效:', fileData?.name);
      // 阶段6 gallery: 接入 handleFileNotFound(fileData)
    }
    throw err;
  }
}
