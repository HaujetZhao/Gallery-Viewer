import { describe, expect, it } from 'vitest';
import { chunkRows, computeRowHeight, DETAIL_INFO_HEIGHT } from './gallery-layout';

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
