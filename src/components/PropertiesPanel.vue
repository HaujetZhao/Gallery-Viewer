<script setup>
import { computed } from 'vue';
import { usePropertiesStore } from '../stores/properties.js';
import { buildGpsLinks, FormatDMS } from '../services/gps.js';
import { formatDuration } from '../services/metadata.js';
import { formatFileSize, formatDate } from '../utils/format.js';

const props2 = usePropertiesStore();

const EXIF_MAP = {
  Make: '制造商', Model: '型号', LensModel: '镜头', Software: '后期软件',
  ExposureTime: '曝光时间', FNumber: '光圈', ISOSpeedRatings: 'ISO',
  FocalLength: '焦距', FocalLengthIn35mmFilm: '等效焦距', ExposureBias: '曝光补偿',
  MeteringMode: '测光模式', Flash: '闪光灯', WhiteBalance: '白平衡',
  DateTimeOriginal: '拍摄时间', PixelXDimension: '宽', PixelYDimension: '高',
  ResolutionUnit: '分辨率单位', Orientation: '方向', ColorSpace: '色彩空间',
  GPSLatitude: '纬度', GPSLongitude: '经度', GPSAltitude: '海拔',
};
const EXIF_GROUPS = {
  GPS位置信息: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
  设备信息: ['Make', 'Model', 'LensModel', 'Software'],
  拍摄参数: ['DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'FocalLength', 'FocalLengthIn35mmFilm', 'ExposureBias', 'MeteringMode', 'Flash', 'WhiteBalance'],
  图像参数: ['PixelXDimension', 'PixelYDimension', 'ColorSpace', 'Orientation'],
};
const IGNORE = ['MakerNote', 'UserComment', 'GPSLatitudeRef', 'GPSLongitudeRef', 'GPSVersionID', 'thumbnail', 'ExifIFDPointer', 'GPSInfoIFDPointer', 'InteroperabilityIFDPointer', 'undefined'];
const ID3_FIELDS = [
  { key: 'title', label: '标题', icon: 'fa-music' },
  { key: 'artist', label: '艺术家', icon: 'fa-user' },
  { key: 'album', label: '专辑', icon: 'fa-compact-disc' },
  { key: 'albumArtist', label: '专辑艺术家', icon: 'fa-users' },
  { key: 'year', label: '年份', icon: 'fa-calendar' },
  { key: 'genre', label: '流派', icon: 'fa-guitar' },
  { key: 'track', label: '音轨', icon: 'fa-list-ol' },
  { key: 'disc', label: '碟片', icon: 'fa-record-vinyl' },
  { key: 'composer', label: '作曲家', icon: 'fa-pen-fancy' },
  { key: 'comment', label: '注释', icon: 'fa-comment' },
];

const dim = computed(() => props2.metadata?.dimensions || {});
const exif = computed(() => props2.metadata?.exif);
const id3 = computed(() => props2.metadata?.id3);
const gps = computed(() => buildGpsLinks(exif.value));

function fmtExifVal(key, val, tags) {
  if (key === 'ExposureTime' && val < 1 && val > 0) return `1/${Math.round(1 / val)}`;
  if (key === 'FocalLength' || key === 'FocalLengthIn35mmFilm') return val + ' mm';
  if (key === 'GPSLatitude') return FormatDMS(val) + (tags.GPSLatitudeRef ? ' ' + tags.GPSLatitudeRef : '');
  if (key === 'GPSLongitude') return FormatDMS(val) + (tags.GPSLongitudeRef ? ' ' + tags.GPSLongitudeRef : '');
  if (key === 'GPSAltitude') return val + ' m';
  return val;
}

const exifGroups = computed(() => {
  const tags = exif.value;
  if (!tags) return [];
  const used = new Set();
  const result = [];
  for (const [groupName, keys] of Object.entries(EXIF_GROUPS)) {
    const items = [];
    for (const key of keys) {
      if (tags[key] !== undefined) {
        used.add(key);
        items.push({ k: EXIF_MAP[key] || key, v: fmtExifVal(key, tags[key], tags) });
      }
    }
    if (items.length) result.push({ name: groupName, items });
  }
  // 其他 EXIF
  const other = [];
  for (const key in tags) {
    if (used.has(key) || IGNORE.includes(key)) continue;
    const val = tags[key];
    if (typeof val === 'object' || typeof val === 'function') continue;
    other.push({ k: EXIF_MAP[key] || key, v: val });
  }
  if (other.length) result.push({ name: '其他', items: other });
  return result;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props2.visible" class="modal" @click.self="props2.close">
      <div class="modal-content properties-content">
        <div class="props-header">
          <h3>属性</h3>
          <button class="close-props-btn" @click="props2.close"><i class="fas fa-times"></i></button>
        </div>
        <div class="props-body">
          <div v-if="props2.loading" class="loader">正在分析文件信息...</div>
          <template v-else-if="props2.file">
            <!-- 基本信息 -->
            <div class="props-section">
              <h4>基本信息</h4>
              <table class="props-table">
                <tr><td>文件名</td><td>{{ props2.file.name }}</td></tr>
                <tr><td>路径</td><td class="file-path-display">{{ props2.file.path }}</td></tr>
                <tr v-if="dim.width"><td>分辨率</td><td>{{ dim.width }} × {{ dim.height }}</td></tr>
                <tr v-if="dim.duration"><td>时长</td><td>{{ formatDuration(dim.duration) }}</td></tr>
                <tr v-if="dim.estimatedBitrate"><td>估算比特率</td><td>{{ dim.estimatedBitrate }} kbps</td></tr>
                <tr><td>大小</td><td>{{ formatFileSize(props2.file.size) }}</td></tr>
                <tr><td>修改时间</td><td>{{ formatDate(props2.file.lastModified) }}</td></tr>
              </table>
            </div>

            <!-- ID3 音乐信息 -->
            <div v-if="id3" class="props-section">
              <h4><i class="fas fa-tags"></i> 音乐信息</h4>
              <table class="props-table">
                <template v-for="f in ID3_FIELDS" :key="f.key">
                  <tr v-if="id3[f.key]">
                    <td><i :class="['fas', f.icon]"></i> {{ f.label }}</td>
                    <td>{{ id3[f.key] }}</td>
                  </tr>
                </template>
              </table>
            </div>

            <!-- GPS 地理位置 -->
            <div v-if="gps" class="props-section">
              <h4><i class="fas fa-map-marked-alt"></i> 地理位置</h4>
              <div class="map-actions">
                <div class="map-buttons">
                  <a :href="gps.urls.google" target="_blank" class="map-btn google"><i class="fab fa-google"></i> 谷歌</a>
                  <a :href="gps.urls.gaode" target="_blank" class="map-btn gaode"><i class="fas fa-map-marked-alt"></i> 高德</a>
                  <a :href="gps.urls.baidu" target="_blank" class="map-btn baidu"><i class="fas fa-paw"></i> 百度</a>
                </div>
                <span class="gps-coords-text">{{ gps.text }}</span>
              </div>
            </div>

            <!-- EXIF 分组 -->
            <div v-if="exifGroups.length" class="props-section">
              <h4>EXIF 信息</h4>
              <div v-for="g in exifGroups" :key="g.name" class="exif-group">
                <h5 class="exif-group-title">{{ g.name }}</h5>
                <div class="exif-sub-grid">
                  <div v-for="item in g.items" :key="item.k" class="exif-item">
                    <span class="exif-label">{{ item.k }}</span>
                    <span class="exif-value">{{ item.v }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
