// exifTagsToEssentials 纯函数单测:从已解析 exif tags 提炼 capturedAt(拍摄时间)+ gps。
import { describe, expect, it } from 'vitest';
import { exifTagsToEssentials } from './exif';

describe('exifTagsToEssentials', () => {
  it('返回 capturedAt(DateTimeOriginal 优先)+ gps', () => {
    const tags = {
      DateTimeOriginal: new Date('2024-05-01T10:30:00'),
      GPSLatitude: 39.9042,
      GPSLongitude: 116.4074,
    };
    expect(exifTagsToEssentials(tags)).toEqual({
      capturedAt: new Date('2024-05-01T10:30:00').getTime(),
      gps: { lat: 39.9042, lng: 116.4074 },
    });
  });

  it('缺失 DateTimeOriginal 时回退 DateTimeDigitized / DateTime', () => {
    const t1 = exifTagsToEssentials({ DateTimeDigitized: new Date('2020-01-01') });
    expect(t1.capturedAt).toBe(new Date('2020-01-01').getTime());
    expect(t1.gps).toBeNull();
    const t2 = exifTagsToEssentials({ DateTime: new Date('2010-06-15T08:00:00') });
    expect(t2.capturedAt).toBe(new Date('2010-06-15T08:00:00').getTime());
  });

  it('gps 缺纬度/经度 → 无可用数据返回 null;有 alt 才带 alt', () => {
    const onlyLat = exifTagsToEssentials({ GPSLatitude: 39.9 });
    expect(onlyLat).toBeNull(); // 缺经度 + 无时间 → 整条无可用数据
    const withAlt = exifTagsToEssentials({ GPSLatitude: 39.9, GPSLongitude: 116.4, GPSAltitude: 50.5 });
    expect(withAlt.gps).toEqual({ lat: 39.9, lng: 116.4, alt: 50.5 });
    const noAlt = exifTagsToEssentials({ GPSLatitude: 39.9, GPSLongitude: 116.4 });
    expect(noAlt.gps).toEqual({ lat: 39.9, lng: 116.4 });
  });

  it('既无时间又无 gps → null', () => {
    expect(exifTagsToEssentials({ Make: 'Canon' })).toBeNull();
    expect(exifTagsToEssentials(null)).toBeNull();
    expect(exifTagsToEssentials(undefined)).toBeNull();
  });
});
