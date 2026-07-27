import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';

// 全局样式:搬自源码 css/(60+ 设计变量 + 3 套主题)。
// main.css 聚合 9 个模块;context-menu/confirm-dialog 在源码是单独 link,这里补上。
import './styles/main.css';
import './styles/context-menu.css';
import './styles/confirm-dialog.css';

// font-awesome 内化:npm 包 ES import,Vite 自动接管字体(woff2)资源。
// 单 HTML build → base64 内联;PWA build → 独立哈希文件 + SW 预缓存。
import '@fortawesome/fontawesome-free/css/all.min.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
