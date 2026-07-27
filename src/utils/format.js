// 格式化与排序工具。搬自源码 js/utils.js,无外部依赖。

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0)
    return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(decimals))} ${sizes[i]}`;
}

export function formatFileSize(bytes) {
  if (bytes === 0)
    return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
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
