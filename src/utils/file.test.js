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

// 造 JPEG buffer:SOI(FFD8)+ APP0 段 + SOF0 段(精度/高@+3/宽@+5)。
// 锁 SOF 偏移回归:旧代码读 offset+1 当宽(段长低位+精度=0x1108=4360 垃圾)、offset+3(真高)当宽。
function makeJpegBuffer(w, h) {
  // SOI(2) + APP0(2+16) + SOF0(2+8)
  const buf = new ArrayBuffer(2 + 18 + 10);
  const v = new DataView(buf);
  let p = 0;
  v.setUint16(p, 0xFFD8); p += 2; // SOI
  // APP0 段:marker FFE0 + length 16 + "JFIF"\0 + ...
  v.setUint16(p, 0xFFE0); p += 2;
  v.setUint16(p, 16); p += 2; // length=16
  v.setUint32(p, 0x4A464946); p += 4; // "JFIF"
  // 剩 10 字节填 0(版本/密度/缩略图),跳过
  p = 2 + 18;
  // SOF0 段:marker FFC0 + length(8+3*Nf,Nf=3 → 17) + precision(1) + height(2) + width(2) + Nf(1)
  v.setUint16(p, 0xFFC0); p += 2;
  v.setUint16(p, 17); p += 2; // length=17(0x0011)
  v.setUint8(p, 8); p += 1; // precision=8
  v.setUint16(p, h); p += 2; // height
  v.setUint16(p, w); p += 2; // width
  v.setUint8(p, 3); // Nf=3
  return new File([buf], 't.jpg', { type: 'image/jpeg' });
}

describe('getImageInfoFromHeader', () => {
  it('读 PNG width/height(零解码魔数)', async () => {
    expect(await getImageInfoFromHeader(makePngBuffer(800, 600))).toEqual([800, 600, 'png']);
  });
  it('读 JPEG width/height(SOF 偏移回归锁:width@offset+5,height@offset+3)', async () => {
    // 旧 bug:返回 [height, 4360(段长17+精度8=0x1108)] → 缩略图 resize 强拉压扁
    expect(await getImageInfoFromHeader(makeJpegBuffer(8736, 4360))).toEqual([8736, 4360, 'jpg']);
  });
  it('小文件(<30 字节) → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(10)], 'tiny'))).toBeNull();
  });
  it('不支持格式 → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(64).fill(0)], 'unknown'))).toBeNull();
  });
});
