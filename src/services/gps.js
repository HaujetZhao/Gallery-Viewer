// GPS 坐标转换 WGS84↔GCJ-02↔BD-09 + 三家地图 URL。搬自源码 js/properties.js,魔数逐字照抄勿改。

export function FormatDMS(dms) {
  if (!dms)
    return '';
  return `${dms[0]}° ${dms[1]}' ${dms[2]}"`;
}

export function convertDMSToDD(dms, ref) {
  let dd = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (ref === 'S' || ref === 'W')
    dd = dd * -1;
  return dd;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function outOfChina(lon, lat) {
  return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

export function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat))
    return [lon, lat];
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - 0.00669342162296594323 * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((6378245.0 / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lon + dLon, lat + dLat];
}

export function gcj02ToBd09(lon, lat) {
  const x_pi = (3.14159265358979324 * 3000.0) / 180.0;
  const z = Math.sqrt(lon * lon + lat * lat) + 0.00002 * Math.sin(lat * x_pi);
  const theta = Math.atan2(lat, lon) + 0.000003 * Math.cos(lon * x_pi);
  const bdLon = z * Math.cos(theta) + 0.0065;
  const bdLat = z * Math.sin(theta) + 0.006;
  return [bdLon, bdLat];
}

// 从 EXIF GPS 字段生成三家地图 URL(经纬度顺序差异内化在此,模板不会写错)。
// Google=WGS84(纬,经);高德=GCJ-02(经,纬);百度=BD-09(纬,经)。
// 兼容 DMS 数组(exif-js)和十进制(exifr,带符号)两种 GPS 格式。
export function buildGpsLinks(exifTags) {
  if (!exifTags?.GPSLatitude || !exifTags?.GPSLongitude)
    return null;
  const rawLat = exifTags.GPSLatitude;
  const rawLon = exifTags.GPSLongitude;
  const latDec = Array.isArray(rawLat) ? convertDMSToDD(rawLat, exifTags.GPSLatitudeRef || 'N') : Number(rawLat);
  const lonDec = Array.isArray(rawLon) ? convertDMSToDD(rawLon, exifTags.GPSLongitudeRef || 'E') : Number(rawLon);
  if (Number.isNaN(latDec) || Number.isNaN(lonDec))
    return null;
  const [gcjLon, gcjLat] = wgs84ToGcj02(lonDec, latDec);
  const [bdLon, bdLat] = gcj02ToBd09(gcjLon, gcjLat);
  return {
    text: `WGS84: ${latDec.toFixed(6)}, ${lonDec.toFixed(6)}`,
    urls: {
      google: `https://www.google.com/maps?q=${latDec},${lonDec}`,
      gaode: `https://uri.amap.com/marker?position=${gcjLon},${gcjLat}&name=图片位置`,
      baidu: `http://api.map.baidu.com/marker?location=${bdLat},${bdLon}&output=html`,
    },
  };
}
