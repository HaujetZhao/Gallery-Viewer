import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';

// 全局样式:搬自源码 css/(60+ 设计变量 + 3 套主题)。
// main.css 聚合全局模块;context-menu/confirm-dialog/properties 已 T14b 搬进对应组件 scoped。
import './styles/main.css';

// font-awesome 内化:npm 包 ES import,Vite 自动接管字体(woff2)资源。
// 单 HTML build → base64 内联;PWA build → 独立哈希文件 + SW 预缓存。
import '@fortawesome/fontawesome-free/css/all.min.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
