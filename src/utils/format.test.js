import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatFileSize, windowsCompareStrings } from './format';

describe('formatFileSize', () => {
  it('0 → "0 B"', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
  it('小于 1KB 去尾零(100 → "100 B" 非 "100.00 B")', () => {
    expect(formatFileSize(100)).toBe('100 B');
    expect(formatFileSize(500)).toBe('500 B');
  });
  it('1024 → "1 KB"', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });
  it('1536 → "1.5 KB"', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });
  it('1048576 → "1 MB"', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });
});

describe('formatBytes', () => {
  it('0 → "0 Bytes"', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });
});

describe('windowsCompareStrings', () => {
  it('数字按数值比较(file2 < file10)', () => {
    expect(windowsCompareStrings('file2', 'file10')).toBeLessThan(0);
    expect(windowsCompareStrings('file10', 'file2')).toBeGreaterThan(0);
  });
  it('相等返回 0', () => {
    expect(windowsCompareStrings('abc', 'abc')).toBe(0);
  });
  it('中文比较不抛错', () => {
    expect(typeof windowsCompareStrings('相册', '照片')).toBe('number');
  });
});

describe('formatDate', () => {
  it('返回非空日期字符串', () => {
    const s = formatDate(0);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
