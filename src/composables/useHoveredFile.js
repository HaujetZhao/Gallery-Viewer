// 当前 hover 的卡片文件(模块级单例 ref)。PhotoCard mouseenter 设 / mouseleave 清;
// App.vue 的 L 键读它切收藏、F2 触发重命名(modal 关闭时)。模块级——Gallery 不需穿 props 透传。
import { ref } from 'vue';

export const hoveredFile = ref(null);

// F2 重命名信号:App 全局 F2 → requestRename() bump;PhotoCard watch 此信号,
// 判断 hoveredFile===self 才响应(只有 hover 中的那张卡进重命名)。
// ponytail: 一个递增 tick 复用 redrawSignal 同款模式,不引入事件总线。
export const renameTick = ref(0);
export function requestRename() {
  renameTick.value++;
}
