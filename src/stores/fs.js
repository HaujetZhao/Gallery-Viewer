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
  // per-folder 脏标记:Set<`${rootId}::${folder.path}`>。改一个文件只标它所属文件夹脏,
  // persistIfDirty 只重写 dirty 集合里的文件夹 record(治整树写放大)。切根 flush 后由 reset 清。
  const dirtyFolders = ref(new Set());

  // 初始化 ALL_MEDIA 虚拟文件夹(原 model.SmartFolder.js 模块加载副作用挪到这里)
  allMediaFolder.value = createAllMediaFolder();

  return { rootHandle, rootFolder, currentFolder, allMediaFolder, dirtyFolders };
});
