# T18 · getImageInfoFromHeader 恢复 + 接入 metadata

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](2026-07-29-技术债治理-总规划.md)
> ⚠️ **基于 master(含 T17)**:开工前确认 `debt/T17` 已合并 master。

**Goal:** 恢复 T01 误删的 `getImageInfoFromHeader`(零解码读图片尺寸),接入 metadata 的 image strategy,替代 `new Image()` 重新解码读 dimensions——**省一次整图解码**。

**Why:** T01 把 `getImageInfoFromHeader` 当「零调用死代码」删了,但后续待办 round4 指出它本该被 metadata 复用:`new Image()` 读 dimensions 要**解码整图**(慢),而 `getImageInfoFromHeader` 读文件头魔数(**零解码**,只读前 30~40 字节)。属性面板读 metadata 时省一次解码。这是 T01 删早了的 P1 优化,现补回。

**Tech Stack:** Vue 3 + Vitest

---

## 一、恢复 `getImageInfoFromHeader`([utils/file.js](../../../src/utils/file.js))

- [x] **Step 1.1:加回函数**

在 [utils/file.js](../../../src/utils/file.js) 加(T01 删除的代码,从 `git show 2408aed^:src/utils/file.js` 可对照恢复):
```js
// 文件头魔数识别,返回 [width, height, type] 或 null(不支持格式)。位运算逐字符照搬源码,勿改。
// T18:接入 metadata image strategy 读 dimensions(零解码,替代 new Image 整图解码)。
export async function getImageInfoFromHeader(file) {
  if (file.size < 30)
    return null;
  let view = new DataView(await file.slice(0, 30).arrayBuffer());
  const sign = view.getUint32(0);

  if (sign === 0x89504E47)
    return [view.getUint32(16), view.getUint32(20), 'png'];
  if (sign === 0x47494638)
    return [view.getUint16(6, true), view.getUint16(8, true), 'gif'];
  if ((sign >>> 16) === 0x424D)
    return [Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)), 'bmp'];
  if ((sign >>> 8) === 0xFFD8FF) {
    const jpegData = await file.slice(0, 128 * 1024).arrayBuffer();
    view = new DataView(jpegData);
    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset);
      offset += 2;
      if (marker === 0xFFC0 || marker === 0xFFC2)
        return [view.getUint16(offset + 3), view.getUint16(offset + 1), 'jpg'];
      offset += view.getUint16(offset);
    }
  }
  else if (sign === 0x52494646) {
    view = new DataView(await file.slice(0, 40).arrayBuffer());
    const vp8 = view.getUint32(12);
    if (vp8 === 0x56503820)
      return [view.getUint16(26, true), view.getUint16(28, true), 'webp'];
    if (vp8 === 0x56503858) {
      return [
        (view.getUint32(24, true) & 0x00FFFFFF) + 1,
        ((view.getUint32(27, true) >> 8) & 0x00FFFFFF) + 1,
        'webp',
      ];
    }
    if (vp8 === 0x5650384C) {
      const b1 = view.getUint16(21, true);
      const b2 = view.getUint16(22, true);
      return [(b1 & 0x3FFF) + 1, ((b2 >> 6) & 0x3FFF) + 1, 'webp'];
    }
  }
  return null;
}
```
> 与 T01 前的版本逐字一致。可 `git show 2408aed^:src/utils/file.js` diff 对照。

---

## 二、接入 metadata image strategy([metadata.js](../../../src/services/metadata.js))

- [x] **Step 2.1:image.getMetadata 改为优先 header,fallback new Image**

[metadata.js](../../../src/services/metadata.js) import 加:
```js
import { getImageInfoFromHeader } from '../utils/file';
```
`image.getMetadata`(L23-43)改为(fileObj 复用给 header + exif):
```js
async getMetadata(file) {
  const metadata = {};
  await ensureBlobUrl(file);
  // fileObj 复用:peek 命中省一次 getFile,未命中回退 handle.getFile
  const fileObj = peek(file)?.file ?? await file.handle.getFile();
  // T18:dimensions 优先零解码魔数(getImageInfoFromHeader),不支持格式 fallback new Image 解码
  const header = await getImageInfoFromHeader(fileObj);
  if (header)
    metadata.dimensions = { width: header[0], height: header[1] };
  else
    metadata.dimensions = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = file.blobUrl;
    });
  try {
    metadata.exif = await extractExif(fileObj);
  }
  catch (e) {
    console.error('读取EXIF失败', e);
  }
  return metadata;
},
```
(svg strategy 保持 `new Image()`——svg 是文本无魔数,getImageInfoFromHeader 返回 null,接入无收益反而多一次无效调用。)

---

## 三、测试([file.test.js](../../../src/utils/file.test.js))

- [x] **Step 3.1:getImageInfoFromHeader 单元测试(造各格式魔数 buffer)**

