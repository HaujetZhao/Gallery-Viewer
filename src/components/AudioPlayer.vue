<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { extractID3Tags } from '../services/id3-parser';
import { extractAudioCover } from '../services/thumbnail-strategies';

const props = defineProps({ file: { type: Object, required: true } });
const emit = defineEmits(['prev', 'next']);

const audioEl = ref(null);
const progressBarEl = ref(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(1);
const prevVolume = ref(1);
const coverUrl = ref('');
const title = ref('');
const artist = ref('未知艺术家');
const album = ref('未知专辑');
const bars = ref([20, 20, 20, 20, 20]);

const progressPct = computed(() => (duration.value ? (currentTime.value / duration.value) * 100 : 0));
const volumeIcon = computed(() =>
  volume.value === 0 ? 'fas fa-volume-mute' : volume.value < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up',
);
// 音量滑块 v-model(0-100 ↔ volume 0-1)。v-model 比 :value+@input 拖动更顺(不受控拉回)。
const volumeModel = computed({
  get: () => volume.value * 100,
  set: (v) => {
    volume.value = v / 100;
    if (audioEl.value)
      audioEl.value.volume = volume.value;
  },
});

let visualTimer = null;
let dragging = false;

function formatTime(s) {
  if (!s || isNaN(s))
    return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function togglePlay() {
  if (audioEl.value.paused)
    audioEl.value.play();
  else audioEl.value.pause();
}

function onTimeUpdate() {
  if (!audioEl.value)
    return; // 卸载后 timeupdate 可能仍触发(切到非音频)
  currentTime.value = audioEl.value.currentTime;
}
function onLoadedMeta() {
  if (!audioEl.value)
    return;
  duration.value = audioEl.value.duration;
}
function onEnded() {
  emit('next'); // 自动下一首
}

function seekTo(clientX) {
  const rect = progressBarEl.value.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audioEl.value.currentTime = pct * audioEl.value.duration;
}
function seekClick(e) {
  seekTo(e.clientX);
}
function startDrag(e) {
  dragging = true;
  e.stopPropagation();
}
function onDragMove(e) {
  if (dragging)
    seekTo(e.clientX);
}
function onDragEnd() {
  dragging = false;
}

function toggleMute() {
  if (volume.value > 0) {
    prevVolume.value = volume.value;
    volume.value = 0;
  }
  else {
    volume.value = prevVolume.value || 1;
  }
  audioEl.value.volume = volume.value;
}

function startVisualizer() {
  stopVisualizer();
  visualTimer = setInterval(() => {
    bars.value = bars.value.map(() => Math.random() * 100);
  }, 100);
}
function stopVisualizer() {
  if (visualTimer)
    clearInterval(visualTimer);
  visualTimer = null;
  bars.value = [20, 20, 20, 20, 20];
}

watch(isPlaying, v => (v ? startVisualizer() : stopVisualizer()));

// 加载 ID3 + 封面(mp3)
async function loadInfo() {
  title.value = props.file.name.replace(/\.[^/.]+$/, '');
  artist.value = '未知艺术家';
  album.value = '未知专辑';
  if (coverUrl.value) {
    URL.revokeObjectURL(coverUrl.value);
    coverUrl.value = '';
  }
  if (props.file.type === 'mp3') {
    try {
      const id3 = await extractID3Tags(props.file);
      if (id3) {
        if (id3.title)
          title.value = id3.title;
        if (id3.artist)
          artist.value = id3.artist;
        if (id3.album)
          album.value = id3.album;
      }
    }
    catch (e) {
      console.error('提取 ID3 失败:', e);
    }
    try {
      const coverBlob = await extractAudioCover(props.file);
      if (coverBlob)
        coverUrl.value = URL.createObjectURL(coverBlob);
    }
    catch (e) {
      console.error('提取封面失败:', e);
    }
  }
}

// 翻页重载(同音频文件间切换)
watch(
  () => props.file,
  () => {
    currentTime.value = 0;
    loadInfo();
  },
);

onMounted(() => {
  audioEl.value.volume = volume.value;
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  loadInfo();
  audioEl.value.play().catch(() => {}); // autoplay(浏览器策略可能拦,静默)
});

onBeforeUnmount(() => {
  stopVisualizer();
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (audioEl.value) {
    audioEl.value.pause();
    audioEl.value.src = '';
  }
  if (coverUrl.value)
    URL.revokeObjectURL(coverUrl.value); // 补源码遗漏
});
</script>

<template>
  <div class="modal-media modal-audio-player" @click.stop>
    <div class="audio-player-wrapper">
      <div class="audio-cover-container">
        <div class="audio-cover">
          <img v-if="coverUrl" class="cover-image" :src="coverUrl" style="display: block" alt="封面">
          <div v-else class="cover-placeholder">
            <i class="fas fa-music" />
          </div>
        </div>
        <div class="audio-visualizer">
          <div v-for="(h, i) in bars" :key="i" class="visualizer-bar" :style="{ height: `${h}%` }" />
        </div>
      </div>

      <div class="audio-info">
        <h2 class="audio-title">
          {{ title }}
        </h2>
        <p class="audio-artist">
          {{ artist }}
        </p>
        <p class="audio-album">
          {{ album }}
        </p>
      </div>

      <div class="audio-controls">
        <div class="progress-container">
          <div ref="progressBarEl" class="progress-bar" @click="seekClick">
            <div class="progress-fill" :style="{ width: `${progressPct}%` }" />
            <div class="progress-handle" :style="{ left: `${progressPct}%` }" @mousedown="startDrag" />
          </div>
          <div class="time-display">
            <span class="current-time">{{ formatTime(currentTime) }}</span>
            <span class="total-time">{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="control-buttons">
          <button class="control-btn prev-btn" title="上一首" @click="$emit('prev')">
            <i class="fas fa-step-backward" />
          </button>
          <button class="control-btn play-btn" :title="isPlaying ? '暂停' : '播放'" @click="togglePlay">
            <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'" />
          </button>
          <button class="control-btn next-btn" title="下一首" @click="$emit('next')">
            <i class="fas fa-step-forward" />
          </button>
          <div class="volume-control">
            <button class="control-btn volume-btn" title="静音" @click="toggleMute">
              <i :class="volumeIcon" />
            </button>
            <input v-model="volumeModel" type="range" class="volume-slider" min="0" max="100">
          </div>
        </div>
      </div>
    </div>
    <audio
      ref="audioEl"
      :src="file.blobUrl"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMeta"
      @play="isPlaying = true"
      @pause="isPlaying = false"
      @ended="onEnded"
    />
  </div>
</template>

<style scoped>
/* 音频播放器(原 src/styles/modal.css L100-403,T14c 纯搬家,视觉零变化) */
/* .modal-media 跨组件:根 div 与 MediaModal 的 img/video/svg 共用,两边 scoped 各一份 */
.modal-media {
    position: absolute;
    user-select: none;
    transform-origin: center center;
    will-change: scale, translate;
}

/* ========== 音频播放器样式 ========== */
.modal-audio-player {
    width: 90%;
    max-width: 500px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 30px;
    padding: 40px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    pointer-events: auto;
    /* 阻止点击事件穿透 */
    position: relative;
    z-index: 10;
}

.audio-player-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 25px;
}

/* 封面容器 */
.audio-cover-container {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
}

.audio-cover {
    width: 280px;
    height: 280px;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    background: rgba(255, 255, 255, 0.1);
    position: relative;
}

.cover-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: none;
}

.cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05));
    backdrop-filter: blur(10px);
}

