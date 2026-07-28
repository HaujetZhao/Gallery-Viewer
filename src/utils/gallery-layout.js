// Gallery 虚拟化布局纯函数(可单测,不依赖 Vue/DOM)。
// chunkRows:行优先切片,每行 n 项(末行可不足)。
// computeRowHeight:由容器宽度算固定行高 = 列宽(thumbnail aspect-ratio 1/1)+ 行间 gap。

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
 * 由容器宽度计算固定行高。行高 = 列宽 + gap(列宽即卡片高,thumbnail aspect-ratio 1/1)。
 * @param {number} containerWidth gallery-grid 实际宽度(clientWidth)
 * @param {number} colCount 列数
 * @param {number} gap 列/行间距
 * @returns {number} 行高;containerWidth<=0 或 colCount<=0 返回 0
 */
export function computeRowHeight(containerWidth, colCount, gap) {
  if (containerWidth <= 0 || colCount <= 0)
    return 0;
  const colWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  // 行高 = 列宽,依赖 thumbnail aspect-ratio 1/1(方形)。
  // 前瞻:未来若引入非方形缩略图策略,需同步改虚拟化(改用 measureElement 或动态行高),否则布局错位。
  return colWidth + gap;
}
