import { describe, expect, it, vi } from 'vitest';
import { getFileMeta, putFileMeta } from './db';
import { ensureFileMetaLoaded, saveFileMeta } from './fileMeta';

vi.mock('./db', () => ({
  getFileMeta: vi.fn(),
  putFileMeta: vi.fn(),
}));

describe('fileMeta', () => {
  it('ensureFileMetaLoaded:命中则填 _meta(幂等)', async () => {
    getFileMeta.mockResolvedValue({ md5: 'm1', duration: 12.5, width: 1920 });
    const file = { md5: 'm1', _meta: { size: 100 } };
    await ensureFileMetaLoaded(file);
    expect(file._meta.duration).toBe(12.5);
    expect(file._meta.width).toBe(1920);
  });

  it('ensureFileMetaLoaded:无 md5 跳过(不抛)', async () => {
    getFileMeta.mockClear();
    const file = { md5: null, _meta: {} };
    await expect(ensureFileMetaLoaded(file)).resolves.toBeUndefined();
    expect(getFileMeta).not.toHaveBeenCalled();
  });

  it('ensureFileMetaLoaded:_meta.duration 已有则不重复读', async () => {
    getFileMeta.mockClear();
    const file = { md5: 'm1', _meta: { duration: 5 } };
    await ensureFileMetaLoaded(file);
    expect(getFileMeta).not.toHaveBeenCalled();
  });

  it('saveFileMeta:put + 填 _meta', async () => {
    putFileMeta.mockClear();
    const file = { md5: 'm1', _meta: {} };
    await saveFileMeta(file, { duration: 9, width: 1080 });
    expect(putFileMeta).toHaveBeenCalledWith('m1', { duration: 9, width: 1080 });
    expect(file._meta.duration).toBe(9);
    expect(file._meta.width).toBe(1080);
  });

  it('ensureFileMetaLoaded:store 无记录不报错(_meta 不变)', async () => {
    getFileMeta.mockResolvedValue(null);
    const file = { md5: 'm1', _meta: {} };
    await ensureFileMetaLoaded(file);
    expect(file._meta.duration).toBeUndefined();
  });
});
