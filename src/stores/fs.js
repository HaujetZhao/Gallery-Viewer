// 文件系统 store。搬自源码 js/state.js 的 appState,改为 Pinia setup store。
// 持有 rootHandle/currentFolder/foldersData/allMediaFolder;通过静态注入让 SmartFolder 访问(保持 model 纯逻辑)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { SmartFolder, createAllMediaFolder } from '../models/SmartFolder.js';

export const useFsStore = defineStore('fs', () => {
  const rootHandle = ref(null); // FileSystemDirectoryHandle
  const currentFolder = ref(null); // SmartFolder
  const foldersData = ref(new Map()); // path -> SmartFolder(去重缓存)
  const allMediaFolder = ref(null); // ALL_MEDIA 虚拟文件夹

  // 静态注入:SmartFolder 通过 SmartFolder.appState.foldersData/rootHandle 访问 store,
  // 不直接 import pinia,保持 model 纯逻辑。
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

  // 临时:打开根目录并扫描。阶段 4 filesystem service 做好后替换为完整实现(含权限/recovery)。
  async function openRoot() {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'photo-viewer-start',
      startIn: 'pictures',
    });
    rootHandle.value = handle;
    const result = await SmartFolder.create({ handle });
    currentFolder.value = result.folder;
    foldersData.value.set(result.folder.path, result.folder);
    return result;
  }

  return { rootHandle, currentFolder, foldersData, allMediaFolder, openRoot };
});
