<script setup>
import { computed, nextTick, ref } from 'vue';
import { buildGpsLinks, FormatDMS } from '../services/gps';
import { formatDuration } from '../services/metadata';
import { useNotesStore } from '../stores/notes';
import { usePropertiesStore } from '../stores/properties';
import { formatDate, formatFileSize } from '../utils/format';
import RenameInput from './RenameInput.vue';

const props2 = usePropertiesStore();
const notes = useNotesStore();

const EXIF_MAP = {
  Make: '制造商',
  Model: '型号',
  LensModel: '镜头',
  Software: '后期软件',
  ExposureTime: '曝光时间',
  FNumber: '光圈',
  ISO: 'ISO',
  FocalLength: '焦距',
  FocalLengthIn35mmFilm: '等效焦距',
  ExposureCompensation: '曝光补偿',
  MeteringMode: '测光模式',
  Flash: '闪光灯',
  WhiteBalance: '白平衡',
  DateTimeOriginal: '拍摄时间',
  PixelXDimension: '宽',
  PixelYDimension: '高',
  ResolutionUnit: '分辨率单位',
  Orientation: '方向',
  ColorSpace: '色彩空间',
  GPSLatitude: '纬度',
  GPSLongitude: '经度',
  GPSAltitude: '海拔',
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

// 内联重命名:逻辑封装在 RenameInput,父只管显隐(点击文件名触发)
const editing = ref(false);
function startRename() {
  editing.value = true;
}

// R14:md5 备注内联编辑(textarea,失焦 / Ctrl+Enter 提交,Esc 取消)。md5 缺失只读 + 提示。
const noteMd5 = computed(() => props2.file?.md5);
const noteText = computed(() => (noteMd5.value ? notes.getNote(noteMd5.value) : ''));
const noteEditing = ref(false);
const noteDraft = ref('');
const noteArea = ref(null);
function startNoteEdit() {
  if (!noteMd5.value)
    return; // md5 未就绪 → 只读
  noteDraft.value = noteText.value;
  noteEditing.value = true;
  nextTick(() => noteArea.value?.focus());
}
function submitNote() {
  if (!noteEditing.value)
    return;
  noteEditing.value = false;
  if (noteMd5.value)
    notes.setNote(noteMd5.value, noteDraft.value);
}
function cancelNote() {
  noteEditing.value = false;
}

function fmtExifVal(key, val, tags) {
  if (key === 'ExposureTime' && val < 1 && val > 0)
    return `1/${Math.round(1 / val)}`;
  if (key === 'FocalLength' || key === 'FocalLengthIn35mmFilm')
    return `${val} mm`;
  // GPS 兼容 DMS 数组(exif-js)和十进制(exifr)
  if (key === 'GPSLatitude') {
    const s = Array.isArray(val) ? FormatDMS(val) : typeof val === 'number' ? val.toFixed(6) : val;
    return s + (tags.GPSLatitudeRef ? ` ${tags.GPSLatitudeRef}` : '');
  }
  if (key === 'GPSLongitude') {
    const s = Array.isArray(val) ? FormatDMS(val) : typeof val === 'number' ? val.toFixed(6) : val;
    return s + (tags.GPSLongitudeRef ? ` ${tags.GPSLongitudeRef}` : '');
  }
  if (key === 'GPSAltitude')
    return `${val} m`;
  return val;
}

const exifGroups = computed(() => {
  const tags = exif.value;
  if (!tags)
    return [];
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
    if (items.length)
      result.push({ name: groupName, items });
  }
  // 其他 EXIF
  const other = [];
  for (const key in tags) {
    if (used.has(key) || IGNORE.includes(key))
      continue;
    const val = tags[key];
    if (typeof val === 'object' || typeof val === 'function')
      continue;
    other.push({ k: EXIF_MAP[key] || key, v: val });
  }
  if (other.length)
    result.push({ name: '其他', items: other });
  return result;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props2.visible" class="modal" @click.self="props2.close">
      <div class="modal-content properties-content">
        <div class="props-header">
          <h3>属性</h3>
          <button class="close-props-btn" @click="props2.close">
            <i class="fas fa-times" />
          </button>
        </div>
        <div class="props-body">
          <div v-if="props2.loading" class="loader">
            正在分析文件信息...
          </div>
          <template v-else-if="props2.file">
            <!-- 基本信息 -->
            <div class="props-section">
              <h4>基本信息</h4>
              <table class="props-table">
                <tbody>
                  <tr>
                    <td>文件名</td>
                    <td>
                      <span v-if="!editing" class="props-filename" title="点击重命名" @click="startRename">
                        {{ props2.file.name }} <i class="fas fa-edit props-rename-icon" />
                      </span>
                      <RenameInput v-else :file="props2.file" @done="editing = false" />
                    </td>
                  </tr>
                  <tr>
                    <td>路径</td><td class="file-path-display">
                      {{ props2.file.path }}
                    </td>
                  </tr>
                  <tr v-if="dim.width">
                    <td>分辨率</td><td>{{ dim.width }} × {{ dim.height }}</td>
                  </tr>
                  <tr v-if="dim.duration">
                    <td>时长</td><td>{{ formatDuration(dim.duration) }}</td>
                  </tr>
                  <tr v-if="dim.estimatedBitrate">
                    <td>估算比特率</td><td>{{ dim.estimatedBitrate }} kbps</td>
                  </tr>
                  <tr><td>大小</td><td>{{ formatFileSize(props2.file.size) }}</td></tr>
                  <tr><td>修改时间</td><td>{{ formatDate(props2.file.lastModified) }}</td></tr>
                  <!-- R14:md5 备注(内联编辑 textarea;md5 缺失只读 + 提示) -->
                  <tr class="props-note-row">
                    <td>备注</td>
                    <td>
                      <textarea
                        v-if="noteEditing"
                        ref="noteArea"
                        v-model="noteDraft"
                        class="props-note-input"
                        rows="3"
                        @blur="submitNote"
                        @keydown.ctrl.enter.prevent="submitNote"
                        @keydown.meta.enter.prevent="submitNote"
                        @keydown.esc.prevent="cancelNote"
                      />
                      <span
                        v-else-if="noteMd5"
                        class="props-note-text"
                        :class="{ 'is-empty': !noteText }"
                        :title="noteText ? '点击编辑备注' : '点击添加备注'"
                        @click="startNoteEdit"
                      >
                        <template v-if="noteText">{{ noteText }}</template>
                        <i v-else class="fas fa-plus" /> <span class="props-note-ph">{{ noteText ? '' : '添加备注' }}</span>
                      </span>
                      <span v-else class="props-note-hint">需先加载文件(md5 就绪后可编辑)</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- ID3 音乐信息 -->
            <div v-if="id3" class="props-section">
              <h4><i class="fas fa-tags" /> 音乐信息</h4>
              <table class="props-table">
                <tbody>
                  <template v-for="f in ID3_FIELDS" :key="f.key">
                    <tr v-if="id3[f.key]">
                      <td><i class="fas" :class="[f.icon]" /> {{ f.label }}</td>
                      <td>{{ id3[f.key] }}</td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <!-- GPS 地理位置 -->
            <div v-if="gps" class="props-section">
              <h4><i class="fas fa-map-marked-alt" /> 地理位置</h4>
              <div class="map-actions">
                <div class="map-buttons">
                  <a :href="gps.urls.google" target="_blank" class="map-btn google"><i class="fab fa-google" /> 谷歌</a>
                  <a :href="gps.urls.gaode" target="_blank" class="map-btn gaode"><i class="fas fa-map-marked-alt" /> 高德</a>
                  <a :href="gps.urls.baidu" target="_blank" class="map-btn baidu"><i class="fas fa-paw" /> 百度</a>
                </div>
                <span class="gps-coords-text">{{ gps.text }}</span>
              </div>
            </div>

            <!-- EXIF 分组 -->
            <div v-if="exifGroups.length" class="props-section">
              <h4>EXIF 信息</h4>
              <div v-for="g in exifGroups" :key="g.name" class="exif-group">
                <h5 class="exif-group-title">
                  {{ g.name }}
                </h5>
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
/* 属性面板(原 src/styles/properties.css,T14b 纯搬家,视觉零变化) */
/* 遮罩层(原依赖全局 .modal,实际无全局规则 → 缺失 fixed/遮罩会排在 gallery 后)。
   补 scoped .modal:满屏 fixed + 半透明遮罩 + flex 居中卡片(同 ConfirmDialog 套路)。 */
.modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
}

.properties-content {
    background: white;
    width: 90%;
    max-width: 600px;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.props-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 25px;
    border-bottom: 1px solid #eee;
    background: #fff;
    flex-shrink: 0;
    z-index: 10;
}

.props-body {
    width: 100%;
    padding: 25px;
    overflow-y: auto;
    flex: 1;
    scrollbar-width: none;
}

.props-body::-webkit-scrollbar {
    display: none;
}

.props-header h3 {
    margin: 0;
    color: #444;
    /* Softer text color */
    font-size: 16px;
    /* Slightly smaller */
    font-weight: 600;
}

.close-props-btn {
    background: none;
    border: none;
    font-size: 20px;
    color: #999;
    cursor: pointer;
    padding: 5px;
    transition: color 0.3s;
}

.close-props-btn:hover {
    color: #333;
}

.props-section {
    margin-bottom: 25px;
}

.props-section h4 {
    margin: 0 0 10px 0;
    font-size: 14px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-left: 3px solid #3498db;
    padding-left: 8px;
}

.props-table {
    width: 100%;
    border-collapse: collapse;
}

.props-table td {
    padding: 8px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 14px;
}

.props-table td:first-child {
    width: 100px;
    color: #888;
    font-weight: 500;
}

/* EXIF 分组样式 */
.exif-group {
    margin-bottom: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    padding: 12px;
}

.exif-group-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    color: #555;
    font-weight: 600;
    padding-bottom: 4px;
    border-bottom: 1px solid #e9ecef;
}

