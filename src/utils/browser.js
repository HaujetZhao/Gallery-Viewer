// 浏览器兼容检测。搬自源码 js/browser-compatibility.js 的纯检测函数。
// DOM 注入逻辑(checkBrowserCompatibility/showIncompatibilityAlert)不迁,阶段 7 以组件重写。

export function getBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox'))
    return 'Firefox';
  if (ua.includes('Edg'))
    return 'Microsoft Edge'; // 必须在 Chrome 之前判(Edge UA 含 Chrome)
  if (ua.includes('Chrome'))
    return 'Chrome';
  if (ua.includes('Safari'))
    return 'Safari';
  if (ua.includes('Opera') || ua.includes('OPR'))
    return 'Opera';
  return '未知浏览器';
}

export function isFileSystemAccessSupported() {
  return typeof window.showDirectoryPicker === 'function';
}
