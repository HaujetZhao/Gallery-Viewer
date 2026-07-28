import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config/index';
import { makeCancelToken } from '../utils/concurrency';
import { startBackgroundScan } from './filesystem';

// 假文件夹:只含 startBackgroundScan 用到的字段(subFolders / scan / enrich / treeNode)。
function fakeFolder(name, subFolders = []) {
  return {
    name,
    subFolders,
    scanned: false,
    scan: vi.fn(async () => {}),
    enrich: vi.fn(async () => {}), // Phase 2:startBackgroundScan 进入节点先 enrich 当前层
    treeNode: { refreshState: vi.fn(), destroy: vi.fn() },
  };
}

describe('startBackgroundScan', () => {
  it('递归遍历所有子文件夹(含嵌套),全部 scan 且传 trust:true', async () => {
    const c = fakeFolder('c');
    const b = fakeFolder('b');
    const a = fakeFolder('a', [c]);
    const root = fakeFolder('root', [a, b]);

    await startBackgroundScan(root);

    expect(a.scan).toHaveBeenCalledWith({ trust: true });
    expect(b.scan).toHaveBeenCalledWith({ trust: true });
    expect(c.scan).toHaveBeenCalledWith({ trust: true });
    // Phase 2:进入每个节点先 enrich 当前层(补 size/mtime)
    expect(root.enrich).toHaveBeenCalled();
    expect(a.enrich).toHaveBeenCalled();
    expect(c.enrich).toHaveBeenCalled();
  });

  it('无 subFolders 时安全返回(undefined / 空)', async () => {
    const root = fakeFolder('root', []);
    await expect(startBackgroundScan(root)).resolves.toBeUndefined();
    await expect(startBackgroundScan(null)).resolves.toBeUndefined();
  });

  it('取消:首批在途时 cancel,超出并发上限的不再派发', async () => {
    const cap = CONFIG.PERFORMANCE.SCAN_FOLDER_CONCURRENCY;
    let resolveHold;
    const hold = new Promise((r) => {
      resolveHold = r;
    });
    const scanned = [];
    const subs = Array.from({ length: cap + 2 }, (_, i) => {
      const f = fakeFolder(`s${i}`);
      f.scan = vi.fn(async () => {
        scanned.push(i);
        await hold; // 全部卡住,模拟在途
      });
      return f;
    });
    const root = fakeFolder('root', subs);

    const token = makeCancelToken();
    const done = startBackgroundScan(root, token);
    await new Promise(r => setTimeout(r, 20)); // 让首批 cap 个启动
    token.cancel();
    resolveHold(); // 放行首批
    await done;

    expect(scanned.length).toBe(cap); // 首 cap 个启动,剩 2 因 cancel 不派发
  });
});
