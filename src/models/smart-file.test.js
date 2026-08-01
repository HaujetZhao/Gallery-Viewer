import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire, destroy } from '../services/fileResource';
import { ensureBlobUrl, fileFromSnapshot, fileToSnapshot, SmartFile } from './SmartFile';
import { SmartFolder } from './SmartFolder';

// jsdom 的 URL.createObjectURL 对 mock 普通对象会抛,stub 之。
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn(() => {});
});

describe('smartFile rehydrate', () => {
  it('toSnapshot 含 handle/name/size/lastModified/md5', async () => {
    const handle = {
      name: 'a.jpg',
      getFile: vi.fn(async () => ({ name: 'a.jpg', size: 100, lastModified: 200 })),
    };
    const f = new SmartFile({ handle, parent: null });
    await acquire(f, { name: 'a.jpg', size: 100, lastModified: 200 });
    f._meta = { size: 100, lastModified: 200 }; // R4:_meta 单源(池不放 size/mtime)
    f.md5 = 'abc';
    const snap = fileToSnapshot(f);
    expect(snap).toMatchObject({ handle, name: 'a.jpg', size: 100, lastModified: 200, md5: 'abc' });
    destroy(f);
  });

  it('fromSnapshot 重建:元数据从 _meta 读,blobUrl 为 null(懒建)', () => {
    const handle = { name: 'a.jpg' };
    const snap = { handle, name: 'a.jpg', size: 100, lastModified: 200, md5: 'abc' };
    const f = fileFromSnapshot(snap, null);
    expect(f.size).toBe(100);
    expect(f.lastModified).toBe(200);
    expect(f.name).toBe('a.jpg');
    expect(f.md5).toBe('abc');
    expect(f.blobUrl).toBeNull();
  });

  it('ensureBlobUrl 从 handle.getFile 建 blobUrl(走池)', async () => {
    const handle = {
      name: 'a.jpg',
      getFile: vi.fn(async () => ({ name: 'a.jpg', size: 100, lastModified: 200 })),
    };
    const snap = { handle, name: 'a.jpg', size: 100, lastModified: 200, md5: null };
    const f = fileFromSnapshot(snap, null);
    const url = await ensureBlobUrl(f);
    expect(url).toBeTruthy();
    expect(handle.getFile).toHaveBeenCalled();
    expect(f.blobUrl).toBe(url);
    await ensureBlobUrl(f); // 二次调不重复 IO(池里复用)
    expect(handle.getFile).toHaveBeenCalledTimes(1);
    destroy(f);
  });

  it('toSnapshot → fromSnapshot 往返一致', async () => {
    const handle = {
      name: 'b.png',
      getFile: vi.fn(async () => ({ name: 'b.png', size: 999, lastModified: 111 })),
    };
    const f = new SmartFile({ handle, parent: null });
    await acquire(f, { name: 'b.png', size: 999, lastModified: 111 });
    f._meta = { size: 999, lastModified: 111 };
    f.md5 = 'xyz';
    const f2 = fileFromSnapshot(fileToSnapshot(f), null);
    expect(f2.name).toBe(f.name);
    expect(f2.size).toBe(f.size);
    expect(f2.lastModified).toBe(f.lastModified);
    expect(f2.md5).toBe(f.md5);
    destroy(f);
  });

  it('fileToSnapshot 不含 duration(已迁 file-meta store)', () => {
    const handle = { name: 'a.mp4' };
    const f = new SmartFile({ handle, parent: null });
    f._meta = { size: 100, lastModified: 1, duration: 9 };
    f.md5 = 'm1';
    const snap = fileToSnapshot(f);
    expect(snap.duration).toBeUndefined();
  });

  it('fileFromSnapshot 不读 duration(旧快照字段忽略,从 file-meta store 重载)', () => {
    const snap = { handle: {}, name: 'a.mp4', size: 1, lastModified: 1, duration: 9, md5: 'm1' };
    const f = fileFromSnapshot(snap, null);
    expect(f.duration).toBeUndefined();
  });
});

// T15:SmartFile.move 锚定 T08 关键改动——调 parent.removeFile + target.addFile,不内联 splice。
// 若回退成内联 splice(绕门面),断言失败(树维护不再走 folder 方法)。
describe('smartFile.move(T08:走 folder 方法,不内联 splice)', () => {
  it('move:源 removeFile + 目标 addFile + parent 更新(走 folder 方法,非内联 splice)', async () => {
    const source = new SmartFolder({ handle: { name: 'src', move: vi.fn(async () => {}) }, parent: null });
    const target = new SmartFolder({ handle: { name: 'tgt', move: vi.fn(async () => {}) }, parent: null });
    const file = new SmartFile({ handle: { name: 'a.jpg', move: vi.fn(async () => {}) }, parent: source });
    source.files = [file];

    const result = await file.move(target);

    expect(result).toBe(true);
    expect(source.files).not.toContain(file); // 源移除(走 folder.removeFile)
    expect(target.files).toContain(file); // 目标加入(走 folder.addFile)
    expect(file.parent).toBe(target); // parent 更新
  });

  it('move:缺父级 → 抛错', async () => {
    const file = new SmartFile({ handle: { name: 'a' }, parent: null });
    await expect(file.move({ handle: { name: 'tgt' } })).rejects.toThrow('缺少父级引用');
  });

  it('move:目标 handle 无效 → 抛错', async () => {
    const source = new SmartFolder({ handle: { name: 'src' }, parent: null });
    const file = new SmartFile({ handle: { name: 'a', move: vi.fn(async () => {}) }, parent: source });
    await expect(file.move({ handle: null })).rejects.toThrow('目标文件夹无效');
  });
});
