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
import { ensureBlobUrl } from '../models/SmartFile';
import { ThumbnailStrategies } from './thumbnail-strategies';

// vitest 会把 vi.mock 调用 hoist到所有 import 之前,所以 import 顺序与运行顺序无关。
// holder:控制 peek 返回。每测试可改 holder.returns。
const peekHolder = vi.hoisted(() => ({ returns: null }));
vi.mock('./fileResource', () => ({
  peek: () => peekHolder.returns,
}));

// gif 策略靠 ensureBlobUrl 取得动画 blobUrl;桩掉,每测试改返回值。
// getFile 用 importOriginal 保留真实实现(内部 peek→holder 控制命中,与旧 handle.getFile fallback 等价)。
const ensureBlobUrlHolder = vi.hoisted(() => ({ returns: null }));
vi.mock('../models/SmartFile', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ensureBlobUrl: vi.fn(() => ensureBlobUrlHolder.returns),
  };
});

// worker 池:桩 isPoolAvailable/renderInWorker/renderBitmapInWorker。
// renderInWorker 收 File(image 路径),renderBitmapInWorker 收 ImageBitmap(video 抓帧路径),都回 jpeg blob。
const poolMock = vi.hoisted(() => ({
  available: true,
  renderInWorker: vi.fn(async (_file, _targetSize) => new Blob([], { type: 'image/jpeg' })),
  renderBitmapInWorker: vi.fn(async (_bitmap, _targetSize) => new Blob([], { type: 'image/jpeg' })),
}));
vi.mock('./thumbnail-worker-pool', () => ({
  isPoolAvailable: () => poolMock.available,
  renderInWorker: poolMock.renderInWorker,
  renderBitmapInWorker: poolMock.renderBitmapInWorker,
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
  ensureBlobUrl.mockClear();
  ensureBlobUrlHolder.returns = null;
  poolMock.available = true;
  poolMock.renderInWorker.mockClear();
});

// M1 测试卫生:还原 stub 的 createImageBitmap,防漏到同文件/同 run 后续测试(createImageBitmap 是全局)。
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image 策略 generateThumbnail(整条管线丢进 worker 池,主线程零解码)', () => {
  it('file 传 renderInWorker(file, targetSize),不二次 getFile,onDrawn 后返 jpeg blob', async () => {
    const rawFile = { name: 'a.jpg', size: 100 };
    const handle = { getFile: vi.fn() };
    const fileData = { handle }; // SmartFile:peek 用 holder 命中

    peekHolder.returns = { file: rawFile }; // 模拟 ensureBlobUrl 已 acquire,peek 命中

    const { canvas } = fakeCanvas();
    // 主线程只剩 drawBlobToCanvas 的一次 createImageBitmap(blob) 重绘;解码在 worker(mock 掉)。
    globalThis.createImageBitmap.mockImplementation(async () => fakeBitmap(800, 600));

    const onDrawn = vi.fn();
    const blob = await ThumbnailStrategies.image.generateThumbnail(canvas, fileData, 400, onDrawn);

    // 关键:File(peek 命中,不二次 getFile)+ targetSize 透传给 worker 池
    expect(handle.getFile).not.toHaveBeenCalled();
    expect(poolMock.renderInWorker).toHaveBeenCalledTimes(1);
    expect(poolMock.renderInWorker).toHaveBeenCalledWith(rawFile, 400);
    // 主线程不再为解码调 createImageBitmap(只 drawBlobToCanvas 的小 blob 重绘 1 次)
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    // onDrawn 被调(画上可见 canvas 后)+ 返 jpeg blob
    expect(onDrawn).toHaveBeenCalled();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
  });

  it('peek 未命中时 fallback handle.getFile(),renderInWorker 收到 getFile 的 File', async () => {
    const rawFile = { name: 'b.jpg', size: 200 };
    const handle = { getFile: vi.fn(async () => rawFile) };
    const fileData = { handle };

    peekHolder.returns = null; // peek 未命中

    const { canvas } = fakeCanvas();
    globalThis.createImageBitmap.mockImplementation(async () => fakeBitmap(1024, 768));

    await ThumbnailStrategies.image.generateThumbnail(canvas, fileData, 400);

    expect(handle.getFile).toHaveBeenCalledTimes(1); // peek 没命中,fallback getFile
    expect(poolMock.renderInWorker).toHaveBeenCalledWith(rawFile, 400);
  });

  it('worker 池不可用时回退主线程 drawCoverToBlobMain(createImageBitmap + drawImage + toBlob)', async () => {
    poolMock.available = false;
    const rawFile = { name: 'c.jpg', size: 300 };
    peekHolder.returns = { file: rawFile };
    // drawCoverToBlobMain / drawBlobToCanvas 都要 canvas.getContext:jsdom 返回 null → 原型桩假 ctx + toBlob
    const fakeCtx = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob([], { type: 'image/jpeg' })));
    globalThis.createImageBitmap.mockImplementation(async () => fakeBitmap(500, 500));

    const { canvas } = fakeCanvas();
    const blob = await ThumbnailStrategies.image.generateThumbnail(canvas, { handle: { getFile: vi.fn() } }, 400);

    expect(poolMock.renderInWorker).not.toHaveBeenCalled(); // 池不可用,不走 worker
    // 主线程兜底:createImageBitmap(file) 解码 + drawBlobToCanvas 的 blob 重绘 = 2 次
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(createImageBitmap).toHaveBeenNthCalledWith(1, rawFile, { imageOrientation: 'from-image' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
  });
});

