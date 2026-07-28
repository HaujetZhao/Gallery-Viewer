// 并发原语:scan getFile 批处理 + 后台目录遍历共用。
// runConcurrent:并发上限 runner,保序返回,错误隔离(单失败不影响其余)。
// makeCancelToken:取消令牌,切根时让在途后台遍历在批次间隙退出(修原 startBackgroundScan 无取消的竞态)。

/**
 * 取消令牌。{ cancelled, cancel() }。
 */
export function makeCancelToken() {
  return {
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  };
}

/**
 * 并发执行 worker,最多 concurrency 个在途。
 * @param {Array} items
 * @param {(item, index) => Promise<any>} worker
 * @param {object} opts { concurrency=8, token?, onError?(item, err) }
 * @returns Promise<Array> 与 items 等长、保序;worker 抛错处为 undefined(并调 onError)。
 *         token.cancel 后不再派发新任务,已在途的跑完后整体 resolve(返回部分结果)。
 */
export async function runConcurrent(items, worker, opts = {}) {
  const { concurrency = 8, token, onError } = opts;
  const results = Array.from({ length: items.length });
  let cursor = 0;
  let active = 0;

  return new Promise((resolve) => {
    const launch = () => {
      // 取消:不再派发新任务;等在途完成后 resolve
      while (!token?.cancelled && active < concurrency && cursor < items.length) {
        const i = cursor++;
        active++;
        Promise.resolve()
          .then(() => worker(items[i], i))
          .then(
            (r) => { results[i] = r; },
            (err) => {
              results[i] = undefined;
              if (onError)
                onError(items[i], err);
            },
          )
          .finally(() => {
            active--;
            // 全部跑完,或被取消且无在途任务 → 收尾 resolve(取消时返回部分结果)
            if (active === 0 && (token?.cancelled || cursor >= items.length))
              resolve(results);
            else
              launch();
          });
      }
      if (active === 0 && (token?.cancelled || cursor >= items.length))
        resolve(results);
    };
    launch();
  });
}
