import { describe, expect, it } from 'vitest';
import { fitOriginalRatioParams } from './coverFit';

describe('fitOriginalRatioParams(最短边=targetSize 原比例)', () => {
  it('横屏 1920×1080 → 短边 1080=targetSize,长边按比例', () => {
    const { dw, dh } = fitOriginalRatioParams(1920, 1080, 400);
    expect(dh).toBe(400);
    expect(dw).toBeCloseTo(400 * 1920 / 1080, 0);
    // 保留原始宽高比(取整允许 ±0.5% 偏差)
    expect(dw / dh).toBeCloseTo(1920 / 1080, 2);
  });
  it('竖屏 1080×1920 → 短边 1080=targetSize,长边按比例', () => {
    const { dw, dh } = fitOriginalRatioParams(1080, 1920, 400);
    expect(dw).toBe(400);
    expect(dh / dw).toBeCloseTo(1920 / 1080, 2);
  });
  it('方形 → 边长=targetSize', () => {
    expect(fitOriginalRatioParams(400, 400, 300)).toEqual({ dw: 300, dh: 300 });
  });
  it('小数取整且至少 1px', () => {
    const r = fitOriginalRatioParams(1000, 1000, 300);
    expect(r.dw).toBe(300);
    expect(r.dh).toBe(300);
    // 极小图(1×1)最短边 targetSize → 不坍缩到 0
    expect(fitOriginalRatioParams(1, 1, 100).dw).toBeGreaterThanOrEqual(1);
  });
  it('任意 targetSize 缩放', () => {
    const r = fitOriginalRatioParams(2000, 1000, 500);
    expect(r.dh).toBe(500);
    expect(r.dw).toBe(1000);
  });
});