.exif-sub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
}

.exif-item {
    background: #fff;
    padding: 8px;
    border-radius: 6px;
    font-size: 12px;
    border: 1px solid #eee;
}

.exif-label {
    color: #888;
    margin-bottom: 4px;
    display: block;
}

.exif-value {
    color: #333;
    font-weight: 500;
    word-break: break-all;
}

.exif-placeholder {
    grid-column: 1 / -1;
    text-align: center;
    color: #999;
    padding: 20px;
}

/* 地图链接 */
.map-actions {
    margin-top: 5px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.map-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
}

.map-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.2s, transform 0.1s;
}

.map-btn:hover {
    opacity: 0.9;
}

.map-btn:active {
    transform: translateY(1px);
}

.map-btn.google {
    background-color: #4285F4;
}

.map-btn.gaode {
    background-color: #0091FF;
}

/* Amap Blue */
.map-btn.baidu {
    background-color: #E33E33;
}

/* Baidu Red-ish or Blue? Baidu Maps branding is usually blue/red pin. Let's use a distinct red to contrast. Or standard Baidu Blue #2932E1 */
.map-btn.baidu {
    background-color: #3f51b5;
}

.gps-coords-text {
    font-size: 12px;
    color: #888;
    background: #f5f5f5;
    padding: 4px 8px;
    border-radius: 4px;
    align-self: flex-start;
    font-family: monospace;
}

