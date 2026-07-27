/**
 * TreeNode - 文件树数据节点。搬自源码 js/model.TreeNode.js 并退化为纯数据节点。
 * 源码原本是 DOM 操作类(createRoot/setActive 切 class 等),Vue 后 DOM 渲染交给 Sidebar.vue 的 v-for(folder.subFolders),
 * 本类只保留「展开/空状态 + 文件计数」;源码的 children 数组 / syncChildren diff / addChild / removeChild / active 激活态
 * 在响应式下均无用(激活态改由 store.currentFolder 单一来源),迁移审查时已删。
 */

// 模块级注册表:仅做内存管理(unregister)。
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
    this.expanded = true;
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

  toggleExpanded() {
    this.expanded = !this.expanded;
  }

  destroy() {
    treeNodeRegistry.unregister(this);
  }
}
