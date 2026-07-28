import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartFile } from './SmartFile';
import { SmartFolder } from './SmartFolder';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
  SmartFolder.appState = { foldersData: new Map() };
});

function buildTree() {
  const root = new SmartFolder({ handle: { name: 'root' }, parent: null });
  const sub = new SmartFolder({ handle: { name: 'sub' }, parent: root });
  root.subFolders = [sub];
  sub.files = [new SmartFile({ handle: { name: 'a.jpg' }, file: { name: 'a.jpg', size: 5, lastModified: 9 }, parent: sub })];
  root.scanned = true;
  sub.scanned = true;
  root.treeNode.expanded = false;
  return root;
}

describe('SmartFolder rehydrate', () => {
  it('toSnapshot 序列化整棵树(name/scanned/expanded/subFolders/files)', () => {
    const root = buildTree();
    const snap = root.toSnapshot();
    expect(snap.name).toBe('root');
    expect(snap.scanned).toBe(true);
    expect(snap.expanded).toBe(false);
    expect(snap.subFolders).toHaveLength(1);
    expect(snap.subFolders[0].name).toBe('sub');
    expect(snap.subFolders[0].files[0].name).toBe('a.jpg');
  });

  it('fromSnapshot 重建树 + parent 接回 + expanded 恢复', () => {
    const snap = buildTree().toSnapshot();
    SmartFolder.appState.foldersData.clear();
    const root2 = SmartFolder.fromSnapshot(snap, null);

    expect(root2.name).toBe('root');
    expect(root2.subFolders).toHaveLength(1);
    expect(root2.subFolders[0].name).toBe('sub');
    expect(root2.subFolders[0].parent).toBe(root2);
    expect(root2.subFolders[0].files[0].name).toBe('a.jpg');
    expect(root2.subFolders[0].files[0].size).toBe(5);
    expect(root2.treeNode.expanded).toBe(false);
  });

  it('fromSnapshot 每节点注册 appState.foldersData(按 path)', () => {
    const snap = buildTree().toSnapshot();
    SmartFolder.appState.foldersData.clear();
    const root2 = SmartFolder.fromSnapshot(snap, null);
    expect(SmartFolder.appState.foldersData.get('root')).toBe(root2);
    expect(SmartFolder.appState.foldersData.get('root/sub')).toBe(root2.subFolders[0]);
  });
});
