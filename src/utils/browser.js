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

// 降级只读模式标志(webkitdirectory 建树,无持久句柄)。模块级单例,sync 可读。
// 由 folderActions 的降级入口在会话开/关时设/清。UI 置灰、history 总闸、model 短路都读它。
let _degraded = false;
export function isDegradedFSA() {
  return _degraded;
}
export function _setDegraded(v) {
  _degraded = v;
}
