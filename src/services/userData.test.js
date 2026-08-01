import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteUserData, getUserData, putUserData } from './db';
import { ensureUserDataLoaded, setFavorite, setNote } from './userData';

vi.mock('./db', () => ({
  deleteUserData: vi.fn(async () => {}),
  getUserData: vi.fn(),
  putUserData: vi.fn(async () => {}),
}));

beforeEach(() => {
  getUserData.mockReset();
  putUserData.mockReset();
  deleteUserData.mockReset();
});

describe('userData', () => {
  it('ensureUserDataLoaded:取回 {favorite,note} 缓存,幂等', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true, note: 'x' });
    await ensureUserDataLoaded('m1');
    await ensureUserDataLoaded('m1'); // 第二次不再 get
    expect(getUserData).toHaveBeenCalledTimes(1);
  });

  it('setFavorite:读改写(保留 note)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', note: '保留' });
    await setFavorite('m1', true);
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: '保留' });
  });

  it('setNote:读改写(保留 favorite)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true });
    await setNote('m1', '新备注');
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: '新备注' });
  });

  it('setNote 空串 + 有 favorite → 保留条目(note 字段 undefined)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true, note: '旧' });
    await setNote('m1', '   ');
    expect(putUserData).toHaveBeenCalledWith('m1', { favorite: true, note: undefined });
    expect(deleteUserData).not.toHaveBeenCalled();
  });

  it('setFavorite false 且无 note → 删条目(writeUserData 空决策)', async () => {
    getUserData.mockResolvedValue({ md5: 'm1', favorite: true }); // 仅 favorite,取消后全空
    putUserData.mockClear();
    deleteUserData.mockClear();
    await setFavorite('m1', false);
    expect(deleteUserData).toHaveBeenCalledWith('m1');
    expect(putUserData).not.toHaveBeenCalled();
  });
});
