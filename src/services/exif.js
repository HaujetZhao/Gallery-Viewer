// EXIF 读取(exifr,现代 Promise API)。换掉 exif-js(其 getStringFromDB 漏 var,严格模式报 n is not defined)。
import exifr from 'exifr';

export async function extractExif(fileObj) {
  if (!fileObj)
    return null;
  try {
    // 解析 tiff/exif/gps 块,返回标准字段名(Make/Model/ExposureTime/GPSLatitude 等)。
    // GPS 返回十进制(带符号,南/西负)。
    const tags = await exifr.parse(fileObj, { tiff: true, exif: true, gps: true });
    return tags || null;
  }
  catch (e) {
    console.warn('EXIF 解析失败:', e);
    return null;
  }
}

// 从已解析的 exif tags 提炼「可持久化核心字段」capturedAt(拍摄时间,ms)+ gps{lat,lng,alt}。
// 供视窗懒抽(extractExifEssentials)与属性面板打开时(复用已解析的全量 tags)共用,单点口径。
// 无相关字段/解析失败 → 返回 null(调用方据此打 exifChecked 哨兵,不再重抽)。
export function exifTagsToEssentials(tags) {
  if (!tags)
    return null;
  const d = tags.DateTimeOriginal || tags.DateTimeDigitized || tags.DateTime;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  const capturedAt = Number.isFinite(t) ? t : null;
  let gps = null;
  const lat = Number(tags.GPSLatitude);
  const lng = Number(tags.GPSLongitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    gps = { lat, lng };
    const alt = Number(tags.GPSAltitude);
    if (Number.isFinite(alt))
      gps.alt = alt;
  }
  if (capturedAt == null && gps == null)
    return null;
  return { capturedAt, gps };
}

// 轻量抽取可持久化核心字段(capturedAt + GPS):只 pick 需要的 tag,不解析 tiff/exif 全量
// (避免给每张图做完整 EXIF/GPS 解析的重活——视窗懒抽时每张图片都会走一次)。
export async function extractExifEssentials(fileObj) {
  if (!fileObj)
    return null;
  try {
    const tags = await exifr.parse(fileObj, {
      pick: ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime', 'GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
    });
    return exifTagsToEssentials(tags);
  }
  catch (e) {
    console.warn('EXIF 核心字段解析失败:', e);
    return null;
  }
}
