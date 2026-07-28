// 文件系统 store。搬自源码 js/state.js 的 appState,改为 Pinia setup store。
// 持有 rootHandle/rootFolder/currentFolder/foldersData/allMediaFolder。
// Phase 3 Step 2:删 SmartFolder.appState 静态注入 —— fromSnapshot 纯函数化,foldersData 注册归
// service 层(filesystem.js 的 registerFolderTree / integrateScanResult),model 不再反向依赖 store。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { createAllMediaFolder } from '../models/SmartFolder';

export const useFsStore = defineStore('fs', () => {
  const rootHandle = ref(null); // FileSystemDirectoryHandle
  const rootFolder = ref(null); // 根 SmartFolder(Sidebar 树根)
  const currentFolder = ref(null); // SmartFolder(当前显示)
  const foldersData = ref(new Map()); // path -> SmartFolder(去重缓存)
  const allMediaFolder = ref(null); // ALL_MEDIA 虚拟文件夹

  // 初始化 ALL_MEDIA 虚拟文件夹(原 model.SmartFolder.js 模块加载副作用挪到这里)
  allMediaFolder.value = createAllMediaFolder();
  foldersData.value.set('ALL_MEDIA', allMediaFolder.value);

  return { rootHandle, rootFolder, currentFolder, foldersData, allMediaFolder };
});