/* 深色模式适配(theme=dark 触发) */
[data-theme="dark"] {
    .properties-content {
        background: #2c3e50;
        color: #ecf0f1;
    }

    .props-header {
        background: #2c3e50;
        border-bottom-color: #34495e;
    }

    .props-header h3 {
        color: #fff;
    }

    .props-table td {
        border-bottom-color: #34495e;
    }

    .exif-group {
        background: #34495e;
    }

    .exif-group-title {
        color: #bdc3c7;
        border-bottom-color: #2c3e50;
    }

    .exif-item {
        background: #2c3e50;
        border-color: #465c71;
    }

    .exif-value {
        color: #fff;
    }

    .map-btn {
        opacity: 0.9;
    }

    .map-btn:hover {
        opacity: 1;
    }

    .gps-coords-text {
        background: #34495e;
        color: #bdc3c7;
    }
}

/* 内联重命名(T12 RenameInput) */
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

/* R14:备注内联编辑 */
.props-note-row td {
  vertical-align: top;
}
.props-note-input {
  width: 100%;
  min-height: 60px;
  padding: 6px 8px;
  border: 1px solid #3498db;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  color: #333;
  background: #fff;
}
.props-note-text {
  cursor: pointer;
  display: inline-block;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  padding: 2px 0;
}
.props-note-text.is-empty {
  color: #aaa;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.props-note-ph {
  font-size: 13px;
}
.props-note-hint {
  color: #aaa;
  font-size: 12px;
}
[data-theme="dark"] .props-note-input {
  background: #2c3e50;
  color: #ecf0f1;
  border-color: #3498db;
}
[data-theme="dark"] .props-note-text.is-empty {
  color: #7f8c8d;
}
</style>
