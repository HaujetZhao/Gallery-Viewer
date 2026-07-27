// 存储占用估算。navigator.storage.estimate() → 文本。SettingsPanel 打开时 refresh。
import { ref } from 'vue';

export function useStorageEstimate() {
  const text = ref('计算中...');

  async function refresh() {
    if (!navigator.storage?.estimate) {
      text.value = '浏览器不支持存储估算';
      return;
    }
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const usedMB = (usage / 1048576).toFixed(2);
      const quotaMB = (quota / 1048576).toFixed(0);
      const percent = ((usage / quota) * 100).toFixed(1);
      text.value = `${usedMB} MB / ${quotaMB} MB (${percent}%)`;
    } catch (e) {
      text.value = '无法获取存储信息';
    }
  }

  return { text, refresh };
}
