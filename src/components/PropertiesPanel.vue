<script setup>
import { computed, ref, nextTick } from 'vue';
import { usePropertiesStore } from '../stores/properties';
import { useHistoryStore } from '../stores/history';
import { useToastStore } from '../stores/uiToast';
import { buildGpsLinks, FormatDMS } from '../services/gps';
import { formatDuration } from '../services/metadata';
import { formatFileSize, formatDate } from '../utils/format';

const props2 = usePropertiesStore();
const history = useHistoryStore();
const toast = useToastStore();

const EXIF_MAP = {
  Make: '制造商', Model: '型号', LensModel: '镜头', Software: '后期软件',
  ExposureTime: '曝光时间', FNumber: '光圈', ISO: 'ISO',
  FocalLength: '焦距', FocalLengthIn35mmFilm: '等效焦距', ExposureCompensation: '曝光补偿',
  MeteringMode: '测光模式', Flash: '闪光灯', WhiteBalance: '白平衡',
  DateTimeOriginal: '拍摄时间', PixelXDimension: '宽', PixelYDimension: '高',
  ResolutionUnit: '分辨率单位', Orientation: '方向', ColorSpace: '色彩空间',
  GPSLatitude: '纬度', GPSLongitude: '经度', GPSAltitude: '海拔',
};
const EXIF_GROUPS = {
  GPS位置信息: ['GPSLatitude', 'GPSLongitude', 'GPSAltitude'],
  设备信息: ['Make', 'Model', 'LensModel', 'Software'],
  拍摄参数: ['DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFilm', 'ExposureCompensation', 'MeteringMode', 'Flash', 'WhiteBalance'],
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

// 内联重命名(点击文件名触发)
const editing = ref(false);
const draftName = ref('');
const nameInputEl = ref(null);
function startRename() {
  if (!props2.file) return;
  draftName.value = props2.file.name;
  editing.value = true;
  nextTick(() => {
    const dotIdx = props2.file.name.lastIndexOf('.');
    if (dotIdx > 0) nameInputEl.value?.setSelectionRange(0, dotIdx);
    else nameInputEl.value?.select();
    nameInputEl.value?.focus();
  });
}
let committing = false; // 防重入(@keyup.enter 提交后 input 卸载又触发 @blur)
async function commitRename() {
  if (committing) return;
  committing = true;
  try {
    const newName = draftName.value.trim();
    editing.value = false;
    if (!newName || newName === props2.file.name) return;
    if (/[<>:"/\\|?*]/.test(newName)) {
      toast.error('文件名包含非法字符');
      return;
    }
    await history.renameFile(props2.file, newName);
    toast.success('重命名成功(Ctrl+Z 撤销)');
  } catch (e) {
    toast.error('重命名失败: ' + e.message);
  } finally {
    committing = false;
  }
}
function cancelRename() {
  editing.value = false;
}

function fmtExifVal(key, val, tags) {
  if (key === 'ExposureTime' && val < 1 && val > 0) return `1/${Math.round(1 / val)}`;
  if (key === 'FocalLength' || key === 'FocalLengthIn35mmFilm') return val + ' mm';
  // GPS 兼容 DMS 数组(exif-js)和十进制(exifr)
  if (key === 'GPSLatitude') {
    const s = Array.isArray(val) ? FormatDMS(val) : typeof val === 'number' ? val.toFixed(6) : val;
    return s + (tags.GPSLatitudeRef ? ' ' + tags.GPSLatitudeRef : '');
  }
  if (key === 'GPSLongitude') {
    const s = Array.isArray(val) ? FormatDMS(val) : typeof val === 'number' ? val.toFixed(6) : val;
    return s + (tags.GPSLongitudeRef ? ' ' + tags.GPSLongitudeRef : '');
  }
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
                <tbody>
                <tr>
                  <td>文件名</td>
                  <td>
                    <span v-if="!editing" class="props-filename" @click="startRename" title="点击重命名">
                      {{ props2.file.name }} <i class="fas fa-edit props-rename-icon"></i>
                    </span>
                    <input
                      v-else
                      ref="nameInputEl"
                      v-model="draftName"
                      class="props-rename-input"
                      @keyup.enter="commitRename"
                      @keyup.esc="cancelRename"
                      @blur="commitRename"
                    />
                  </td>
                </tr>
                <tr><td>路径</td><td class="file-path-display">{{ props2.file.path }}</td></tr>
                <tr v-if="dim.width"><td>分辨率</td><td>{{ dim.width }} × {{ dim.height }}</td></tr>
                <tr v-if="dim.duration"><td>时长</td><td>{{ formatDuration(dim.duration) }}</td></tr>
                <tr v-if="dim.estimatedBitrate"><td>估算比特率</td><td>{{ dim.estimatedBitrate }} kbps</td></tr>
                <tr><td>大小</td><td>{{ formatFileSize(props2.file.size) }}</td></tr>
                <tr><td>修改时间</td><td>{{ formatDate(props2.file.lastModified) }}</td></tr>
                </tbody>
              </table>
            </div>

            <!-- ID3 音乐信息 -->
            <div v-if="id3" class="props-section">
              <h4><i class="fas fa-tags"></i> 音乐信息</h4>
              <table class="props-table">
                <tbody>
                <template v-for="f in ID3_FIELDS" :key="f.key">
                  <tr v-if="id3[f.key]">
                    <td><i :class="['fas', f.icon]"></i> {{ f.label }}</td>
                    <td>{{ id3[f.key] }}</td>
                  </tr>
                </template>
                </tbody>
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

<style scoped>
.props-filename {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.props-rename-icon {
  font-size: 0.8em;
  opacity: 0.35;
  transition: opacity 0.2s;
}
.props-filename:hover .props-rename-icon {
  opacity: 1;
}
.props-rename-input {
  width: 100%;
  font: inherit;
  padding: 2px 6px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
</style>
