// 全局 toast 通知 store。show 加一条,setTimeout 到期自动移除。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { CONFIG } from '../config/index';

let _id = 0;

export const useToastStore = defineStore('uiToast', () => {
  const toasts = ref([]);

  function show(message, type = 'info', duration) {
    const id = ++_id;
    toasts.value.push({ id, message, type });
    setTimeout(remove, duration || CONFIG.UI.TOAST.DURATION, id);
  }
  function remove(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  return {
    toasts,
    show,
    remove,
    success: (m, d) => show(m, 'success', d),
    warning: (m, d) => show(m, 'warning', d),
    error: (m, d) => show(m, 'error', d),
    info: (m, d) => show(m, 'info', d),
  };
});
