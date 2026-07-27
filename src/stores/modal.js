// Modal 状态 store。Gallery 点击时传 fileList(displayFiles),翻页自带,不依赖 Gallery 内部。
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useModalStore = defineStore('modal', () => {
  const isOpen = ref(false);
  const currentIndex = ref(-1);
  const currentFile = ref(null);
  const fileList = ref([]); // Gallery 传入的 displayFiles

  function open(file, list) {
    fileList.value = list;
    currentIndex.value = list.indexOf(file);
    currentFile.value = file;
    isOpen.value = true;
  }

  function openByIndex(i) {
    if (i < 0 || i >= fileList.value.length)
      return;
    currentIndex.value = i;
    currentFile.value = fileList.value[i];
  }

  function next() {
    if (currentIndex.value < fileList.value.length - 1)
      openByIndex(currentIndex.value + 1);
  }

  function prev() {
    if (currentIndex.value > 0)
      openByIndex(currentIndex.value - 1);
  }

  function close() {
    isOpen.value = false;
    currentIndex.value = -1;
    currentFile.value = null;
  }

  return { isOpen, currentIndex, currentFile, fileList, open, openByIndex, next, prev, close };
});
