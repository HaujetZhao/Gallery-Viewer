<script setup>
// 阶段 0 骨架空壳:仅证明三件事——Vue 挂载成功、font-awesome 字体内化、设计变量生效。
// 阶段 1 起将替换为启动页/主界面真实结构。
</script>

<template>
  <div class="startup-placeholder">
    <i class="fas fa-images"></i>
    <h1>相册浏览器</h1>
    <p>骨架就绪 · 等待阶段 1 起接入功能</p>
  </div>
</template>

<style scoped>
.startup-placeholder {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg-secondary, #f5f7fa);
  color: var(--text-primary, #333);
}
.startup-placeholder i {
  font-size: 80px;
  color: var(--color-primary, #3498db);
}
.startup-placeholder h1 {
  font-size: 36px;
  margin: 0;
}
.startup-placeholder p {
  color: var(--text-secondary, #666);
}
</style>
