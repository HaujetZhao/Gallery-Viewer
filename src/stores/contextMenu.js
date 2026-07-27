// 右键菜单 store(数据驱动)。show(clientX, clientY, items) → 显示;items=[{label,icon,action,disabled?,danger?,divider?}]。
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useContextMenuStore = defineStore('contextMenu', () => {
  const visible = ref(false);
  const x = ref(0);
  const y = ref(0);
  const items = ref([]);

  function show(clientX, clientY, itemArr) {
    x.value = clientX;
    y.value = clientY;
    items.value = itemArr;
    visible.value = true;
  }
  function hide() {
    visible.value = false;
    items.value = [];
  }

  return { visible, x, y, items, show, hide };
});
