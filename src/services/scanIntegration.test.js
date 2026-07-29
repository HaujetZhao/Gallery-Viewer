import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFsStore } from '../stores/fs';
import { useHistoryStore } from '../stores/history';
import { integrateScanResult, resetFoldersData } from './scanIntegration';

beforeEach(() => {
  setActivePinia(createPinia());
});

// integrateScanResult:增删检测置 fs.rootDirty(无增删不置)。
describe('integrateScanResult dirty', () => {
  it('有新增文件 → 置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [{}], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(true);
  });

  it('有删除文件夹 → 置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [{}] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(true);
  });

  it('无增删(trust 短路)→ 不置 dirty', () => {
    const fs = useFsStore();
    fs.rootDirty = false;
    const folder = { files: [], subFolders: [] };
    const result = { files: [], subFolders: [], newFiles: [], newSubFolders: [], removedFiles: [], removedFolders: [] };
    integrateScanResult(folder, result, fs);
    expect(fs.rootDirty).toBe(false);
  });
});

describe('resetFoldersData 清撤销栈(T02 Bug1:切根防跨根撤销)', () => {
  it('调 resetFoldersData → history 栈被清空', () => {
    const fs = useFsStore();
    const history = useHistoryStore();
    history.stack.push({ undo: vi.fn(), getDescription: () => '旧根操作' });
    expect(history.stack.length).toBe(1);

    resetFoldersData(fs);

    expect(history.stack.length).toBe(0); // 切根清栈
  });
});
