// 文件系统 store。搬自源码 js/state.js 的 appState,改为 Pinia setup store。
// 持有 rootHandle/rootFolder/currentFolder/allMediaFolder。
// T06:rootFolder 单 ref 深代理持整棵树(folder 挂树即被代理化,不再需要 path→folder 的 Map 缓存)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { createAllMediaFolder } from '../models/SmartFolder';

export const useFsStore = defineStore('fs', () => {
  const rootHandle = ref(null); // FileSystemDirectoryHandle
  const rootFolder = ref(null); // 根 SmartFolder(Sidebar 树根;ref 深代理持整棵树,T06)
  const currentFolder = ref(null); // SmartFolder(当前显示)
  const allMediaFolder = ref(null); // ALL_MEDIA 虚拟文件夹(单独 ref,不在 rootFolder 树)
  const rootDirty = ref(false); // 树变更标记:scanFolder 增删 / 文件操作(rename/delete/move)置脏;persistIfDirty 清

  // 初始化 ALL_MEDIA 虚拟文件夹(原 model.SmartFolder.js 模块加载副作用挪到这里)
  allMediaFolder.value = createAllMediaFolder();

  return { rootHandle, rootFolder, currentFolder, allMediaFolder, rootDirty };
});
