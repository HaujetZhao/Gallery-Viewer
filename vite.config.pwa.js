import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA 构建:独立外链 SW + manifest(无法内联进单 HTML,故与 vite.config.js 分开)。
// 两套 config 而非参数化,避免 if/else 污染主配置。
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '相册浏览器',
        short_name: '相册',
        description: '纯本地处理的相册浏览器:文件树、瀑布流、EXIF、文件整理。',
        theme_color: '#2d3e50',
        background_color: '#2d3e50',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // 预缓存清单:补 woff2(源模板漏了字体,严格离线需要)
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm,woff2}'],
      },
    }),
  ],
  base: './',
});
