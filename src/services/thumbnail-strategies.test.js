// 缩略图生成策略测试。
// 重点验证 R3-1 关键改动:image 策略用 createImageBitmap 解码(而非 new Image),
// 且传 { imageOrientation: 'from-image' } 保持 EXIF 方向等价性,bitmap 用完 close()。
//
// jsdom 不实现 createImageBitmap / canvas getContext 真渲染 / toBlob 真编码,全部 mock。
//
// mock 策略:
// - createImageBitmap:vi.stubGlobal 桩,返回假 ImageBitmap(带 width/height/close)。
// - canvas:真 createElement('canvas'),但 jsdom 的 getContext 返回 null → spy 替换为假 ctx;
//   toBlob 也 stub(直接回调 jpeg blob,模拟浏览器编码完成)。
// - peek(fileResource):vi.mock 在顶部 hoisted,工厂返回读 holder 的 peek —— 每测试改 holder 控制命中/未命中。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailStrategies } from './thumbnail-strategies';

// vitest 会把 vi.mock 调用 hoist到所有 import 之前,所以 import 顺序与运行顺序无关。
// holder:控制 peek 返回。每测试可改 holder.returns。
const peekHolder = vi.hoisted(() => ({ returns: null }));
vi.mock('./fileResource', () => ({
  peek: () => peekHolder.returns,
}));

// 造假 ImageBitmap:createImageBitmap 桩返回它。drawImage 用它的 width/height。
function fakeBitmap(width, height) {
  return {
    width,
    height,
    close: vi.fn(),
  };
}

// 造假 canvas:jsdom 的 getContext 返回 null,这里替换为带 drawImage 的假 ctx;
// toBlob 也 stub(直接回调传入一个 jpeg blob,模拟浏览器编码完成)。
function fakeCanvas() {
  const canvas = document.createElement('canvas');
  const ctx = { drawImage: vi.fn() };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
  canvas.toBlob = vi.fn(cb => cb(new Blob([], { type: 'image/jpeg' })));
  return { canvas, ctx };
}

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  peekHolder.returns = null;
});

// M1 测试卫生:还原 stub 的 createImageBitmap,防漏到同文件/同 run 后续测试(createImageBitmap 是全局)。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image 策略 generateThumbnail(R3-1:createImageBitmap 解码)', () => {
  it('用 createImageBitmap 解码而非 new Image,且传 { imageOrientation: "from-image" }(EXIF 等价性)', async () => {
    const rawFile = { name: 'a.jpg', size: 100 };
    const handle = { getFile: vi.fn() };
    const fileData = { handle }; // SmartFile:peek 用 holder 命中

    peekHolder.returns = { file: rawFile }; // 模拟 ensureBlobUrl 已 acquire,peek 命中

    const { canvas, ctx } = fakeCanvas();
    const bitmap = fakeBitmap(800, 600);
    globalThis.createImageBitmap.mockResolvedValue(bitmap);

    const blob = await ThumbnailStrategies.image.generateThumbnail(canvas, fileData, 400);

    // 关键:createImageBitmap 被调,且第一个参数是 raw File(来自 peek,不二次 getFile)
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(rawFile, { imageOrientation: 'from-image' });
    // 没走 getFile(peek 命中)
    expect(handle.getFile).not.toHaveBeenCalled();
    // 用 bitmap 的 width/height 计算 ratio(而非 img)
    expect(ctx.drawImage).toHaveBeenCalledWith(
      bitmap,
      0,
      0,
      800,
      600, // 源用 bitmap 的尺寸
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    // 返回 jpeg blob(toBlob 被调)
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
    expect(canvas.toBlob).toHaveBeenCalled();
  });

  it('peek 未命中时 fallback 到 handle.getFile()(与 thumbnail.js md5 复用一致)', async () => {
    const rawFile = { name: 'b.jpg', size: 200 };
    const handle = { getFile: vi.fn(async () => rawFile) };
    const fileData = { handle };

    peekHolder.returns = null; // peek 未命中

    const { canvas } = fakeCanvas();
    globalThis.createImageBitmap.mockResolvedValue(fakeBitmap(1024, 768));

    await ThumbnailStrategies.image.generateThumbnail(canvas, fileData, 400);

    expect(handle.getFile).toHaveBeenCalledTimes(1); // peek 没命中,fallback getFile
    expect(createImageBitmap).toHaveBeenCalledWith(rawFile, { imageOrientation: 'from-image' });
  });

  it('bitmap 用完 close() 释放内存', async () => {
    const rawFile = { name: 'c.jpg', size: 300 };
    const handle = { getFile: vi.fn() };
    const fileData = { handle };

    peekHolder.returns = { file: rawFile };

    const { canvas } = fakeCanvas();
    const bitmap = fakeBitmap(500, 500);
    globalThis.createImageBitmap.mockResolvedValue(bitmap);

    await ThumbnailStrategies.image.generateThumbnail(canvas, fileData, 400);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