[file.test.js](../../../src/utils/file.test.js)(T01 新建,现已有 calculateMD5 测试)追加:
```js
import { getImageInfoFromHeader } from './file';

// 造 PNG buffer:8字节签名 + IHDR(width@16, height@20, 大端)
function makePngBuffer(w, h) {
  const buf = new ArrayBuffer(24);
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
  it('PNG: 零解码读 width/height', async () => {
    expect(await getImageInfoFromHeader(makePngBuffer(800, 600))).toEqual([800, 600, 'png']);
  });
  it('小文件(<30 字节) → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(10)], 'tiny'))).toBeNull();
  });
  it('不支持格式 → null', async () => {
    expect(await getImageInfoFromHeader(new File([new Uint8Array(64).fill(0)], 'unknown'))).toBeNull();
  });
});
```
(JPEG/WebP 造 buffer 较繁,可选补;PNG + 两个边界用例已覆盖核心。)

- [x] **Step 3.2:跑测试**
```bash
npm test -- file.test.js
```
Expected: 新 3 用例 PASS。

---

## 四、整体验收

- [x] **Step V.1:全量测试 + Lint**
```bash
npm test && npm run lint
```
- [x] **Step V.2:双 build(分别清 dist)**
```bash
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
```

---

## 五、验收点

**客观断言:**
- `getImageInfoFromHeader` 在 utils/file.js 恢复;metadata image strategy 优先用它读 dimensions(不支持格式 fallback new Image)。
- file.test.js 新 3 用例 PASS;全量 PASS;四绿。

**主观体验(产品负责人,可选——性能优化,观感无变化):**
- 打开一张图的属性面板 → dimensions 正常显示(数值与 new Image 路径一致);理论上打开更快(少一次解码,大图更明显)。

---

## 六、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T18

### 改了什么
- [x] getImageInfoFromHeader 恢复到 utils/file.js(L14-48,与 T01 前 `2408aed^` 逐字一致,git 对照)
- [x] metadata image strategy 接入(L5 import + L24-49 image.getMetadata:fileObj 复用 → header 优先,fallback new Image)
- [x] file.test.js 新增 getImageInfoFromHeader 3 用例(L37-46)

### 涉及文件 + 行号
- [src/utils/file.js](src/utils/file.js) — L14-48 恢复 `getImageInfoFromHeader`(零解码魔数读 PNG/GIF/BMP/JPG/WebP 尺寸,位运算照搬源码)
- [src/services/metadata.js](src/services/metadata.js) — L5 import;L24-49 image.getMetadata 改造(fileObj 提前复用给 header+exif、header 优先、new Image 兜底)
- [src/utils/file.test.js](src/utils/file.test.js) — L2 import;L37-46 新增 describe(`makePngBuffer` + PNG / 小文件<30 / 不支持格式 3 用例)

### 测试
- getImageInfoFromHeader:3 PASS(PNG 读尺寸 + 小文件<30→null + 不支持格式→null)
- 全量 95 PASS(15 test files)

### 验收基线
- lint ✅(EXIT 0)  test ✅(95/95)  build ✅(dist/index.html 1.4MB 自包含)  build:pwa ✅(SW + manifest + 14 precache)

### 主观(可选)
- 属性面板 dimensions 正常 + 打开更快:待产品负责人上手验收(纯本地、无观感变化,仅省一次整图解码;大图更明显)

### 遗留 / 风险 / 偏离
- **偏离 1(测试 fixture 修正)**:文档 Step 3.1 的 `makePngBuffer` 原用 `ArrayBuffer(24)`,被函数 `file.size < 30` 守卫拦截 → PNG 用例返回 null 失败。已把 buffer 扩到 30(width@16/height@20 仍在范围内)。**未改函数**(守卫是源码原样 `2408aed^`);测试注释同步注明 size 须 ≥30。
- **偏离 2(测试标题)**:文档用例标题 `PNG: ...` 大写开头触发 `test/prefer-lowercase-title`;改中文开头「读 PNG width/height(零解码魔数)」(避开 `--fix` 把 PNG→pNG 的难看结果)。
- **语义点(照文档执行,未改函数)**:文档把 `fileObj = peek ?? getFile` 从原 try 块提到 try 外(header 也要用)。常态 peek 命中(ensureBlobUrl 刚 acquire),getFile 罕调;仅 getFile 抛错时 dimensions 也会随之失败冒泡(原版 dimensions 走 blobUrl 不受影响)——风险极低,照文档。
- **lint:fix 顺带格式化**:import 排序(`../utils/file` 上移至 L5)、if/else 补 curly 大括号——纯格式,逻辑不变。
- svg strategy 未接入(无魔数,接入无收益),按文档。
```

---

## 七、执行者注意

1. **getImageInfoFromHeader 代码逐字恢复**(T01 前),勿改魔数位运算。可 `git show 2408aed^:src/utils/file.js` 对照。
2. **svg 不接入**(无魔数,接入无收益)。
3. **fallback 保留**:不支持格式(罕见)仍走 new Image,保 dimensions 不丢。
4. **fileObj 复用**:peek ?? getFile 一次,给 header + exif(原 exif 也用 fileObj,合并)。
5. 双 build 分别 `rm -rf dist`。
