// 两步确认 store。show(opts) → Promise<boolean>。第一步"下一步",第二步"确认"+shake。
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useConfirmStore = defineStore('confirm', () => {
  const visible = ref(false);
  const step = ref(0); // 0=第一步, 1=第二步
  const title = ref('');
  const message = ref('');
  const hasContent = ref(false);
  let resolveFn = null;

  function show(opts) {
    return new Promise((resolve) => {
      resolveFn = resolve;
      step.value = 0;
      title.value = opts.title || '确认删除';
      message.value = opts.message || '';
      hasContent.value = !!opts.hasContent;
      visible.value = true;
    });
  }
  function next() {
    step.value = 1;
  }
  function confirm() {
    visible.value = false;
    resolveFn?.(true);
    resolveFn = null;
  }
  function cancel() {
    visible.value = false;
    resolveFn?.(false);
    resolveFn = null;
  }
  return { visible, step, title, message, hasContent, show, next, confirm, cancel };
});
