import { describe, expect, it } from 'vitest';
import { buildSlots, chunkRows, computeRowHeight, computeVideoExpand, dateSortValue } from './gallery-layout';

describe('chunkRows', () => {
  it('空数组返回空', () => {
    expect(chunkRows([], 3)).toEqual([]);
  });
  it('5 项 n=2 → 3 行(末行 1 项)', () => {
    expect(chunkRows([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
  });
  it('n=1 → 每项一行', () => {
    expect(chunkRows([0, 1, 2], 1)).toEqual([[0], [1], [2]]);
  });
  it('n >= length → 单行', () => {
    expect(chunkRows([0, 1], 5)).toEqual([[0, 1]]);
  });
  it('n <= 0 → 空(防御)', () => {
    expect(chunkRows([0, 1, 2], 0)).toEqual([]);
    expect(chunkRows([0, 1, 2], -1)).toEqual([]);
  });
});

describe('computeRowHeight', () => {
  it('width=1000 colCount=4 gap=15 → 列宽 238.75 + gap = 253.75', () => {
    // 列宽 = (1000 - 3*15)/4 = 955/4 = 238.75;行高 = 238.75 + 15 = 253.75
    expect(computeRowHeight(1000, 4, 15)).toBeCloseTo(253.75, 5);
  });
  it('colCount=1 → width + gap', () => {
    expect(computeRowHeight(500, 1, 15)).toBe(515);
  });
  it('width<=0 → 0', () => {
    expect(computeRowHeight(0, 4, 15)).toBe(0);
  });
  it('colCount<=0 → 0', () => {
    expect(computeRowHeight(1000, 0, 15)).toBe(0);
  });
  it('extraPerCard 默认 0(三参调用回归)', () => {
    expect(computeRowHeight(1000, 4, 15)).toBeCloseTo(253.75, 5);
  });
  it('带额外高度(extraPerCard):行高 = 列宽 + extra + gap', () => {
    // 列宽 = 238.75;行高 = 238.75 + 50 + 15 = 303.75
    expect(computeRowHeight(1000, 4, 15, 50)).toBeCloseTo(303.75, 5);
  });
});

describe('dateSortValue', () => {
  it('拍摄时间优先于文件时间', () => {
    expect(dateSortValue({ capturedAt: 100, lastModified: 200 })).toBe(100);
  });
  it('无 EXIF 时间 → 文件修改时间', () => {
    expect(dateSortValue({ lastModified: 200 })).toBe(200);
    expect(dateSortValue({ capturedAt: null, lastModified: 300 })).toBe(300);
  });
  it('两者都无 → undefined(排末尾)', () => {
    expect(dateSortValue({})).toBeUndefined();
  });
});

describe('buildSlots', () => {
  const mk = (name, id) => ({ name, id });
  it('铺满:跨度=文件数,无空位', () => {
    const files = [mk('a', 0), mk('b', 1), mk('c', 2)];
    const order = new Map(files.map((f, i) => [f, i]));
    expect(buildSlots(files, order, 3)).toEqual([files[0], files[1], files[2]]);
  });
  it('删除中间文件 → 该槽位 null,其余原位不动', () => {
    const a = mk('a', 0);
    const b = mk('b', 1);
    const c = mk('c', 2);
    const order = new Map([[a, 0], [b, 1], [c, 2]]);
    // b 被删除(不在 files),span 保持 3
    expect(buildSlots([a, c], order, 3)).toEqual([a, null, c]);
  });
  it('删除末尾文件 → 尾部空位保留(跨度不变)', () => {
    const a = mk('a', 0);
    const b = mk('b', 1);
    const order = new Map([[a, 0], [b, 1]]);
    expect(buildSlots([a], order, 2)).toEqual([a, null]);
  });
  it('新文件(无序号)不占槽位,等待下一轮追加', () => {
    const a = mk('a', 0);
    const newcomer = mk('new', 99);
    const order = new Map([[a, 0]]);
    expect(buildSlots([a, newcomer], order, 1)).toEqual([a]);
  });
  it('span 越界序号忽略(防御)', () => {
    const a = mk('a', 0);
    const order = new Map([[a, 5]]);
    expect(buildSlots([a], order, 3)).toEqual([null, null, null]);
  });
});

describe('computeVideoExpand', () => {
  const W = 200; // 列宽
  it('横屏 16:9 → 宽=colWidth*16/9,高保持 colWidth,仅水平平移', () => {
    const { width, height, translateX, translateY, expanded } = computeVideoExpand(W, 1920, 1080);
    expect(expanded).toBe(true);
    expect(width).toBeCloseTo(W * 16 / 9, 5);
    expect(height).toBe(W);
    expect(translateX).toBeCloseTo(-(width - W) / 2, 5);
    expect(translateY).toBe(0);
  });
  it('竖屏 9:16 → 高=colWidth*16/9,宽保持 colWidth,仅垂直平移', () => {
    const { width, height, translateX, translateY, expanded } = computeVideoExpand(W, 1080, 1920);
    expect(expanded).toBe(true);
    expect(width).toBe(W);
    expect(height).toBeCloseTo(W * 16 / 9, 5);
    expect(translateX).toBe(0);
    expect(translateY).toBeCloseTo(-(height - W) / 2, 5);
  });
  it('近似方形(±5%)→ 不拓展,各尺寸取列宽', () => {
    const r = computeVideoExpand(W, 1000, 1010); // r≈0.99
    expect(r.expanded).toBe(false);
    expect(r.width).toBe(W);
    expect(r.height).toBe(W);
    expect(r.translateX).toBe(0);
    expect(r.translateY).toBe(0);
  });
  it('无效尺寸(videoW=0 / 未定义)→ 不拓展', () => {
    expect(computeVideoExpand(W, 0, 1080).expanded).toBe(false);
    expect(computeVideoExpand(W, undefined, 1080).expanded).toBe(false);
    expect(computeVideoExpand(0, 1920, 1080).expanded).toBe(false);
  });
});
