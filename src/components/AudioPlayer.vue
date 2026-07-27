<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
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
    if (audioEl.value) audioEl.value.volume = volume.value;
  },
});

let visualTimer = null;
let dragging = false;

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function togglePlay() {
  if (audioEl.value.paused) audioEl.value.play();
  else audioEl.value.pause();
}

function onTimeUpdate() {
  if (!audioEl.value) return; // 卸载后 timeupdate 可能仍触发(切到非音频)
  currentTime.value = audioEl.value.currentTime;
}
function onLoadedMeta() {
  if (!audioEl.value) return;
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
  if (dragging) seekTo(e.clientX);
}
function onDragEnd() {
  dragging = false;
}

function toggleMute() {
  if (volume.value > 0) {
    prevVolume.value = volume.value;
    volume.value = 0;
  } else {
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
  if (visualTimer) clearInterval(visualTimer);
  visualTimer = null;
  bars.value = [20, 20, 20, 20, 20];
}

watch(isPlaying, (v) => (v ? startVisualizer() : stopVisualizer()));

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
        if (id3.title) title.value = id3.title;
        if (id3.artist) artist.value = id3.artist;
        if (id3.album) album.value = id3.album;
      }
    } catch (e) {
      console.error('提取 ID3 失败:', e);
    }
    try {
      const coverBlob = await extractAudioCover(props.file);
      if (coverBlob) coverUrl.value = URL.createObjectURL(coverBlob);
    } catch (e) {
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
  if (coverUrl.value) URL.revokeObjectURL(coverUrl.value); // 补源码遗漏
});
</script>

<template>
  <div class="modal-media modal-audio-player" @click.stop>
    <div class="audio-player-wrapper">
      <div class="audio-cover-container">
        <div class="audio-cover">
          <img v-if="coverUrl" class="cover-image" :src="coverUrl" style="display: block" alt="封面" />
          <div v-else class="cover-placeholder"><i class="fas fa-music"></i></div>
        </div>
        <div class="audio-visualizer">
          <div v-for="(h, i) in bars" :key="i" class="visualizer-bar" :style="{ height: h + '%' }"></div>
        </div>
      </div>

      <div class="audio-info">
        <h2 class="audio-title">{{ title }}</h2>
        <p class="audio-artist">{{ artist }}</p>
        <p class="audio-album">{{ album }}</p>
      </div>

      <div class="audio-controls">
        <div class="progress-container">
          <div class="progress-bar" ref="progressBarEl" @click="seekClick">
            <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
            <div class="progress-handle" :style="{ left: progressPct + '%' }" @mousedown="startDrag"></div>
          </div>
          <div class="time-display">
            <span class="current-time">{{ formatTime(currentTime) }}</span>
            <span class="total-time">{{ formatTime(duration) }}</span>
          </div>
        </div>

        <div class="control-buttons">
          <button class="control-btn prev-btn" @click="$emit('prev')" title="上一首">
            <i class="fas fa-step-backward"></i>
          </button>
          <button class="control-btn play-btn" @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
            <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
          </button>
          <button class="control-btn next-btn" @click="$emit('next')" title="下一首">
            <i class="fas fa-step-forward"></i>
          </button>
          <div class="volume-control">
            <button class="control-btn volume-btn" @click="toggleMute" title="静音">
              <i :class="volumeIcon"></i>
            </button>
            <input type="range" class="volume-slider" min="0" max="100" v-model="volumeModel" />
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
    ></audio>
  </div>
</template>
