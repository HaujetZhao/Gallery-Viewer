import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setDegraded } from '../utils/browser';
import { useFsStore } from './fs';
import { useHistoryStore } from './history';

// history.js import afterFolderMutation from persistence;mock 掉避免真 timer + 隔离落盘断言。
vi.mock('../services/persistence', () => ({ afterFolderMutation: vi.fn() }));

describe('history undoLastOperation', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('undo 失败 → op 留栈顶 + 不落盘(T02 Bug2:失败不丢栈)', async () => {
    const history = useHistoryStore();
    const { afterFolderMutation } = await import('../services/persistence');
    afterFolderMutation.mockClear();

    const failingOp = {
      execute: vi.fn(async () => {}),
      undo: vi.fn(async () => { throw new Error('磁盘失败'); }),
      getAffectedFolders: () => [{}],
      getDescription: () => '测试操作',
    };
    await history.executeOperation(failingOp);
    expect(history.stack.length).toBe(1);
    afterFolderMutation.mockClear(); // executeOperation 自身会落盘一次;清掉后只观察 undo 路径

    await expect(history.undoLastOperation()).rejects.toThrow('磁盘失败');
    expect(history.stack.length).toBe(1); // op 仍在栈顶(未丢,可重试)
    expect(failingOp.undo).toHaveBeenCalledTimes(1);
    expect(afterFolderMutation).not.toHaveBeenCalled(); // 失败不落盘
  });

  it('undo 成功 → pop + 落盘', async () => {
    const history = useHistoryStore();
    const { afterFolderMutation } = await import('../services/persistence');
    afterFolderMutation.mockClear();

    const okOp = {
      execute: vi.fn(async () => {}),
      undo: vi.fn(async () => {}),
      getAffectedFolders: () => [{}],
      getDescription: () => '测试操作',
    };
    await history.executeOperation(okOp);
    await history.undoLastOperation();
    expect(history.stack.length).toBe(0); // 成功 pop
    expect(afterFolderMutation).toHaveBeenCalled(); // 成功落盘
  });

  it('空栈 → undo 抛错', async () => {
    const history = useHistoryStore();
    await expect(history.undoLastOperation()).rejects.toThrow();
  });
});

describe('executeOperation 降级总闸', () => {
  afterEach(() => _setDegraded(false));

  it('降级 + 无根句柄 → 抛错,不执行操作不入栈', async () => {
    _setDegraded(true);
    useFsStore().rootHandle = null;
    const history = useHistoryStore();
    const op = { execute: vi.fn(async () => {}), getAffectedFolders: () => [] };
    await expect(history.executeOperation(op)).rejects.toThrow('只读模式');
    expect(op.execute).not.toHaveBeenCalled();
    expect(history.stack.length).toBe(0);
  });

  it('降级但有根句柄(边缘)→ 仍放行(总闸判定 rootHandle 缺失)', async () => {
    _setDegraded(true);
    useFsStore().rootHandle = { name: 'root' };
    const history = useHistoryStore();
    const op = { execute: vi.fn(async () => {}), getAffectedFolders: () => [] };
    await history.executeOperation(op);
    expect(op.execute).toHaveBeenCalled();
  });
});
