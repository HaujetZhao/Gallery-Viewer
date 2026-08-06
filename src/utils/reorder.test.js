import { describe, expect, it } from 'vitest';
import { composeName, computeGridInsertIndex, padSeq, padWidth, seqForIndex, stripOldPrefix } from './reorder';

describe('padWidth', () => {
  it('按总数定宽', () => {
    expect(padWidth(1)).toBe(1);
    expect(padWidth(9)).toBe(1);
    expect(padWidth(10)).toBe(2);
    expect(padWidth(99)).toBe(2);
    expect(padWidth(300)).toBe(3);
  });
  it('<=0 兜底 1 位', () => {
    expect(padWidth(0)).toBe(1);
    expect(padWidth(-5)).toBe(1);
  });
});

describe('padSeq', () => {
  it('补零到位', () => {
    expect(padSeq(7, 3)).toBe('007');
    expect(padSeq(12, 3)).toBe('012');
    expect(padSeq(123, 3)).toBe('123');
    expect(padSeq(1, 1)).toBe('1');
  });
});

describe('stripOldPrefix', () => {
  it('剥离本工具前缀 NNN_', () => {
    expect(stripOldPrefix('007_x.jpg')).toBe('x.jpg');
    expect(stripOldPrefix('001_a.jpg')).toBe('a.jpg');
  });
  it('不误剥原生名(开头非纯数字+下划线)', () => {
    expect(stripOldPrefix('IMG_0042.jpg')).toBe('IMG_0042.jpg');
    expect(stripOldPrefix('DSC_0017.jpg')).toBe('DSC_0017.jpg');
    expect(stripOldPrefix('wallpaper.jpg')).toBe('wallpaper.jpg');
  });
  it('不误剥纯数字开头但无下划线', () => {
    expect(stripOldPrefix('123abc.jpg')).toBe('123abc.jpg');
  });
});

describe('seqForIndex', () => {
  it('升序:index+1', () => {
    expect(seqForIndex(0, 5, 'asc')).toBe(1);
    expect(seqForIndex(4, 5, 'asc')).toBe(5);
  });
  it('降序:total-index(首位拿最大号,视觉顺序不变)', () => {
    expect(seqForIndex(0, 5, 'desc')).toBe(5);
    expect(seqForIndex(4, 5, 'desc')).toBe(1);
    expect(seqForIndex(2, 5, 'desc')).toBe(3);
  });
});

describe('composeName', () => {
  it('前缀+原名,保留扩展名', () => {
    expect(composeName('IMG_0042.jpg', 7, 3)).toBe('007_IMG_0042.jpg');
    expect(composeName('wallpaper.jpg', 9, 3)).toBe('009_wallpaper.jpg');
  });
  it('剥旧前缀后再编号(可重复应用)', () => {
    expect(composeName('007_x.jpg', 5, 3)).toBe('005_x.jpg');
    expect(composeName('001_009_IMG.jpg', 3, 3)).toBe('003_009_IMG.jpg');
  });
});

// rect 工厂:模拟 DOMRect(left/right/top/bottom/width/height)
function rect(left, top, w, h) {
  return { left, top, right: left + w, bottom: top + h, width: w, height: h };
}

describe('computeGridInsertIndex', () => {
  // 4 列单行:cells 在 (0,0) (10,0) (20,0) (30,0),各 10x10
  const row = [rect(0, 0, 10, 10), rect(10, 0, 10, 10), rect(20, 0, 10, 10), rect(30, 0, 10, 10)];

  it('行首插入', () => {
    expect(computeGridInsertIndex(1, 5, row)).toBe(0); // 第 0 格左半
  });
  it('行内某格左半 → 插它前', () => {
    expect(computeGridInsertIndex(21, 5, row)).toBe(2); // 第 2 格左半
  });
  it('行末右半 → 末尾', () => {
    expect(computeGridInsertIndex(36, 5, row)).toBe(4); // 越过所有
  });
  it('指针在网格上方 → 最前', () => {
    expect(computeGridInsertIndex(5, -5, row)).toBe(0);
  });

  // 跨行:第一行 y=0,第二行 y=20
  const grid = [rect(0, 0, 10, 10), rect(10, 0, 10, 10), rect(0, 20, 10, 10), rect(10, 20, 10, 10)];
  it('跨行:指针在第二行左 → 插第二行首', () => {
    expect(computeGridInsertIndex(1, 22, grid)).toBe(2);
  });
  it('跨行:指针在第一行末右半 → 越过第一行落到第二行首', () => {
    expect(computeGridInsertIndex(18, 5, grid)).toBe(2); // 第 0、1 都 passed,落到第 2
  });
  it('空列表 → 0', () => {
    expect(computeGridInsertIndex(0, 0, [])).toBe(0);
  });
});