.cover-placeholder i {
    font-size: 80px;
    color: rgba(255, 255, 255, 0.8);
}

/* 可视化效果 */
.audio-visualizer {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 8px;
    height: 60px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 15px;
    backdrop-filter: blur(10px);
}

.visualizer-bar {
    width: 6px;
    height: 20%;
    background: linear-gradient(to top, #fff, rgba(255, 255, 255, 0.6));
    border-radius: 3px;
    transition: height 0.1s ease;
}

/* 歌曲信息 */
.audio-info {
    text-align: center;
    color: white;
    width: 100%;
}

.audio-title {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.audio-artist {
    font-size: 16px;
    opacity: 0.9;
    margin-bottom: 4px;
}

.audio-album {
    font-size: 14px;
    opacity: 0.7;
}

/* 控制区域 */
.audio-controls {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
}

/* 进度条容器 */
.progress-container {
    width: 100%;
}

.progress-bar {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    position: relative;
    cursor: pointer;
    margin-bottom: 10px;
}

.progress-fill {
    height: 100%;
    background: white;
    border-radius: 3px;
    width: 0%;
    transition: width 0.1s linear;
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
}

.progress-handle {
    position: absolute;
    top: 50%;
    left: 0%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    cursor: grab;
    transition: transform 0.2s ease;
}

.progress-handle:hover {
    transform: translate(-50%, -50%) scale(1.2);
}

.progress-handle:active {
    cursor: grabbing;
}

/* 时间显示 */
.time-display {
    display: flex;
    justify-content: space-between;
    color: rgba(255, 255, 255, 0.8);
    font-size: 12px;
    font-weight: 500;
}

/* 控制按钮 */
.control-buttons {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
}

.control-btn {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    color: white;
    font-size: 18px;
    cursor: pointer;
    transition: all 0.3s ease;
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
}

.control-btn:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
}

.control-btn:active {
    transform: scale(0.95);
}

.play-btn {
    width: 70px;
    height: 70px;
    font-size: 24px;
    background: white;
    color: #667eea;
    box-shadow: 0 5px 20px rgba(255, 255, 255, 0.3);
}

.play-btn:hover {
    background: rgba(255, 255, 255, 0.95);
    transform: scale(1.15);
}

/* 音量控制 */
.volume-control {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 10px;
}

.volume-slider {
    width: 80px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
}

.volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    transition: transform 0.2s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
}

.volume-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

/* 隐藏原生音频元素 */
.audio-element {
    display: none;
}

/* 响应式设计 */
@media (max-width: 600px) {
    .modal-audio-player {
        width: 95%;
        padding: 30px 20px;
    }

    .audio-cover {
        width: 220px;
        height: 220px;
    }

    .audio-title {
        font-size: 20px;
    }

    .control-btn {
        width: 45px;
        height: 45px;
        font-size: 16px;
    }

    .play-btn {
        width: 60px;
        height: 60px;
        font-size: 20px;
    }

    .volume-slider {
        width: 60px;
    }
}
</style>
