// 当前 hover 的卡片文件(模块级单例 ref)。PhotoCard mouseenter 设 / mouseleave 清;
// App.vue 的 L 键读它切收藏(modal 关闭时)。模块级——Gallery 不需穿 props 透传。
import { ref } from 'vue';

export const hoveredFile = ref(null);
