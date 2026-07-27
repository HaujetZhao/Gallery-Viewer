// 用户设置 store。搬自源码 js/config.js 的 UserSettings 静态类,改为 Pinia setup store。
// settings 响应式,UI 可直接绑定;load() 合并 CONFIG.DEFAULTS 保证新字段有默认值。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { CONFIG } from '../config/index';

const STORAGE_KEY = 'gallery-viewer-settings';

export const useUserSettingsStore = defineStore('userSettings', () => {
  const settings = ref({ ...CONFIG.DEFAULTS });

  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      settings.value = stored
        ? { ...CONFIG.DEFAULTS, ...JSON.parse(stored) }
        : { ...CONFIG.DEFAULTS };
    } catch (e) {
      console.warn('加载用户设置失败:', e);
      settings.value = { ...CONFIG.DEFAULTS };
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value));
  }

  function get(key) {
    return settings.value[key];
  }

  function set(key, value) {
    settings.value = { ...settings.value, [key]: value };
    save();
  }

  function update(updates) {
    settings.value = { ...settings.value, ...updates };
    save();
  }

  function reset() {
    settings.value = { ...CONFIG.DEFAULTS };
    save();
  }

  // store 初始化即加载持久化设置
  load();

  return { settings, load, save, get, set, update, reset };
});
