// IndexedDB 缩略图缓存。搬自源码 js/db.js,纯逻辑(UI 副作用剥离到调用方)。
// 缓存键 id = `${md5}_${width}`。修两个陷阱:save 返回 Promise;新增 touch 刷新 lastAccessed。
import { CONFIG } from '../config/index';

const DB_NAME = CONFIG.DATABASE.NAME;
const DB_VERSION = CONFIG.DATABASE.VERSION;
const STORE_NAME = CONFIG.DATABASE.STORES.THUMBNAILS;
let db = null;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = reject;
  });
}

// 源码原本 fire-and-forget,改为返回 Promise(等 tx.oncomplete),便于调用方确认落盘。
export function saveThumbnailToDB(data) {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    }
    catch (e) {
      console.error('DB Save Error', e);
      resolve();
    }
  });
}

export function getThumbnailFromDB(md5, width) {
  return new Promise((resolve) => {
    if (!db) {
      resolve(null);
      return;
    }
    const req = db
      .transaction([STORE_NAME], 'readonly')
      .objectStore(STORE_NAME)
      .get(`${md5}_${width}`);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => resolve(null);
  });
}

// 命中缓存时刷新 lastAccessed(源码写入时只存 timestamp,cleanOldCache 读 lastAccessed||timestamp,
// 导致按创建时间清理。命中时 touch 一下,让最近访问的缓存不被误清)。
export function touchThumbnailInDB(id) {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const record = req.result;
      if (record) {
        record.lastAccessed = Date.now();
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// 清空全部。返回 Promise,UI 副作用(toast/redraw)由调用方处理。
export function clearAllCache() {
  return new Promise((resolve) => {
    if (!db) {
      resolve();
      return;
    }
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

// 清理 20 天未访问的。返回 { deletedCount },UI 副作用由调用方。
export function cleanOldCache() {
  return new Promise((resolve) => {
    if (!db) {
      resolve({ deletedCount: 0 });
      return;
    }
    const DAYS_20 = 20 * 24 * 60 * 60 * 1000;
    const threshold = Date.now() - DAYS_20;
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    let deletedCount = 0;
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const lastTime = cursor.value.lastAccessed || cursor.value.timestamp || Date.now();
        if (lastTime < threshold) {
          cursor.delete();
          deletedCount++;
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve({ deletedCount });
    tx.onerror = () => resolve({ deletedCount });
  });
}

export function deleteThumbnail(id) {
  if (!db)
    return;
  db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME).delete(id);
}
