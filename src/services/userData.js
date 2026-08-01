// user-data store(md5 索引)门面:favorites+notes 聚合对象 {favorite?,note?}。
// 读改写合并(保留其他字段);加载结果内存缓存(幂等,避免视窗重复 get)。
// 此 service 不持有响应式状态——响应式镜像在 favorites/notes store,本 service 只管持久化。
import { deleteUserData, getUserData, putUserData } from './db';

// 已加载 md5 → {favorite?,note?}(内存缓存,懒加载幂等)。
const loaded = new Map();

export async function ensureUserDataLoaded(md5) {
  if (!md5)
    return null;
  if (loaded.has(md5))
    return loaded.get(md5);
  const data = await getUserData(md5);
  const normalized = data || {};
  loaded.set(md5, normalized);
  return normalized;
}

// 给 favorites/notes store 用:取已加载缓存(同步,ensureUserDataLoaded 后才有)。
export function peekUserData(md5) {
  return loaded.get(md5) || null;
}

export async function setFavorite(md5, favorite) {
  if (!md5)
    return;
  // 读改写:每次都重新 get 最新 store 状态(不读 loaded 缓存——避免外部改动后合并到旧值)。
  const cur = (await getUserData(md5)) || {};
  const next = { ...cur, favorite: favorite || undefined }; // false → undefined
  loaded.set(md5, next);
  await writeUserData(md5, next);
}

export async function setNote(md5, text) {
  if (!md5)
    return;
  const trimmed = (text ?? '').trim();
  // 读改写:每次都重新 get 最新 store 状态(同 setFavorite)。
  const cur = (await getUserData(md5)) || {};
  const next = { ...cur, note: trimmed || undefined }; // 空串不存
  loaded.set(md5, next);
  await writeUserData(md5, next);
}

// 写入决策:favorite 与 note 均空 → 删条目(保持 user-data store 精简——
// 用户数据量小,R16-a 全局筛选 cursor 量级才小);否则 putUserData(只存 truthy 字段)。
async function writeUserData(md5, next) {
  const { favorite, note } = next;
  if (!favorite && !note) {
    loaded.delete(md5);
    await deleteUserData(md5);
  }
  else {
    await putUserData(md5, { favorite, note });
  }
}

// 清缓存(切换场景预留,本 plan 暂不主动调)
export function invalidateUserData(md5) {
  if (md5)
    loaded.delete(md5);
  else loaded.clear();
}
