// 属性面板 store。open(file) → 加载元数据 → 显示。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getMetadataStrategy } from '../services/metadata';

export const usePropertiesStore = defineStore('properties', () => {
  const visible = ref(false);
  const file = ref(null);
  const metadata = ref(null);
  const loading = ref(false);

  async function open(f) {
    file.value = f;
    visible.value = true;
    loading.value = true;
    metadata.value = null;
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      const strategy = getMetadataStrategy(ext);
      metadata.value = await strategy.getMetadata(f);
    }
    catch (e) {
      console.error('获取元数据失败', e);
      metadata.value = {};
    }
    finally {
      loading.value = false;
    }
  }

  function close() {
    visible.value = false;
    file.value = null;
    metadata.value = null;
  }

  return { visible, file, metadata, loading, open, close };
});
