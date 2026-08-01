// R15:md5 哈希 Web Worker。主线程读出前 2MB ArrayBuffer(transfer 零拷贝)传入,
// worker 内 SparkMD5 计算后回传 hash。chunkSize 锁定 2MB(旧 IDB key 兼容)。
import SparkMD5 from 'spark-md5';

globalThis.onmessage = (e) => {
  const { id, buffer } = e.data || {};
  try {
    const hash = SparkMD5.ArrayBuffer.hash(buffer);
    globalThis.postMessage({ id, hash });
  }
  catch (err) {
    globalThis.postMessage({ id, error: err?.message || String(err) });
  }
};
