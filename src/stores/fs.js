// 文件系统 store。搬自源码 js/state.js 的 appState,改为 Pinia setup store。
// 持有 rootHandle/rootFolder/currentFolder/foldersData/allMediaFolder;通过静态注入让 SmartFolder 访问。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { SmartFolder, createAllMediaFolder } from '../models/SmartFolder.js';

export const useFsStore = defineStore('fs', () => {
  const rootHandle = ref(null); // FileSystemDirectoryHandle
  const rootFolder = ref(null); // 根 SmartFolder(Sidebar 树根)
  const currentFolder = ref(null); // SmartFolder(当前显示)
  const foldersData = ref(new Map()); // path -> SmartFolder(去重缓存)
  const allMediaFolder = ref(null); // ALL_MEDIA 虚拟文件夹

  // 静态注入:SmartFolder 通过 SmartFolder.appState.foldersData/rootHandle 访问 store。
  SmartFolder.appState = {
    get rootHandle() {
      return rootHandle.value;
    },
    get foldersData() {
      return foldersData.value;
    },
  };

  // 初始化 ALL_MEDIA 虚拟文件夹(原 model.SmartFolder.js 模块加载副作用挪到这里)
  allMediaFolder.value = createAllMediaFolder();
  foldersData.value.set('ALL_MEDIA', allMediaFolder.value);

  return { rootHandle, rootFolder, currentFolder, foldersData, allMediaFolder };
});
