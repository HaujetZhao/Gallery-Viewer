import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire, destroy, peek } from './fileResource';

// jsdom 的 URL.createObjectURL 对 mock 普通对象会抛,stub 之。
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
});

// 造假 SmartFile:acquire 内部调 file.handle.getFile(),所以假对象有 handle.getFile 即可。
function fakeFile({ name = 'a.jpg', size = 100, lastModified = 200 } = {}) {
  return {
    handle: {
      name,
      getFile: vi.fn(async () => ({ name, size, lastModified })),
    },
  };
}

describe('fileResource acquire', () => {
  it('acquire 返回 entry 且建 url、缓存 file、调 getFile 一次', async () => {
    const f = fakeFile({ name: 'a.jpg', size: 100, lastModified: 200 });
    const entry = await acquire(f);
    expect(entry.url).toBe('blob:fake');
    expect(entry.file).toMatchObject({ name: 'a.jpg', size: 100, lastModified: 200 });
    expect(f.handle.getFile).toHaveBeenCalledTimes(1);
  });

  it('同 file 重复 acquire:只 getFile 一次、url 复用(池去重)', async () => {
    const f = fakeFile();
    const e1 = await acquire(f);
    const e2 = await acquire(f);
    expect(e1).toBe(e2); // 复用
    expect(f.handle.getFile).toHaveBeenCalledTimes(1);
  });

  it('preloaded 复用已 fetch 的 File,不调 handle.getFile', async () => {
    const f = fakeFile();
    const preloaded = { name: 'pre.jpg', size: 999, lastModified: 888 };
    const entry = await acquire(f, preloaded);
    expect(entry.file).toBe(preloaded);
    expect(f.handle.getFile).not.toHaveBeenCalled();
  });

  it('并发 acquire 同 file:共享一次 getFile + 一个 url(in-flight 去重,不泄漏)', async () => {
    const f = fakeFile();
    const [e1, e2] = await Promise.all([acquire(f), acquire(f)]);
    expect(e1).toBe(e2); // 复用同一 entry
    expect(f.handle.getFile).toHaveBeenCalledTimes(1); // 只 getFile 一次(in-flight 合并)
    destroy(f);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); // 一个 url → 一次 revoke(无泄漏)
  });

  it('降级只读(handle null):从 file._file 取,不崩(修 acquire 撞 null handle)', async () => {
    const rawFile = new File(['x'], 'a.jpg');
    const f = { handle: null, _file: rawFile }; // 降级 SmartFile:无 handle,持 _file
    const entry = await acquire(f);
    expect(entry.file).toBe(rawFile);
    expect(entry.url).toBe('blob:fake');
  });
});

describe('fileResource peek / destroy', () => {
  it('peek 未 acquire 返回 null', () => {
    const f = fakeFile();
    expect(peek(f)).toBeNull();
  });

  it('destroy 强制 revoke 且清池', async () => {
    const f = fakeFile();
    await acquire(f);
    destroy(f);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(peek(f)).toBeNull();
  });

  it('destroy 未 acquire 的 file 无副作用(不抛)', () => {
    const f = fakeFile();
    expect(() => destroy(f)).not.toThrow();
  });

  it('r6: destroy 建中(inflight)file → 建完即 drop,不 set pool(根治边角泄漏)', async () => {
    const f = fakeFile();
    let resolveGetFile;
    f.handle.getFile = vi.fn(() => new Promise((r) => {
      resolveGetFile = r;
    })); // 卡住 getFile,让 acquire 停在 inflight
    const p = acquire(f); // 启动 acquire(进入 inflight)
    await new Promise(r => setTimeout(r, 0)); // 让 inflight 建
    expect(peek(f)).toBeNull(); // 还在 inflight,pool 空
    destroy(f); // 建中 destroy → 标记 cancelled
    resolveGetFile({ name: 'a.jpg', size: 100, lastModified: 200 }); // 放行 getFile
    await p; // acquire 完成
    expect(peek(f)).toBeNull(); // 建完 drop,不 set pool(不泄漏)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); // drop revoke 了 url
  });

  // reject 路径:destroy 在 inflight 期间标记 cancelled,随后 getFile reject。
  // 修复前:reject 抛出走 finally,只清 inflight,cancelled 残留该 SmartFile 引用(泄漏 + 阻止 GC);
  // 后续同 file 再 acquire(成功)会命中残留的 cancelled 标记 → 错误 drop,peek 仍 null。
  it('r6+: inflight destroy + getFile reject → cancelled 不残留(后续 acquire 正常 set pool)', async () => {
    const f = fakeFile();
    // 用 controller 卡住 getFile:resolve/reject 由我们手动触发,避免 setTimeout 竞态。
    let rejectGetFile;
    f.handle.getFile = vi.fn(() => new Promise((_r, rej) => {
      rejectGetFile = rej;
    }));

    const p = acquire(f); // 启动 acquire(同步进入 inflight)
    await new Promise(r => setTimeout(r, 0)); // 让 inflight 标记落定
    destroy(f); // 建中 destroy → 标记 cancelled
    rejectGetFile(new Error('boom')); // 触发 getFile reject → acquire 抛出走 finally
    await expect(p).rejects.toThrow('boom'); // 接住(避免 unhandled)
    // 此时 inflight 已清;若 finally 没补 cancelled.delete,cancelled 仍持有 f

    // 第二轮:同 file 再 acquire(这次 getFile 成功)。
    // 修复前:cancelled 残留 → acquire 命中 cancelled 走 drop 路径 → peek(f) 仍 null(回归 bug)。
    // 修复后:cancelled 在第一轮 finally 已清 → acquire 正常 set pool → peek(f) 拿到 entry。
    f.handle.getFile = vi.fn(async () => ({ name: 'a.jpg', size: 100, lastModified: 200 }));
    await acquire(f);
    expect(peek(f)).not.toBeNull(); // 关键断言:pool 必须有 entry(证明 cancelled 没残留)
  });
});
