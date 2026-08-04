<script setup>
// PS 式数字调节框:紧凑单框,按住左右/上下拖动调数值(右/上增,左/下减),点击可键入。
// 用于设置面板的预览播放速度等"占位小、需微调"的数值。emit update:modelValue 传 Number。
import { ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  step: { type: Number, default: 0.1 },
  suffix: { type: String, default: '' }, // 值后缀,如 'x'
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

// 1px ≈ 0.01;全量程(0.5~4 ≈ 3.5)约 350px 拖满。拖动超过 DRAG_THRESHOLD 才进入 scrub(与点击键入区分)。
const SENSITIVITY = 0.01;
const DRAG_THRESHOLD = 3;

function format(v) {
  return `${v.toFixed(1)}${props.suffix}`;
}

const display = ref(format(props.modelValue));
const inputEl = ref(null);

let scrubbed = false;
let startX = 0;
let startY = 0;
let startVal = 0;

function clampStep(v) {
  const s = Math.round(v / props.step) * props.step;
  return Number(Math.min(props.max, Math.max(props.min, s)).toFixed(2));
}

function onPointerDown(e) {
  if (props.disabled)
    return;
  // ⚠️ 必须 preventDefault:否则按下会原生聚焦并选中数值文本,原生"拖选文本"抢走指针,
  // 导致按住拖动不响应、要松开后才动。preventDefault 阻断聚焦/选中;干净点击再手动聚焦键入。
  e.preventDefault();
  startX = e.clientX;
  startY = e.clientY;
  startVal = props.modelValue;
  scrubbed = false;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  // 位移超阈值才视为拖动;否则仍是潜在点击。
  if (!scrubbed && (Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD))
    scrubbed = true;
  if (!scrubbed)
    return;
  const delta = (e.clientX - startX) - (e.clientY - startY); // 右/上增,左/下减
  const v = clampStep(startVal + delta * SENSITIVITY);
  emit('update:modelValue', v);
  display.value = format(v);
}

function onPointerUp() {
  const didScrub = scrubbed;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  // 干净点击(未拖动)→ 进入编辑态:聚焦并全选数值供键入。
  if (!didScrub && !props.disabled) {
    const el = inputEl.value;
    el?.focus();
    el?.select();
  }
}

function onInput(e) {
  display.value = e.target.value; // 键入时实时跟手,避免 :value 绑定回跳
}
function onCommit(e) {
  const raw = parseFloat(e.target.value);
  const v = clampStep(Number.isFinite(raw) ? raw : props.modelValue);
  emit('update:modelValue', v);
  display.value = format(v);
  e.target.blur();
}

// 外部改动 modelValue(如重置/回读)时同步显示;拖动中不覆盖(避免跳动)。
watch(() => props.modelValue, (v) => {
  if (!scrubbed)
    display.value = format(v);
});
</script>

<template>
  <input
    ref="inputEl"
    class="scrub-input"
    :value="display"
    :disabled="disabled"
    :title="disabled ? '' : '点击可键入;按住左右/上下拖动微调'"
    @pointerdown="onPointerDown"
    @input="onInput"
    @change="onCommit"
  >
</template>

<style scoped>
.scrub-input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid var(--color-gray-300);
    border-radius: 6px;
    font-size: 12px;
    font-weight: bold;
    text-align: center;
    color: var(--text-primary);
    background-color: var(--bg-primary);
    /* 保持默认文本(竖线)光标,hover 不变样式;拖动调值靠 pointerdown/move,无需光标提示 */
    -webkit-user-select: none;
    user-select: none;
}

.scrub-input:focus {
    outline: 2px solid var(--color-primary-light);
}

.scrub-input:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
</style>
