// 属性面板 store。open(file) → 加载元数据 → 显示。
// R16-b:open 支持 { focusNote / focusRename }——打开后聚焦备注栏 / 文件名重命名,
// 让"备注"和"重命名"入口有区别于"属性"(纯查看)的直达行为(方案 A:统一走属性面板)。
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { exifTagsToEssentials } from '../services/exif';
import { saveFileMeta } from '../services/fileMeta';
import { getMetadataStrategy } from '../services/metadata';

export const usePropertiesStore = defineStore('properties', () => {
  const visible = ref(false);
  const file = ref(null);
  const metadata = ref(null);
  const loading = ref(false);
  // 'note' | 'rename' | null:打开时的初始聚焦目标(PropertiesPanel 读一次后消费)。
  // 每次 open 重置,确保重复打开同一文件仍能再次触发聚焦。
  const initialFocus = ref(null);

  async function open(f, { focusNote = false, focusRename = false } = {}) {
    file.value = f;
    visible.value = true;
    loading.value = true;
    metadata.value = null;
    initialFocus.value = focusNote ? 'note' : focusRename ? 'rename' : null;
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      const strategy = getMetadataStrategy(ext);
      metadata.value = await strategy.getMetadata(f);
      // 打开属性即拿到全量 exif(含拍摄时间/GPS);若可持久化字段有变化,更新 file-meta(capturedAt/gps)。
      // 兜住"存量未抽过"的缺口——用户一打开属性就回填;变了才写(saveFileMeta 幂等),避免写放大。
      const ess = exifTagsToEssentials(metadata.value?.exif);
      const meta = f._meta ?? {};
      const changed = (ess?.capturedAt ?? null) !== (meta.capturedAt ?? null)
        || JSON.stringify(ess?.gps ?? null) !== JSON.stringify(meta.gps ?? null);
      if (ess && changed)
        await saveFileMeta(f, { ...ess, exifChecked: true });
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
    initialFocus.value = null;
  }

  return { visible, file, metadata, loading, initialFocus, open, close };
});
