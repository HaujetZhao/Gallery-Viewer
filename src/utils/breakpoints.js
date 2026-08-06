// 全局响应式断点单一来源(px)。JS 侧一律 import 这里的常量。
// ⚠️ CSS @media 无法读 JS 常量,各组件 @media 保留字面量但须与本文件保持一致(见各处交叉引用注释)。
export const BREAKPOINTS = {
  sm: 480, // 手机
  md: 768, // 平板
  lg: 1100, // 桌面
  sidebarPin: 900, // 侧栏允许 pin
  sidebarUnpin: 880, // 侧栏强制 overlay(与 pin 相差 20 迟滞带)
};
