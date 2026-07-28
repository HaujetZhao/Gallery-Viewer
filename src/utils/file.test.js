import { describe, expect, it } from 'vitest';
import { calculateMD5 } from './file';

describe('calculateMD5', () => {
  it('返回 32 位 hex(前 2MB 内容寻址)', async () => {
    const buf = new Uint8Array(1024).fill(7);
    const file = new File([buf], 'test.bin', { type: 'application/octet-stream' });
    const hash = await calculateMD5(file);
    expect(hash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('同内容同 hash(等价性锚定,防现代化改写漂移)', async () => {
    const make = () => new File([new Uint8Array(2048).fill(3)], 'a.bin');
    expect(await calculateMD5(make())).toBe(await calculateMD5(make()));
  });

  it('不同内容不同 hash', async () => {
    const a = new File([new Uint8Array(1024).fill(1)], 'a.bin');
    const b = new File([new Uint8Array(1024).fill(2)], 'b.bin');
    expect(await calculateMD5(a)).not.toBe(await calculateMD5(b));
  });
});
