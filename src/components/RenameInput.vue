<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { useHistoryStore } from '../stores/history';
import { useToastStore } from '../stores/uiToast';

// 内联重命名 input:封装选区/focus + 防重入 commit + 非法字符校验 + history.renameFile + toast。
// 去重 PhotoCard/PropertiesPanel 两份相同逻辑。父用 v-if 显示,@done 隐藏。
const props = defineProps({
  file: { type: Object, required: true },
});
const emit = defineEmits(['done']); // 重命名结束(提交/取消/失败)→ 父隐藏

const history = useHistoryStore();
const toast = useToastStore();
const draftName = ref(props.file.name);
const inputEl = ref(null);
let committing = false; // 防重入(提交后 input 卸载的边角)

// 挂载即选区(扩展名外)+ focus
onMounted(() => {
  nextTick(() => {
    const dotIdx = props.file.name.lastIndexOf('.');
    if (dotIdx > 0)
      inputEl.value?.setSelectionRange(0, dotIdx);
    else
      inputEl.value?.select();
    inputEl.value?.focus();
  });
});

async function commit() {
  if (committing)
    return;
  committing = true;
  const newName = draftName.value.trim();
  emit('done'); // 立即隐藏(匹配原 editing=false 在 try 开头;v-if 卸载不触发 blur)
  try {
    if (!newName || newName === props.file.name)
      return;
    if (/[<>:"/\\|?*]/.test(newName)) {
      toast.error('文件名包含非法字符');
      return;
    }
    await history.renameFile(props.file, newName);
    toast.success('重命名成功(Ctrl+Z 撤销)');
  }
  catch (e) {
    toast.error(`重命名失败: ${e.message}`);
  }
  finally {
    committing = false;
  }
}
function cancel() {
  emit('done');
}
</script>

<template>
  <input
    ref="inputEl"
    v-model="draftName"
    class="renaming-input"
    @keyup.enter="commit"
    @keyup.esc="cancel"
    @blur="commit"
    @click.stop
  >
</template>

<style scoped>
/* 内联重命名输入框(原 src/styles/sidebar.css L178-194,T14c 纯搬家,视觉零变化;
   T12 全局→T14c scoped:RenameInput 被 PhotoCard/PropertiesPanel 嵌入,scoped 随实例应用) */
.renaming-input {
    width: 100%;
    font-size: 14px;
    padding: 4px 6px;
    border: 1px solid var(--color-primary);
    border-radius: 4px;
    outline: none;
    box-shadow: 0 0 5px rgba(52, 152, 219, 0.5);
    background: var(--bg-primary);
    color: var(--text-primary);
    resize: none;
    overflow: hidden;
    min-height: 24px;
    line-height: 1.4;
    font-family: inherit;
}
</style>
