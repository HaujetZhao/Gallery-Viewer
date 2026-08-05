// cover-fit 几何纯函数:把 (srcW × srcH) 等比缩放「盖满」targetSize 方形,返回 9 参 drawImage 的目标矩形。
// 主线程策略(image/video/audio)+ 缩略图 worker 池共用,消除四处手抄的 ratio/dx/dy 数学。
// 纯数学,无 DOM 依赖——可被 worker 模块直接 import。
export function coverFitParams(srcW, srcH, targetSize) {
  const ratio = Math.max(targetSize / srcW, targetSize / srcH);
  const dw = srcW * ratio;
  const dh = srcH * ratio;
  return { dx: (targetSize - dw) / 2, dy: (targetSize - dh) / 2, dw, dh };
}

// 原始比例(contain)几何纯函数:把 (srcW × srcH) 等比缩放到「最短边 = targetSize」,画布即原比例、满幅无裁。
// 用于悬浮「放大」样式——缩略图存原始比例,卡片方形 cover 裁切显示,hover 时能露全图。
// 纯数学,无 DOM 依赖,worker/主线程共用。返回 drawImage 目标尺寸 { dw, dh }(dx/dy 恒 0)。
export function fitOriginalRatioParams(srcW, srcH, targetSize) {
  // 最短边 = targetSize:ratio = targetSize / min(srcW, srcH)。
  // (注意不是 min(targetSize/srcW, targetSize/srcH) —— 那等于长边=targetSize,方向反了。)
  const ratio = targetSize / Math.min(srcW, srcH);
  return {
    dw: Math.max(1, Math.round(srcW * ratio)),
    dh: Math.max(1, Math.round(srcH * ratio)),
  };
}
