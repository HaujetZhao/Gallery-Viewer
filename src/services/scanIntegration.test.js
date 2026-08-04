import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFsStore } from '../stores/fs';
import { useHistoryStore } from '../stores/history';
import { useRootStore } from '../stores/root';
import { integrateScanResult, resetFoldersData } from './scanIntegration';

beforeEach(() => {
  setActivePinia(createPinia());
});

// integrateScanResult:增删检测标「该文件夹」脏(per-folder:进 fs.dirtyFolders Set;无增删不标)。
// markFolderDirty 经 persistence 用 currentRootId + folder.path 构 key,故需 setCurrent + folder.path。
function setupRoot() {
  const root = useRootStore();
  root.add('r1', 'root', 0, 0);
  root.setCurrent('r1');
  return useFsStore();
}

describe('integrateScanResult dirty(per-folder)', () => {
  it('有新增文件 → 标该夹脏', () => {
    const fs = setupRoot();
    const folder = { path: 'root', files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [{}], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result);
    expect(fs.dirtyFolders.has('r1::root')).toBe(true);
  });

  it('有删除文件夹 → 标该夹脏', () => {
    const fs = setupRoot();
    const folder = { path: 'root', files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [{}] };
    integrateScanResult(folder, result);
    expect(fs.dirtyFolders.has('r1::root')).toBe(true);
  });

  it('无增删(trust 短路)→ 不标脏', () => {
    const fs = setupRoot();
    const folder = { path: 'root', files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result);
    expect(fs.dirtyFolders.size).toBe(0);
  });

  it('新发现的空子文件夹也标脏(防重建时父夹引用了它、map 无 record → 被丢)', () => {
    const fs = setupRoot();
    const folder = { path: 'root', files: [], subFolders: [] };
    const emptySub = { path: 'root/empty' };
    const result = { files: [], subFolders: [emptySub], newFiles: [], newSubFolders: [emptySub], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result);
    expect(fs.dirtyFolders.has('r1::root')).toBe(true); // 父夹(发现新子夹)
    expect(fs.dirtyFolders.has('r1::root/empty')).toBe(true); // 空子夹也得落盘
  });
});

describe('resetFoldersData 清撤销栈(T02 Bug1:切根防跨根撤销)+ 清 dirty', () => {
  it('调 resetFoldersData → history 栈 + dirtyFolders 都清空', () => {
    const fs = setupRoot();
    const history = useHistoryStore();
    history.stack.push({ undo: vi.fn(), getDescription: () => '旧根操作' });
    fs.dirtyFolders.add('r1::root/sub');
    expect(history.stack.length).toBe(1);
    expect(fs.dirtyFolders.size).toBe(1);

    resetFoldersData(fs);

    expect(history.stack.length).toBe(0); // 切根清栈
    expect(fs.dirtyFolders.size).toBe(0); // 切根清 dirty
  });
});