describe('svg 策略 generateThumbnail(切根 fromSnapshot 后 blobUrl=null 仍能渲染)', () => {
  // 回归:从别的根切到含 SVG 的根,文件经 fileFromSnapshot 秒重建,资源池空、blobUrl=null。
  // 旧实现 fetch(fileData.blobUrl)=fetch(null) 静默注入空/非 SVG 内容 → 空白缩略图(无报错)。
  // 修法对齐 image 策略:peek ?? handle.getFile() + file.text(),不依赖 blobUrl。
  it('blobUrl 为 null(池空)时走 handle.getFile().text() 兜底,正确注入 SVG 内容', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>';
    const handle = { getFile: vi.fn(async () => new File([svg], 'a.svg', { type: 'image/svg+xml' })) };
    const fileData = { blobUrl: null, handle };

    peekHolder.returns = null; // 池空(切根 fromSnapshot 后懒建状态)

    const el = document.createElement('div');
    await ThumbnailStrategies.svg.generateThumbnail(el, fileData);

    expect(handle.getFile).toHaveBeenCalledTimes(1); // 兜底取 File
    expect(el.innerHTML).toContain('<rect'); // SVG 内容真正注入
  });

  it('peek 命中(已 acquire)时复用池里 File,不二次 getFile', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle /></svg>';
    const rawFile = new File([svg], 'b.svg', { type: 'image/svg+xml' });
    const handle = { getFile: vi.fn() };
    const fileData = { blobUrl: 'blob:reused', handle };

    peekHolder.returns = { file: rawFile };

    const el = document.createElement('div');
    await ThumbnailStrategies.svg.generateThumbnail(el, fileData);

    expect(handle.getFile).not.toHaveBeenCalled(); // 复用池,不二次 IO
    expect(el.innerHTML).toContain('<circle');
  });
});

describe('gif 策略 generateThumbnail(切根 fromSnapshot 后 blobUrl=null → ensureBlobUrl 兜底)', () => {
  // 回归:GIF 靠 <img src=blobUrl> 显示动画,旧实现直接 element.src = fileData.blobUrl;
  // 切根秒重建后池空、blobUrl=null → src="null" → 缩略图空白(无报错,间歇自愈同 svg)。
  // 修法:ensureBlobUrl 取得真 url(池懒建 + 去重),设到 src。GIF 不能像 image 解码进 canvas(丢动画)。
  it('blobUrl 为 null(池空)时走 ensureBlobUrl 取得真 url,不再把 "null" 设进 src', async () => {
    ensureBlobUrlHolder.returns = 'blob:gif-1';
    const handle = { getFile: vi.fn() };
    const fileData = { blobUrl: null, handle }; // 切根后懒建状态

    const el = document.createElement('img');
    await ThumbnailStrategies.gif.generateThumbnail(el, fileData);

    expect(ensureBlobUrl).toHaveBeenCalledWith(fileData); // 兜底取 url
    expect(el.getAttribute('src')).toBe('blob:gif-1'); // 真 url 进 src
    expect(handle.getFile).not.toHaveBeenCalled(); // 策略不越权 getFile,交由 ensureBlobUrl
  });

  it('返回 null blob(不缓存,与 image 走 canvas/jpeg 区分)', async () => {
    ensureBlobUrlHolder.returns = 'blob:gif-2';
    const el = document.createElement('img');
    const blob = await ThumbnailStrategies.gif.generateThumbnail(el, { blobUrl: null, handle: {} });
    expect(blob).toBeNull(); // GIF 不进 IndexedDB 缓存
  });
});
