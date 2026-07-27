/**
 * TreeNode - 文件树数据节点。搬自源码 js/model.TreeNode.js 并退化为纯数据节点。
 * 源码原本是 DOM 操作类(createRoot/createSpecial、setActive 切 class 等),Vue 后 DOM 渲染交给 Sidebar.vue 的 v-for,
 * 本类只保留树数据结构 + 展开/激活/空状态 + syncChildren diff 算法(用于增量扫描后同步状态)。
 */
import { windowsCompareStrings } from '../utils/format.js';

// 模块级注册表:仅做内存管理(unregister),不再管 activeNode(激活态单一来源交 store.currentFolder)
export const treeNodeRegistry = {
  nodes: new Set(),
  register(node) {
    this.nodes.add(node);
  },
  unregister(node) {
    this.nodes.delete(node);
  },
};

export class TreeNode {
  constructor(folder) {
    this.folder = folder;
    this.children = [];
    this.expanded = true;
    this.active = false;
    this.isEmpty = true;
    treeNodeRegistry.register(this);
  }

  get count() {
    return this.folder.files.length;
  }

  refreshState() {
    // scan 之后调用,重算空状态
    this.isEmpty = this.folder.files.length === 0 && this.folder.subFolders.length === 0;
  }

  setActive() {
    this.active = true;
  }
  setInactive() {
    this.active = false;
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
  }

  // 按名称排序插入到 children 数组(替代源码的 insertBefore DOM 操作)
  addChild(childNode) {
    if (this.children.includes(childNode)) return;
    this.children.push(childNode);
    this.children.sort((a, b) => windowsCompareStrings(a.folder.name, b.folder.name));
  }

  removeChild(childNode) {
    const i = this.children.indexOf(childNode);
    if (i > -1) this.children.splice(i, 1);
  }

  // 核心 diff 算法:增量扫描后同步子节点,保留已存在节点对象(展开/激活态不丢)。
  // 算法逻辑一字不改照搬源码,仅 addChild/removeChild 已改为数据操作。
  async syncChildren(subFolders) {
    // 1. 找出需要移除的节点
    const newFolderNames = new Set(subFolders.map((f) => f.name));
    const currentChildren = [...this.children]; // 复制,removeChild 会改 this.children

    for (const childNode of currentChildren) {
      if (!newFolderNames.has(childNode.folder.name)) {
        this.removeChild(childNode);
      }
    }

    // 2. 找出需要添加的节点
    const currentFolderNames = new Set(this.children.map((c) => c.folder.name));

    for (const subFolder of subFolders) {
      if (!currentFolderNames.has(subFolder.name)) {
        if (!subFolder.treeNode) {
          console.error('Subfolder missing treeNode', subFolder);
          continue;
        }
        if (!subFolder.scanned) {
          await subFolder.scan();
        }
        this.addChild(subFolder.treeNode);
      }
    }
  }

  destroy() {
    treeNodeRegistry.unregister(this);
    this.children = [];
  }
}
