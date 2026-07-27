import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 单 HTML 构建:所有 JS/CSS/字体(含 font-awesome woff2)base64 内联进单个 dist/index.html。
// 可 file:// 双击离线运行。base:'./' 用相对路径,适配本地文件与子路径部署。
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: './',
});
