# EXIF 拍摄时间 + GPS 落盘（图片优先用拍摄时间）

## 背景

- 图片卡片/属性面板的时间目前一律用文件修改时间（`SmartFile.lastModified`）。但很多照片希望按**拍摄时间**（EXIF `DateTimeOriginal`）展示/排序。
- 后续可能做**图片地图**，需要 GPS 落盘。若现在不存，等地图上线时存量图片得全量回扫一遍 EXIF。
- EXIF 是**内容派生值**（与 md5 同源），天然该走 **md5 索引的 file-meta store**（跨副本/跨文件夹共享、懒加载），而不是随快照持久化。

## 范围（与负责人确认）

**落盘**（file-meta store，md5 索引）：
- `capturedAt`：拍摄时间（ms，优先级 `DateTimeOriginal` → `DateTimeDigitized` → `DateTime`）
- `gps`：`{ lat, lng, alt? }`（十进制、带符号）
- `exifChecked`：哨兵，标记"已查过 EXIF"（含"无 EXIF"），防反复抽

**不落盘**（保持属性面板即时重抽）：相机型号、曝光/ISO/光圈/焦距、镜头等——只服务单张展示，存进每个 record 属浪费。

**排序**：保持 `lastModified`（不切 EXIF 排序，避免视窗懒加载导致的排序跳动 + 全量 EXIF 成本）。

## 改动

### 1. [exif.js](../../src/services/exif.js) 提炼核心字段
- `exifTagsToEssentials(tags)`：纯函数，从已解析 tags 提炼 `{ capturedAt, gps }` 或 `null`。**单点口径**，视窗懒抽与属性面板共用。
- `extractExifEssentials(fileObj)`：轻量抽取——只 `pick` 时间 + GPS 字段，不做 tiff/exif 全量解析（视窗懒抽时每张图都会走一次，省成本）。
- 含单测 `exif.test.js`。

### 2. [thumbnail.js](../../src/services/thumbnail.js) `loadCardMetadata` 懒抽落盘
```
图片(getThumbnailStrategy(name)=='image') && _meta.exifChecked !== true
  → extractExifEssentials(peek(file).file)
  → saveFileMeta(file, { capturedAt?, gps?, exifChecked: true })   // 无 EXIF 也打哨兵
```
- 与 md5/audio duration 同属"读内容重活"，汇聚在 `loadCardMetadata`（卡片进视窗 100px）。
- `exifChecked` 哨兵 → 已查过（含无 EXIF）不再重抽。
- **存量自动回填**：存量文件 md5 已在快照、但从未抽过 → 首次进视窗补抽一次（绕开"md5 缓存 → 已抽过"的错误假设）。
- 幂等：`saveFileMeta` 内部 `if (!file.md5) return`，此处 md5 已算；只在缺字段时写。

### 3. [SmartFile.js](../../src/models/SmartFile.js) getter
- `capturedAt`（读 `_meta.capturedAt`）、`gps`（读 `_meta.gps`）、`displayDate`（`capturedAt ?? lastModified`）。纯 getter，Vue 响应式追踪。

### 4. 展示
- [PhotoCard.vue](../../src/components/PhotoCard.vue)：日期用 `file.displayDate`。
- [PropertiesPanel.vue](../../src/components/PropertiesPanel.vue)：有 `capturedAt` 时加"拍摄时间"行（保留"修改时间"行）。

### 5. [properties store](../../src/stores/properties.js) 打开即回填
- 打开属性面板已拿全量 exif → `exifTagsToEssentials(metadata.exif)` → 与 `_meta` 比较，**变了才** `saveFileMeta({ capturedAt?, gps?, exifChecked: true })`。
- 兜住"存量从未进视窗"的缺口（用户一打开属性就回填）；幂等防写放大。

## 时机（回答"何时读取/落盘"）

| 时机 | 动作 |
|---|---|
| 卡片进视窗（`loadCardMetadata`） | 懒抽 + `saveFileMeta` 落盘 + 哨兵 |
| 打开属性面板 | 重抽全量 EXIF，可持久化字段**变了才更新** |
| enrich / scan | 不读 EXIF（保持轻量，只补 size/mtime） |

## 验证

- `npm run test`（新增 `exif.test.js` 纯函数单测 + 全量回归 149 过）/ `lint`。
- 浏览器：有 EXIF 的图卡片显示拍摄时间；属性面板多"拍摄时间"行；`file-meta` 写入 capturedAt/gps + exifChecked；无 EXIF 的图不反复抽。

## 后续待办

- **图片地图**：直接读 `file.gps`（`_meta.gps`），无需重读 EXIF。
- 若将来要"按拍摄时间排序"：需在 scan/enrich 阶段对全量图片做一次 EXIF 读取（成本），本次不做。
