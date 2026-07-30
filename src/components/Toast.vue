<script setup>
import { useToastStore } from '../stores/uiToast';

const toast = useToastStore();

const icons = {
  success: 'fas fa-check-circle',
  warning: 'fas fa-exclamation-triangle',
  error: 'fas fa-times-circle',
  info: 'fas fa-info-circle',
};
</script>

<template>
  <Teleport to="body">
    <div id="toastContainer">
      <div
        v-for="t in toast.toasts"
        :key="t.id"
        class="toast"
        :class="`toast-${t.type}`"
        @click="toast.remove(t.id)"
      >
        <i class="toast-icon" :class="icons[t.type] || icons.info" />
        <span>{{ t.message }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Toast 提示 */
#toastContainer {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: var(--z-toast);
}

.toast {
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    gap: 10px;
    animation: toastFadeInOut 3s ease-in-out forwards;
    opacity: 0;
    transform: translateY(-10px);
    margin-bottom: 10px;
}

.toast-success {
    background-color: #27ae60;
    color: white;
    border-left: 4px solid #219653;
}

.toast-warning {
    background-color: #f39c12;
    color: white;
    border-left: 4px solid #e67e22;
}

.toast-error {
    background-color: #e74c3c;
    color: white;
    border-left: 4px solid #c0392b;
}

.toast-info {
    background-color: #3498db;
    color: white;
    border-left: 4px solid #2980b9;
}

.toast-icon {
    font-size: 16px;
}

/* ponytail: @keyframes 留在 scoped 内 —— Vue 不给 @keyframes 改名(保持全局名),
   .toast[data-v] 的 animation 引用仍命中,淡入淡出正常。断则改 :global。 */
@keyframes toastFadeInOut {
    0% {
        opacity: 0;
        transform: translateY(-10px);
    }

    10% {
        opacity: 1;
        transform: translateY(0);
    }

    90% {
        opacity: 1;
        transform: translateY(0);
    }

    100% {
        opacity: 0;
        transform: translateY(-10px);
    }
}
</style>
