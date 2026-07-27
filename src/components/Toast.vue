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
