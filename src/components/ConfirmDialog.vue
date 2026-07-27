<script setup>
import { onMounted, onBeforeUnmount, watch, nextTick, ref } from 'vue';
import { useConfirmStore } from '../stores/confirm';

const confirm = useConfirmStore();
const boxEl = ref(null);

function onKeydown(e) {
  if (!confirm.visible) return;
  if (e.key === 'Escape') confirm.cancel();
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

// 进场缩放(显示后 nextTick 加 .show)
watch(
  () => confirm.visible,
  async (v) => {
    if (v) {
      await nextTick();
      boxEl.value?.classList.add('show');
    } else if (boxEl.value) {
      boxEl.value.classList.remove('show');
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="confirm.visible" class="confirm-dialog-overlay" @click.self="confirm.cancel">
      <div class="confirm-dialog" ref="boxEl">
        <div class="confirm-dialog-header">
          <i class="fas fa-exclamation-triangle"></i>
          <h3 class="confirm-dialog-title">{{ confirm.title }}</h3>
        </div>
        <div class="confirm-dialog-body">
          <p v-if="confirm.step === 0" class="confirm-dialog-message" v-html="confirm.message"></p>
          <p v-else class="confirm-dialog-message">
            <strong style="color:#e74c3c;">🔴 最后确认</strong><br /><br />
            真的要删除此文件夹吗?<br />
            <span style="color:#e67e22;">此操作无法撤销!</span>
          </p>
          <div class="confirm-dialog-progress">
            <div class="progress-step" :class="{ active: confirm.step === 0, completed: confirm.step === 1 }">
              <div class="step-circle">1</div>
              <div class="step-label">第一步确认</div>
            </div>
            <div class="progress-line"></div>
            <div class="progress-step" :class="{ active: confirm.step === 1 }">
              <div class="step-circle">2</div>
              <div class="step-label">最终确认</div>
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
          <button class="confirm-btn confirm-btn-cancel" @click="confirm.cancel">取消</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
