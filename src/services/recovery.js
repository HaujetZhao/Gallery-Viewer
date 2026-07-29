import { findValidFolderAncestor, scanFolder } from '../models/SmartFolder';
// 句柄失效恢复服务。搬自源码 js/recovery.js。
// 失效检测由调用方触发(validate 失败 / NotFoundError);本服务负责:找祖先→重扫→递归扫新增子目录。
import { useFsStore } from '../stores/fs';
import { startBackgroundScan } from './folderActions';
import { integrateScanResult } from './scanIntegration';

// 文件夹失效恢复。返回恢复后的可用祖先 SmartFolder,或 null(根也失效)。
// T06:integrateScanResult 把 newSubFolders 写到 validAncestor.subFolders(挂代理数组 → 代理化),
// 从树里拿到代理引用后 startBackgroundScan(单 ref 持树后 folder 挂树即代理)。
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
  // integrateScanResult 内含:写回 files/subFolders + dispose removedFiles。
  const result = await scanFolder(validAncestor);
  integrateScanResult(validAncestor, result, fs);

  // 对新增子文件夹递归后台扫描(T06:newSubFolders 已挂到 validAncestor.subFolders 代理化,从树拿到代理)。
  if (result.newSubFolders?.length) {
    for (const newFolder of result.newSubFolders) {
      const proxy = validAncestor.subFolders.find(s => s.path === newFolder.path) || newFolder;
      await startBackgroundScan(proxy);
    }
  }
  return validAncestor;
}
