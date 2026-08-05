import { describe, expect, it } from 'vitest';
import { chunkRows, computeRowHeight, computeVideoExpand, DETAIL_INFO_HEIGHT } from './gallery-layout';

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
  it('detail 样式:行高 = 列宽 + DETAIL_INFO_HEIGHT + gap', () => {
    // 列宽 = 238.75;行高 = 238.75 + 46 + 15 = 299.75
    expect(computeRowHeight(1000, 4, 15, DETAIL_INFO_HEIGHT)).toBeCloseTo(238.75 + DETAIL_INFO_HEIGHT + 15, 5);
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
