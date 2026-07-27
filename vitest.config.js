import vue from '@vitejs/plugin-vue';
// Vitest 配置。独立 config(不影响 vite build)。
// jsdom 环境(组件测试需 DOM);globals:true 免 import describe/it/expect。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.js'],
  },
});
