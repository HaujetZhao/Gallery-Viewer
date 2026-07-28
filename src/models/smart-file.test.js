import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartFile } from './SmartFile';

// jsdom 的 URL.createObjectURL 对 mock 普通对象会抛,stub 之。
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
});

describe('SmartFile rehydrate', () => {
  it('toSnapshot 含 handle/name/size/lastModified/md5', () => {
    const handle = { name: 'a.jpg' };
    const f = new SmartFile({ handle, file: { name: 'a.jpg', size: 100, lastModified: 200 }, parent: null });
    f.md5 = 'abc';
    const snap = f.toSnapshot();
    expect(snap).toMatchObject({ handle, name: 'a.jpg', size: 100, lastModified: 200, md5: 'abc' });
  });

  it('fromSnapshot 重建:元数据可读,blobUrl 为 null(懒建)', () => {
    const handle = { name: 'a.jpg' };
    const snap = { handle, name: 'a.jpg', size: 100, lastModified: 200, md5: 'abc' };
    const f = SmartFile.fromSnapshot(snap, null);
    expect(f.size).toBe(100);
    expect(f.lastModified).toBe(200);
    expect(f.name).toBe('a.jpg');
    expect(f.md5).toBe('abc');
    expect(f.blobUrl).toBeNull();
  });

  it('ensureBlobUrl 从 handle.getFile 建 blobUrl', async () => {
    const handle = {
      name: 'a.jpg',
      getFile: vi.fn(async () => ({ name: 'a.jpg', size: 100, lastModified: 200 })),
    };
    const snap = { handle, name: 'a.jpg', size: 100, lastModified: 200, md5: null };
    const f = SmartFile.fromSnapshot(snap, null);
    const url = await f.ensureBlobUrl();
    expect(url).toBeTruthy();
    expect(handle.getFile).toHaveBeenCalled();
    expect(f.blobUrl).toBe(url);
    await f.ensureBlobUrl(); // 二次调不重复 IO
    expect(handle.getFile).toHaveBeenCalledTimes(1);
  });

  it('toSnapshot → fromSnapshot 往返一致', () => {
    const handle = { name: 'b.png' };
    const f = new SmartFile({ handle, file: { name: 'b.png', size: 999, lastModified: 111 }, parent: null });
    f.md5 = 'xyz';
    const f2 = SmartFile.fromSnapshot(f.toSnapshot(), null);
    expect(f2.name).toBe(f.name);
    expect(f2.size).toBe(f.size);
    expect(f2.lastModified).toBe(f.lastModified);
    expect(f2.md5).toBe(f.md5);
  });
});
