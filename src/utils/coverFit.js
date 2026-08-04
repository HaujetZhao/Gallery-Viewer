// cover-fit 几何纯函数:把 (srcW × srcH) 等比缩放「盖满」targetSize 方形,返回 9 参 drawImage 的目标矩形。
// 主线程策略(image/video/audio)+ 缩略图 worker 池共用,消除四处手抄的 ratio/dx/dy 数学。
// 纯数学,无 DOM 依赖——可被 worker 模块直接 import。
export function coverFitParams(srcW, srcH, targetSize) {
  const ratio = Math.max(targetSize / srcW, targetSize / srcH);
  const dw = srcW * ratio;
  const dh = srcH * ratio;
  return { dx: (targetSize - dw) / 2, dy: (targetSize - dh) / 2, dw, dh };
}
