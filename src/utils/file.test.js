import { describe, expect, it } from 'vitest';
import { calculateMD5, getImageInfoFromHeader } from './file';

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

// 造 PNG buffer:8字节签名 + IHDR(width@16, height@20, 大端)。size 须 >=30(函数 size<30 守卫)
function makePngBuffer(w, h) {
  const buf = new ArrayBuffer(30);
  const v = new DataView(buf);
  v.setUint32(0, 0x89504E47);
  v.setUint32(4, 0x0D0A1A0A);
  v.setUint32(8, 13); // IHDR length
  v.setUint32(12, 0x49484452); // "IHDR"
  v.setUint32(16, w); // width BE
  v.setUint32(20, h); // height BE
  return new File([buf], 't.png', { type: 'image/png' });
}

describe('getImageInfoFromHeader', () => {
  it('读 PNG width/height(零解码魔数)', async () => {
    expect(await getImageInfoFromHeader(makePngBuffer(800, 600))).toEqual([800, 600, 'png']);
  });
  it('小文件(<30 字节) → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(10)], 'tiny'))).toBeNull();
  });
  it('不支持格式 → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(64).fill(0)], 'unknown'))).toBeNull();
  });
});
