<script setup>
import { nextTick, ref, watch } from 'vue';
import { useOverlay } from '../composables/useOverlay';
import { useConfirmStore } from '../stores/confirm';

const confirm = useConfirmStore();
const boxEl = ref(null);

// ESC 关闭 + 焦点陷阱/归还(T13)
useOverlay({
  isVisible: () => confirm.visible,
  overlayEl: boxEl,
  onClose: () => confirm.cancel(),
  trapFocus: true,
});

// 进场缩放(显示后 nextTick 加 .show)
watch(
  () => confirm.visible,
  async (v) => {
    if (v) {
      await nextTick();
      boxEl.value?.classList.add('show');
    }
    else if (boxEl.value) {
      boxEl.value.classList.remove('show');
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="confirm.visible" class="confirm-dialog-overlay" @click.self="confirm.cancel">
      <div ref="boxEl" class="confirm-dialog" role="dialog" aria-modal="true" tabindex="-1">
        <div class="confirm-dialog-header">
          <i class="fas fa-exclamation-triangle" />
          <h3 class="confirm-dialog-title">
            {{ confirm.title }}
          </h3>
        </div>
        <div class="confirm-dialog-body">
          <p v-if="confirm.step === 0" class="confirm-dialog-message" v-html="confirm.message" />
          <p v-else class="confirm-dialog-message">
            <strong style="color:#e74c3c;">🔴 最后确认</strong><br><br>
            真的要删除此文件夹吗?<br>
            <span style="color:#e67e22;">此操作无法撤销!</span>
          </p>
          <div class="confirm-dialog-progress">
            <div class="progress-step" :class="{ active: confirm.step === 0, completed: confirm.step === 1 }">
              <div class="step-circle">
                1
              </div>
              <div class="step-label">
                第一步确认
              </div>
            </div>
            <div class="progress-line" />
            <div class="progress-step" :class="{ active: confirm.step === 1 }">
              <div class="step-circle">
                2
              </div>
              <div class="step-label">
                最终确认
              </div>
            </div>
          </div>
        </div>
        <div class="confirm-dialog-footer">
          <button v-if="confirm.step === 0" class="confirm-btn confirm-btn-next" @click="confirm.next">
            下一步
          </button>
          <button v-if="confirm.step === 1" class="confirm-btn confirm-btn-confirm" @click="confirm.confirm">
            确认删除
          </button>
          <button class="confirm-btn confirm-btn-cancel" @click="confirm.cancel">
            取消
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 确认对话框(原 src/styles/confirm-dialog.css,T14b 纯搬家,视觉零变化) */
.confirm-dialog-overlay {
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
    z-index: var(--z-confirm);
    opacity: 1;
    transition: opacity 0.3s ease;
}

.confirm-dialog-overlay.hidden {
    display: none;
    opacity: 0;
}

.confirm-dialog {
    background: white;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: 90%;
    max-width: 500px;
    overflow: hidden;
    transform: scale(0.9);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.confirm-dialog.show {
    transform: scale(1);
    opacity: 1;
}

/* 对话框头部 */
.confirm-dialog-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    color: white;
}

.confirm-dialog-header i {
    font-size: 32px;
    animation: pulse 2s infinite;
}

@keyframes pulse {

    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.6;
    }
}

.confirm-dialog-title {
    font-size: 24px;
    font-weight: 600;
    margin: 0;
}

/* 对话框主体 */
.confirm-dialog-body {
    padding: 32px 24px;
}

.confirm-dialog-message {
    font-size: 16px;
    line-height: 1.8;
    color: #2c3e50;
    margin: 0 0 32px 0;
    text-align: center;
}

/* 进度指示器 */
.confirm-dialog-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 24px 0;
}

.progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    opacity: 0.4;
    transition: all 0.3s ease;
}

.progress-step.active {
    opacity: 1;
}

.progress-step.completed .step-circle {
    background: #27ae60;
    border-color: #27ae60;
}

.progress-step.completed .step-circle::after {
    content: '✓';
    color: white;
    font-weight: bold;
}

.step-circle {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 3px solid #bdc3c7;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: bold;
    color: #7f8c8d;
    background: white;
    transition: all 0.3s ease;
}

.progress-step.active .step-circle {
    border-color: #667eea;
    color: #667eea;
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.step-label {
    font-size: 12px;
    color: #7f8c8d;
    font-weight: 500;
}

.progress-step.active .step-label {
    color: #2c3e50;
    font-weight: 600;
}

.progress-line {
    width: 80px;
    height: 3px;
    background: #ecf0f1;
    margin: 0 16px;
    position: relative;
    top: -20px;
}

/* 对话框底部 */
.confirm-dialog-footer {
    padding: 20px 24px;
    background: #f8f9fa;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    border-top: 1px solid #e9ecef;
}

.confirm-btn {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s ease;
    outline: none;
}

.confirm-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.confirm-btn:active {
    transform: translateY(0);
}

.confirm-btn.hidden {
    display: none;
}

.confirm-btn-next {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.confirm-btn-next:hover {
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.confirm-btn-confirm {
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    color: white;
    animation: shake 0.5s infinite;
}

@keyframes shake {

    0%,
    100% {
        transform: translateX(0);
    }

    25% {
        transform: translateX(-2px);
    }

    75% {
        transform: translateX(2px);
    }
}

.confirm-btn-confirm:hover {
    box-shadow: 0 4px 12px rgba(231, 76, 60, 0.4);
    animation: none;
}

.confirm-btn-cancel {
    background: #95a5a6;
    color: white;
}

.confirm-btn-cancel:hover {
    background: #7f8c8d;
}

/* 暗色主题适配(theme=dark 触发) */
[data-theme="dark"] {
    .confirm-dialog {
        background: #2c3e50;
    }

    .confirm-dialog-message {
        color: #ecf0f1;
    }

    .confirm-dialog-footer {
        background: #34495e;
        border-top-color: #4a5f7f;
    }

    .step-circle {
        background: #34495e;
        border-color: #4a5f7f;
        color: #95a5a6;
    }

    .progress-step.active .step-circle {
        border-color: #667eea;
        color: #667eea;
    }

    .step-label {
        color: #95a5a6;
    }

    .progress-step.active .step-label {
        color: #ecf0f1;
    }

    .progress-line {
        background: #4a5f7f;
    }
}
</style>
