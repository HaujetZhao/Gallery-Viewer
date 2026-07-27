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
