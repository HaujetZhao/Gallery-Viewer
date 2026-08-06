// Gallery 虚拟化布局纯函数(可单测,不依赖 Vue/DOM)。
// chunkRows:行优先切片,每行 n 项(末行可不足)。
// computeRowHeight:由容器宽度算「行高估算值」= 列宽(thumbnail aspect-ratio 1/1)+ 卡内额外高度 + 行间 gap。
// 仅供 virtualizer 的 estimateSize 用(未测量行的滚动条估算);实际行高由 measureElement 实测,不再依赖此函数精确。

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
 * 时间排序键:EXIF 拍摄时间优先,否则文件修改时间。缺失(未加载/非图片)→ undefined 排末尾。
 * 供 Gallery sortByKey 的 date 分支用。
 * @param {object} file
 * @returns {number|undefined}
 */
export function dateSortValue(file) {
  return file.capturedAt ?? file.lastModified;
}

/**
 * 冻结排序的「空位插槽」:把当前仍在 folder.files 里的文件按其冻结序号铺进固定跨度数组,
 * 被删除/移出的文件序号留空(null)——卡片位置不动、空位保持,其余不重排。
 * 新文件(无冻结序号)不在此(move-in 走追加序号后进入 frozenOrder,下一轮生效)。
 * @param {Array} files 当前 folder.files(实时)
 * @param {Map} order frozenOrder(file → 序号)
 * @param {number} slotCount 跨度 = 已分配最大序号 + 1(freeze 或追加后更新)
 * @returns {Array<object|null>} 按序号索引的槽位,空位为 null
 */
export function buildSlots(files, order, slotCount) {
  const byOrdinal = new Map();
  for (const f of files) {
    const o = order.get(f);
    if (o != null)
      byOrdinal.set(o, f);
  }
  const arr = Array.from({ length: slotCount }).fill(null);
  for (const [o, f] of byOrdinal) {
    if (o >= 0 && o < slotCount)
      arr[o] = f;
  }
  return arr;
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
 * 由容器宽度计算「行高估算值」(供 virtualizer estimateSize,未测量行的滚动条估算;实际行高由 measureElement 实测)。
 * 行高 = 列宽(=方形卡高)+ 每卡额外高度 + gap。
 * @param {number} containerWidth gallery-grid 实际宽度(clientWidth)
 * @param {number} colCount 列数
 * @param {number} gap 列/行间距
 * @param {number} [extraPerCard] 每张卡除方形缩略图外的额外高度估算(detail 样式给个约值即可,实测会修正)
 * @returns {number} 行高估算;containerWidth<=0 或 colCount<=0 返回 0
 */
export function computeRowHeight(containerWidth, colCount, gap, extraPerCard = 0) {
  if (containerWidth <= 0 || colCount <= 0)
    return 0;
  const colWidth = (containerWidth - (colCount - 1) * gap) / colCount;
  return colWidth + extraPerCard + gap;
}
