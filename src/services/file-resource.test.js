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
});
