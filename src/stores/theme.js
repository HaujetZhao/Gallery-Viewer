// 主题数据 + 主题 store。搬自源码 js/themes.js。
// applyTheme 保留 :root.style.setProperty 注入 CSS 变量的机制(与 Vue 不冲突,最稳)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useUserSettingsStore } from './userSettings.js';

// 三套主题的 variables 键不一致(dark 独有语义色 + text-inverse、forest 无 gray 系列)是源码现状,照搬不对齐。
export const THEMES = {
  ocean: {
    id: 'ocean',
    name: '海洋蓝',
    description: '清新的蓝色主题',
    icon: '🌊',
    variables: {
      '--color-primary': '#3498db',
      '--color-primary-dark': '#2980b9',
      '--color-primary-light': '#5dade2',
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f5f7fa',
      '--bg-tertiary': '#ecf0f1',
      '--text-primary': '#333333',
      '--text-secondary': '#666666',
      '--text-muted': '#999999',
      '--sidebar-bg': '#2c3e50',
      '--sidebar-text': '#ecf0f1',
      '--color-gray-50': '#f8f9fa',
      '--color-gray-100': '#e9ecef',
      '--color-gray-200': '#dee2e6',
      '--color-gray-300': '#ced4da',
      '--color-gray-400': '#adb5bd',
      '--color-gray-500': '#6c757d',
      '--color-gray-600': '#495057',
      '--color-gray-700': '#343a40',
      '--color-gray-800': '#212529',
      '--color-gray-900': '#1a1d20',
      '--accent-color': '#3498db',
      '--bg-color': '#f5f7fa',
    },
  },
  dark: {
    id: 'dark',
    name: '暗色模式',
    description: '舒适的深色主题，护眼模式',
    icon: '🌙',
    variables: {
      '--color-primary': '#4a9eff',
      '--color-primary-dark': '#3a8eef',
      '--color-primary-light': '#6ab4ff',
      '--color-success': '#2ecc71',
      '--color-warning': '#f39c12',
      '--color-danger': '#e74c3c',
      '--bg-primary': '#1a1d23',
      '--bg-secondary': '#22252b',
      '--bg-tertiary': '#2a2d35',
      '--text-primary': '#e4e6eb',
      '--text-secondary': '#b0b3b8',
      '--text-muted': '#8a8d91',
      '--text-inverse': '#1a1d23',
      '--color-gray-50': '#2a2d35',
      '--color-gray-100': '#32353d',
      '--color-gray-200': '#3a3d45',
      '--color-gray-300': '#4a4d55',
      '--color-gray-400': '#5a5d65',
      '--color-gray-500': '#8a8d91',
      '--color-gray-600': '#b0b3b8',
      '--color-gray-700': '#c8cacd',
      '--color-gray-800': '#e4e6eb',
      '--color-gray-900': '#f8f9fa',
      '--sidebar-bg': '#16181d',
      '--sidebar-text': '#e4e6eb',
      '--accent-color': '#4a9eff',
      '--bg-color': '#1a1d23',
    },
  },
  forest: {
    id: 'forest',
    name: '森林绿',
    description: '清新的绿色主题',
    icon: '🌲',
    variables: {
      '--color-primary': '#27ae60',
      '--color-primary-dark': '#229954',
      '--color-primary-light': '#2ecc71',
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f0f7f4',
      '--bg-tertiary': '#e8f5e9',
      '--text-primary': '#2d3436',
      '--text-secondary': '#636e72',
      '--text-muted': '#95a5a6',
      '--sidebar-bg': '#1e5128',
      '--sidebar-text': '#f0f7f4',
      '--accent-color': '#27ae60',
      '--bg-color': '#f0f7f4',
    },
  },
};

export const useThemeStore = defineStore('theme', () => {
  const currentTheme = ref('ocean');

  function applyTheme(themeId) {
    const theme = THEMES[themeId];
    if (!theme) {
      console.error(`主题不存在: ${themeId}`);
      return;
    }
    const root = document.documentElement;
    Object.entries(theme.variables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    currentTheme.value = themeId;
    useUserSettingsStore().set('theme', themeId);
    document.body.setAttribute('data-theme', themeId);
  }

  function getThemes() {
    return Object.values(THEMES);
  }

  function getCurrentTheme() {
    return THEMES[currentTheme.value];
  }

  function init() {
    const saved = useUserSettingsStore().get('theme') || 'ocean';
    applyTheme(saved);
  }

  return { currentTheme, applyTheme, getThemes, getCurrentTheme, init };
});
