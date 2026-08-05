// Gallery 虚拟化布局纯函数(可单测,不依赖 Vue/DOM)。
// chunkRows:行优先切片,每行 n 项(末行可不足)。
// computeRowHeight:由容器宽度算固定行高 = 列宽(thumbnail aspect-ratio 1/1)+ 卡内信息区高度 + 行间 gap。

// detail 卡片样式(cardStyle='detail')图下方信息区的固定高度(px)。
// 文件名 1 行 + meta 1 行 + 上下 padding,按 PhotoCard card-style-detail 实测校准。
// ponytail: 一个常量,PhotoCard CSS 与 Gallery 行高共用同一来源避免漂移;未来真有第二种非零 extra 再抽象。
export const DETAIL_INFO_HEIGHT = 46;

/**
 * 行优先切片。
 * @param {Array} list
 * @param {number} n 每行项数
 * @returns {Array<Array>} 行数组;n<=0 返回 []
 */
export function chunkRows(list, n) {
  if (n <= 0)
    return [];
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * 视频悬浮满幅等比拓展的几何(单测,不依赖 DOM)。
 * 方形卡里 `object-fit:cover` 的视频横屏裁左右、竖屏裁上下;精确匹配比例时拓展只发生在被裁那一维,
 * 另一维保持列宽(卡占位不变 → 虚拟化行高/滚动不受影响)。
 * @param {number} colWidth 列宽 px
 * @param {number} videoW videoWidth(0/undefined → 不拓展)
 * @param {number} videoH videoHeight
 * @returns {{width:number,height:number,translateX:number,translateY:number,expanded:boolean}}
 *   - r>=1(横屏):宽=colWidth*r,高=colWidth,仅水平居中平移(默认向左溢出)
 *   - r<1(竖屏):高=colWidth/r,宽=colWidth,仅垂直居中平移(默认向下溢出)
 *   - 无效尺寸 / 近似方形(r≈1,无被裁部分)→ expanded=false,各尺寸取列宽默认。
 */
export function computeVideoExpand(colWidth, videoW, videoH) {
  if (colWidth <= 0 || !videoW || !videoH) {
    return { width: colWidth, height: colWidth, translateX: 0, translateY: 0, expanded: false };
  }
  const r = videoW / videoH;
  if (Math.abs(r - 1) < 0.05) {
    return { width: colWidth, height: colWidth, translateX: 0, translateY: 0, expanded: false };
  }
  if (r >= 1) {
    const width = colWidth * r;
    return { width, height: colWidth, translateX: -(width - colWidth) / 2, translateY: 0, expanded: true };
  }
  const height = colWidth / r;
  return { width: colWidth, height, translateX: 0, translateY: -(height - colWidth) / 2, expanded: true };
}

/**
 * 由容器宽度计算固定行高。行高 = 列宽(=方形卡高)+ 每卡额外高度 + gap。
 * @param {number} containerWidth gallery-grid 实际宽度(clientWidth)
 * @param {number} colCount 列数
 * @param {number} gap 列/行间距
 * @param {number} [extraPerCard] 每张卡除方形缩略图外的额外高度(detail 样式 = DETAIL_INFO_HEIGHT,其他 = 0)
 * @returns {number} 行高;containerWidth<=0 或 colCount<=0 返回 0
 */
export function computeRowHeight(containerWidth, colCount, gap, extraPerCard = 0) {
  if (containerWidth <= 0 || colCount <= 0)
    return 0;
  const colWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  // 行高 = 列宽,依赖 thumbnail aspect-ratio 1/1(方形)。
  // 前瞻:未来若引入非方形缩略图策略,需同步改虚拟化(改用 measureElement 或动态行高),否则布局错位。
  return colWidth + extraPerCard + gap;
}
