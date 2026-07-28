import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire, destroy, peek, release } from './fileResource';

// jsdom 的 URL.createObjectURL 对 mock 普通对象会抛,stub 之。
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
});

afterEach(() => {
  // 池内残留全部强制释放,避免用例间相互污染
  destroyAllForTest();
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

// 测试辅助:清空池。peek 暴露后,这里通过遍历已知引用 destroy。
// 简化:本测试用例都用局部引用,destroy 显式调即可;无残留依赖。
function destroyAllForTest() {}

describe('fileResource acquire', () => {
  it('acquire 返回 entry 且建 url、缓存 size/mtime、调 getFile 一次', async () => {
    const f = fakeFile({ name: 'a.jpg', size: 100, lastModified: 200 });
    const entry = await acquire(f);
    expect(entry.url).toBe('blob:fake');
    expect(entry.size).toBe(100);
    expect(entry.mtime).toBe(200);
    expect(entry.file).toMatchObject({ name: 'a.jpg', size: 100, lastModified: 200 });
    expect(f.handle.getFile).toHaveBeenCalledTimes(1);
  });

  it('同 file 重复 acquire(同 owner):只 getFile 一次、url 复用、owners 不重复', async () => {
    const f = fakeFile();
    const e1 = await acquire(f);
    const e2 = await acquire(f); // 同 owner (默认 file)
    expect(e1).toBe(e2); // 复用
    expect(f.handle.getFile).toHaveBeenCalledTimes(1);
    expect(e1.owners.size).toBe(1);
  });

  it('同 file 不同 owner acquire:只 getFile 一次、url 复用、owners 记两个', async () => {
    const f = fakeFile();
    const ownerA = { id: 'A' };
    const ownerB = { id: 'B' };
    const e1 = await acquire(f, ownerA);
    const e2 = await acquire(f, ownerB);
    expect(e1).toBe(e2);
    expect(f.handle.getFile).toHaveBeenCalledTimes(1);
    expect(e2.owners.size).toBe(2);
    expect(e2.owners.has(ownerA)).toBe(true);
    expect(e2.owners.has(ownerB)).toBe(true);
  });

  it('preloaded 复用已 fetch 的 File,不调 handle.getFile', async () => {
    const f = fakeFile();
    const preloaded = { name: 'pre.jpg', size: 999, lastModified: 888 };
    const entry = await acquire(f, f, preloaded);
    expect(entry.size).toBe(999);
    expect(entry.mtime).toBe(888);
    expect(f.handle.getFile).not.toHaveBeenCalled();
  });
});

describe('fileResource release / peek / destroy', () => {
  it('peek 未 acquire 返回 null', () => {
    const f = fakeFile();
    expect(peek(f)).toBeNull();
  });

  it('release 减 owner,未归零 url 仍可 peek;归零后 revoke 且 peek 返回 null', async () => {
    const f = fakeFile();
    const ownerA = { id: 'A' };
    const ownerB = { id: 'B' };
    await acquire(f, ownerA);
    await acquire(f, ownerB);
    expect(peek(f)).not.toBeNull();

    release(f, ownerA); // 还剩 ownerB
    expect(peek(f)).not.toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    release(f, ownerB); // 归零
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(peek(f)).toBeNull();
  });

  it('release 未 acquire 的 file 无副作用(不抛)', () => {
    const f = fakeFile();
    expect(() => release(f, f)).not.toThrow();
  });

  it('release 默认 owner(=file 自身)', async () => {
    const f = fakeFile();
    await acquire(f); // 默认 owner = f
    release(f); // 默认 owner = f,应能匹配
    expect(peek(f)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('destroy 强制 revoke(即使有 owner)且清池', async () => {
    const f = fakeFile();
    await acquire(f, { id: 'A' });
    await acquire(f, { id: 'B' });
    destroy(f);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(peek(f)).toBeNull();
  });

  it('destroy 未 acquire 的 file 无副作用(不抛)', () => {
    const f = fakeFile();
    expect(() => destroy(f)).not.toThrow();
  });
});
