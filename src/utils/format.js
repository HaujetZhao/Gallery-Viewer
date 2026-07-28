// 格式化与排序工具。搬自源码 js/utils.js,无外部依赖。

export function formatFileSize(bytes) {
  if (bytes === 0)
    return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString();
}

// Windows 风格自然排序(数字按数值比较,中文 zh-CN)
export function windowsCompareStrings(a, b) {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

export function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// 相对时间(刚刚 / N 分钟前 / N 小时前 / N 天前 / 超 7 天回退日期)。
export function formatRelativeTime(ts) {
  if (!ts)
    return '';
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min)
    return '刚刚';
  if (diff < hour)
    return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day)
    return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day)
    return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString();
}
