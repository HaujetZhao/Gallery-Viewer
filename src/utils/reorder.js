// 重排模式工具:序号编排、文件名前缀组合、多列 grid 落点。
// 纯函数,无 Vue/IO 依赖,可单测(见 reorder.test.js)。

// 数字位数(按总数定宽:300 张 → 3 位)。total<=0 兜底 1。
export function padWidth(total) {
  return Math.max(1, String(Math.max(1, total)).length);
}

// 序号补零:padSeq(7, 3) → '007'。
export function padSeq(seq, width) {
  return String(seq).padStart(width, '0');
}

// 剥离本工具上一轮加的前缀(NNN_),可重复应用不叠加。
// 只认「开头一串数字 + 下划线」:原生 IMG_0042(开头非纯数字)、123abc(无下划线)均不误剥。
export function stripOldPrefix(name) {
  return name.replace(/^\d+_/, '');
}

// 视觉 index(0-based)→ 序号。升序 index+1;降序 total-index(视觉首位拿最大号)。
// 视觉顺序(A B C D E)不变,只随方向反转编号映射。
export function seqForIndex(index, total, direction) {
  return direction === 'asc' ? index + 1 : total - index;
}

// 组合新名:NNN_原名(已剥旧前缀)。扩展名随原名保留。
export function composeName(origName, seq, width) {
  return `${padSeq(seq, width)}_${stripOldPrefix(origName)}`;
}

// 多列 grid 落点:遍历「非被拖」cell 的 rect(按显示顺序),返回指针应插入的索引。
// 规则:指针「越过」cell i = 在 cell 下方整行,或同行且过 cell 水平中线;第一个未越过的即插入点。
// ponytail: O(n) 遍历,几百张够用;万图升级=R-tree/虚拟化命中。
// cellRects:DOMRect-like 数组({top,bottom,left,right,width,height ...}),已剔除被拖项、按显示顺序。
export function computeGridInsertIndex(clientX, clientY, cellRects) {
  for (let i = 0; i < cellRects.length; i++) {
    const r = cellRects[i];
    const passed = clientY > r.bottom
      || (clientY >= r.top && clientX > r.left + r.width / 2);
    if (!passed)
      return i;
  }
  return cellRects.length;
}
