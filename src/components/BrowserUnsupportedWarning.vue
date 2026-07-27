<template>
  <div class="compat-warning">
    <strong>⚠️ 浏览器不兼容</strong>
    <p>您当前使用的浏览器不支持文件系统访问 API。</p>
    <p>请使用以下浏览器之一:</p>
    <ul>
      <li>Google Chrome</li>
      <li>Microsoft Edge</li>
      <li>Opera</li>
    </ul>
    <p class="note">Firefox 目前尚不支持此功能。</p>
  </div>
</template>

<style scoped>
.compat-warning {
  margin-top: 20px;
  padding: 15px 20px;
  background: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: 8px;
  color: #856404;
  max-width: 500px;
  text-align: left;
}
.compat-warning strong {
  display: block;
  margin-bottom: 8px;
}
.compat-warning p {
  margin: 5px 0;
  font-size: 14px;
}
.compat-warning ul {
  margin: 5px 0;
  padding-left: 20px;
  font-size: 14px;
}
.compat-warning .note {
  font-size: 13px;
  font-style: italic;
}
</style>
