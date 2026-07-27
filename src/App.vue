<script setup>
import { onMounted } from 'vue';
import { useThemeStore } from './stores/theme.js';
import { useFsStore } from './stores/fs.js';

const themeStore = useThemeStore();
const fsStore = useFsStore();

onMounted(() => {
  themeStore.init();
});

// 临时:打开文件夹 → scan → 控制台打印树(验证增量扫描算法迁移正确)。阶段 5 起替换为真实 UI。
async function scanAndPrint() {
  try {
    const result = await fsStore.openRoot();
    const root = result.folder;
    console.log('=== 扫描结果 ===');
    console.log(`根目录: ${root.name} | 文件 ${root.files.length} | 子文件夹 ${root.subFolders.length}`);
    console.log('新文件:', result.newFiles.map((f) => f.name));
    console.log('新子文件夹:', result.newSubFolders.map((f) => f.name));
    console.log('foldersData 缓存条目:', fsStore.foldersData.size);
    for (const sub of root.subFolders) {
      console.log(`  📁 ${sub.name} (scanned=${sub.scanned}, files=${sub.files.length}, subs=${sub.subFolders.length})`);
    }
    console.log('全部媒体聚合:', fsStore.allMediaFolder.name);
  } catch (e) {
    console.error('扫描失败:', e);
  }
}
</script>

<template>
  <div class="startup-placeholder">
    <i class="fas fa-images"></i>
    <h1>相册浏览器</h1>
    <p>骨架就绪 · 阶段 2:数据模型 + 扫描可用</p>

    <!-- 临时主题切换 UI(阶段 7 设置面板做好后替换) -->
    <div class="theme-switcher">
      <button
        v-for="t in themeStore.getThemes()"
        :key="t.id"
        :class="['theme-btn', { active: themeStore.currentTheme === t.id }]"
        @click="themeStore.applyTheme(t.id)"
      >
        <span class="icon">{{ t.icon }}</span>
        <span>{{ t.name }}</span>
      </button>
    </div>

    <!-- 临时扫描按钮(阶段 5 画廊做好后替换) -->
    <div class="scan-zone">
      <button class="scan-btn" @click="scanAndPrint">📂 打开文件夹并扫描(F12 看控制台)</button>
      <span v-if="fsStore.currentFolder" class="scan-result">
        当前: {{ fsStore.currentFolder.name }} · {{ fsStore.currentFolder.files.length }} 文件
      </span>
    </div>
  </div>
</template>

<style scoped>
.startup-placeholder {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg-secondary, #f5f7fa);
  color: var(--text-primary, #333);
}
.startup-placeholder i {
  font-size: 80px;
  color: var(--color-primary, #3498db);
}
.startup-placeholder h1 {
  font-size: 36px;
  margin: 0;
}
.startup-placeholder p {
  color: var(--text-secondary, #666);
}

.theme-switcher {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 2px solid var(--color-primary, #3498db);
  border-radius: 999px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}
.theme-btn:hover {
  background: var(--color-primary, #3498db);
  color: #fff;
}
.theme-btn.active {
  background: var(--color-primary, #3498db);
  color: #fff;
}
.theme-btn .icon {
  font-size: 18px;
}

.scan-zone {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.scan-btn {
  padding: 10px 20px;
  border: 2px dashed var(--color-primary, #3498db);
  border-radius: 8px;
  background: transparent;
  color: var(--color-primary, #3498db);
  cursor: pointer;
  font-size: 14px;
}
.scan-btn:hover {
  background: var(--color-primary, #3498db);
  color: #fff;
}
.scan-result {
  color: var(--text-secondary, #666);
  font-size: 13px;
}
</style>
