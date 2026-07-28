import { describe, expect, it, vi } from 'vitest';
import { makeCancelToken, runConcurrent } from './concurrency';

// 工具:可控的 deferred(用于精确观察并发/取消时机)。
function defer() {
  let resolve;
  let reject;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise: p, resolve, reject };
}

// 工具:worker 记录在途数,await 一个 tick,用于断言并发上限。
function trackingWorker(maxRef, activeRef) {
  return async (item) => {
    activeRef.value++;
    maxRef.value = Math.max(maxRef.value, activeRef.value);
    await new Promise(r => setTimeout(r, 0));
    activeRef.value--;
    return item * 2;
  };
}

describe('runConcurrent', () => {
  it('保序返回所有结果', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runConcurrent(items, x => Promise.resolve(x * 2), { concurrency: 2 });
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('空数组立即返回空', async () => {
    const results = await runConcurrent([], () => Promise.resolve(1));
    expect(results).toEqual([]);
  });

  it('并发上限不超(concurrency=2)', async () => {
    const max = { value: 0 };
    const active = { value: 0 };
    await runConcurrent([0, 1, 2, 3, 4, 5, 6, 7], trackingWorker(max, active), { concurrency: 2 });
    expect(max.value).toBeLessThanOrEqual(2);
    expect(max.value).toBeGreaterThanOrEqual(2); // 确实并发了,不是串行(=1)
  });

  it('错误隔离:一个抛错不影响其余,该位为 undefined', async () => {
    const onError = vi.fn();
    const results = await runConcurrent(
      [1, 2, 3],
      (x) => { return x === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(x); },
      { concurrency: 3, onError },
    );
    expect(results[0]).toBe(1);
    expect(results[1]).toBeUndefined();
    expect(results[2]).toBe(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(2); // 传入出错的 item
  });

  it('取消:token.cancel 后不再派发新任务,在途完成后 resolve', async () => {
    const token = makeCancelToken();
    const ran = [];
    const d = defer();
    let calls = 0;
    const worker = async (item) => {
      calls++;
      ran.push(item);
      if (item === 0) {
        await d.promise; // 第一个卡住,期间取消
      }
    };
    const done = runConcurrent([0, 1, 2, 3], worker, { concurrency: 1, token });
    // 给 item 0 启动的机会
    await new Promise(r => setTimeout(r, 5));
    token.cancel(); // 此时 item 0 在途,后续不应再派发
    d.resolve(); // 放行 item 0
    await done;
    expect(calls).toBe(1); // 只跑了 item 0
    expect(ran).toEqual([0]);
  });
});

describe('makeCancelToken', () => {
  it('初始未取消,cancel 后变 true', () => {
    const token = makeCancelToken();
    expect(token.cancelled).toBe(false);
    token.cancel();
    expect(token.cancelled).toBe(true);
  });

  it('多次 cancel 幂等', () => {
    const token = makeCancelToken();
    token.cancel();
    token.cancel();
    expect(token.cancelled).toBe(true);
  });
});
