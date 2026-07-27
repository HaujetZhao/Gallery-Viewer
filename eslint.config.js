// ESLint flat config。用 @antfu/eslint-config(Vue/Vite 生态 Anthony Fu 的一体化配置,社区事实标准)。
// stylistic 匹配现有代码风格(分号 + 单引号 + 2 空格),把首次 auto-fix 量降到最小。
import antfu from '@antfu/eslint-config';

export default antfu({
  vue: true,
  typescript: false, // 项目纯 JS
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: true,
  },
  ignores: ['dist/**', 'node_modules/**', 'docs/**', 'scripts/**', 'public/**'],
}).append({
  // 项目特性放宽(非代码质量问题):
  rules: {
    // 本地工具应用,alert/confirm/prompt 是合理的用户交互兜底(不支持浏览器提示、打开失败、清缓存确认)
    'no-alert': 'off',
    // gps.js 坐标转换(GCJ-02/BD-09)魔数逐字照搬源码,精度超 Number 安全范围但语义如此
    'no-loss-of-precision': 'off',
    // 不强制 JSDoc @returns 描述(项目注释风格自由)
    'jsdoc/require-returns-description': 'off',
  },
});
