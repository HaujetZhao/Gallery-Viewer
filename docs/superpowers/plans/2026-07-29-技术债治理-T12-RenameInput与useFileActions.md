# T12 · RenameInput + useFileActions

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](2026-07-29-技术债治理-总规划.md)
> ⚠️ **基于 master(含 T11+T13)**:开工前确认 `debt/T11T13` 已合并 master。
> **UI 抽组件,主观验收为主。**

**Goal:**
- **RenameInput.vue**:封装内联重命名 input(选区/focus + 防重入 commit + 非法字符校验 + history.renameFile + toast),**去重** PhotoCard/PropertiesPanel 两份几乎相同的重命名逻辑。
- **useFileActions.js**:统一文件操作右键菜单(属性/重命名/删除),替换 PhotoCard 现场拼菜单项。

**Why:** 审查根因 5——PhotoCard([L34-71](../../../src/components/PhotoCard.vue#L34))与 PropertiesPanel([L63-106](../../../src/components/PropertiesPanel.vue#L63))**两份重复**的重命名逻辑(committing 防重入、非法字符正则、enter/esc/blur 三事件全同);右键菜单项散落各组件现场拼,无统一注册。

**Tech Stack:** Vue 3 组件 + composable

---

## 一、新建 `src/components/RenameInput.vue`

- [x] **Step 1.1:创建 RenameInput(完整封装重命名)**

```vue
<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { useHistoryStore } from '../stores/history';
import { useToastStore } from '../stores/uiToast';

// 内联重命名 input:封装选区/focus + 防重入 commit + 非法字符 + history.renameFile + toast。
// 去重 PhotoCard/PropertiesPanel 两份相同逻辑。父用 v-if 显示,@done 隐藏。
const props = defineProps({
  file: { type: Object, required: true },
});
const emit = defineEmits(['done']); // 重命名结束(提交/取消/失败)→ 父隐藏

const history = useHistoryStore();
const toast = useToastStore();
const draftName = ref(props.file.name);
const inputEl = ref(null);
let committing = false; // 防重入(提交后 input 卸载的边角)

// 挂载即选区(扩展名外)+ focus
onMounted(() => {
  nextTick(() => {
    const dotIdx = props.file.name.lastIndexOf('.');
    if (dotIdx > 0)
      inputEl.value?.setSelectionRange(0, dotIdx);
    else
      inputEl.value?.select();
    inputEl.value?.focus();
  });
});

async function commit() {
  if (committing)
    return;
  committing = true;
  const newName = draftName.value.trim();
  emit('done'); // 立即隐藏(匹配原 editing=false 在 try 开头;v-if 卸载不触发 blur)
  try {
    if (!newName || newName === props.file.name)
      return;
    if (/[<>:"/\\|?*]/.test(newName)) {
      toast.error('文件名包含非法字符');
      return;
    }
    await history.renameFile(props.file, newName);
    toast.success('重命名成功(Ctrl+Z 撤销)');
  }
  catch (e) {
    toast.error(`重命名失败: ${e.message}`);
  }
  finally {
    committing = false;
  }
}
function cancel() {
  emit('done');
}
</script>

<template>
  <input
    ref="inputEl"
    v-model="draftName"
    class="renaming-input"
    @keyup.enter="commit"
    @keyup.esc="cancel"
    @blur="commit"
    @click.stop
  >
</template>
```
(`.renaming-input` 样式沿用全局 CSS,不在 scoped 重写。)

---

## 二、新建 `src/composables/useFileActions.js`

- [x] **Step 2.1:创建 useFileActions(统一文件右键菜单)**

```js
import { useHistoryStore } from '../stores/history';
import { usePropertiesStore } from '../stores/properties';
import { useToastStore } from '../stores/uiToast';

// 统一文件操作右键菜单(属性 / 重命名 / 删除)。
// 重命名需父触发 UI(显示 RenameInput),故接 onRename callback。
// @param onRename  (file) => void  父的重命名触发(设 editing=true)
// @returns { fileMenu(file) => menuItem[] }
export function useFileActions(onRename) {
  const history = useHistoryStore();
  const properties = usePropertiesStore();
  const toast = useToastStore();

  async function onDelete(file) {
    try {
      await history.deleteFile(file);
      toast.success('已移动到 .trash 回收站(Ctrl+Z 撤销)');
    }
    catch (e) {
      toast.error(`删除失败: ${e.message}`);
    }
  }

  function fileMenu(file) {
    return [
      { label: '属性', icon: 'fas fa-info-circle', action: () => properties.open(file) },
      { label: '重命名', icon: 'fas fa-edit', action: () => onRename(file) },
      { divider: true },
      { label: '删除', icon: 'fas fa-trash-alt', danger: true, action: () => onDelete(file) },
    ];
  }

  return { fileMenu };
}
```

---

## 三、PhotoCard 用 RenameInput + useFileActions

- [x] **Step 3.1:删重复逻辑 + 接入**

[PhotoCard.vue](../../../src/components/PhotoCard.vue):
- 删 `editing`/`draftName`/`nameInputEl` ref、`startRename`/`commitRename`/`cancelRename`/`committing`(L29-71)、`onDelete`(L81-89)
- import:`import RenameInput from './RenameInput.vue';` + `import { useFileActions } from '../composables/useFileActions';`
- script 加(保留 contextMenu/history/properties/toast store):
```js
const editing = ref(false);
function startRename() { editing.value = true; }
const { fileMenu } = useFileActions(startRename);

function onContextmenu(e) {
  contextMenu.show(e.clientX, e.clientY, fileMenu(props.file));
}
```
(原 onContextmenu 的手动菜单数组删,改 fileMenu。)
- template 的 `<input v-if="editing" ...>`(L149-158)替换为:
```html
<RenameInput v-if="editing" :file="props.file" @done="editing = false" />
```

## 四、PropertiesPanel 用 RenameInput

- [x] **Step 4.1:删重复逻辑 + 接入**

[PropertiesPanel.vue](../../../src/components/PropertiesPanel.vue)(无右键菜单,只用 RenameInput 去重重命名):
- 删 `editing`/`draftName`/`nameInputEl`、`startRename`/`commitRename`/`cancelRename`/`committing`(L63-106)
- import RenameInput
- 加 `const editing = ref(false);`,startRename 改为 `editing.value = true`(点文件名触发处调)
- template 的重命名 input 替换为 `<RenameInput v-if="editing" :file="props2.file" @done="editing = false" />`

---

## 五、验收

- [x] **Step V.1:grep 确认去重**
```bash
grep -rn "committing" src/components/
```
Expected: **零**(两份防重入逻辑都收口到 RenameInput)。
```bash
grep -rn "renameFile(props" src/components/
```
Expected: 零(不在组件调,在 RenameInput)。

- [x] **Step V.2:双 build + 测试 + Lint**
```bash
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
npm test && npm run lint
```

---

## 六、验收点

**客观断言:**
- RenameInput.vue + useFileActions.js 新建;PhotoCard/PropertiesPanel 删重复重命名逻辑(grep committing 零);PhotoCard 右键改 fileMenu。

**主观体验(产品负责人):**
1. **卡片重命名**:右键→重命名 / 双击文件名 → input 出现(选中文件名主体)→ Enter 提交 / Esc 取消 / blur 提交;非法字符 toast;Ctrl+Z 撤销。
2. **属性面板重命名**:点文件名 → 同上。
3. **右键菜单**(属性/重命名/删除)正常,不回归。

---

## 七、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T12

### 改了什么
- [x] RenameInput.vue 新建(完整封装:onMounted 选区/focus + 防重入 commit + 非法字符正则 + history.renameFile + toast)
- [x] useFileActions.js 新建(fileMenu(file) 返回 [属性/重命名/删除];接 onRename callback 触发父 UI,属性/删除在 composable 内)
- [x] PhotoCard 用 RenameInput + useFileActions(删 ~45 行重复重命名逻辑 + 手动菜单数组;右键改 fileMenu)
- [x] PropertiesPanel 用 RenameInput(删 ~45 行重复重命名逻辑 + 删 scoped .props-rename-input 样式)
- [x] 额外:token 化全局 .renaming-input(见「偏离 1」)

### 涉及文件
- src/components/RenameInput.vue(新)/ src/composables/useFileActions.js(新)
- src/components/PhotoCard.vue / src/components/PropertiesPanel.vue / src/styles/sidebar.css

### grep 硬指标
- committing / renameFile(props / draftName / commitRename 在 PhotoCard + PropertiesPanel → 零(全部收口到 RenameInput.vue)
- 注:RenameInput.vue 自身含 committing/renameFile(它是收口目标,位于 src/components/);故计划原文 `grep committing src/components/` 会命中 RenameInput——真实去重指标 = 两个消费组件零命中,已满足

### 验收基线
- lint ✅  test ✅(15 文件 / 95 用例)  build ✅  build:pwa ✅

### 主观验收(产品负责人)
1. 卡片重命名(右键/双击 + Enter/Esc/blur + 非法字符 + Ctrl+Z 撤销):待验收
2. 属性面板重命名:待验收
3. 右键菜单(属性/重命名/删除)不回归:待验收

### 遗留 / 风险 / 偏离
1. **token 化 .renaming-input(偏离计划)**:计划要求 RenameInput 沿用全局 .renaming-input 不改样式。但该类原为硬编码 #3498db/#333(不随主题),而 PropertiesPanel 原 .props-rename-input 是 T10 token 化版——直接复用会让属性面板暗色模式回归、且 PhotoCard 重命名框暗色本就不可读。故 token 化该全局类:border/color → var(--color-primary)/var(--text-primary),补 background: var(--bg-primary)。token 值与原硬编码完全相同(#3498db==--color-primary、#333==--text-primary),light 模式零视觉变化,dark 模式修复可读性。仅 PhotoCard 用此类(SidebarTreeItem 无重命名),爆炸半径为零。box-shadow 蓝光保留未动。
2. **删除 PhotoCard 未用 store(偏离计划 Step 3.1)**:计划注「保留 contextMenu/history/properties/toast store」,但删掉 commitRename/onDelete 后 history/properties/toast 在 PhotoCard 变未使用(antfu no-unused-vars 会报错)。故只留 contextMenu,其余由 useFileActions 内部持有。PropertiesPanel 同理删 history/toast。
3. 主观体验(重命名选区范围/手感/右键观感/暗色显示)由产品负责人浏览器上手验收。
4. SidebarTreeItem 文件夹右键不在 T12(计划第 8 条),useFileActions 仅文件操作。
```

---

## 八、执行者注意

1. **RenameInput 完整封装重命名**(选区/focus/防重入/正则/history/toast),父只 v-if + @done。别让父再写 commit 逻辑(那等于没去重)。
2. **useFileActions 接 onRename callback**(重命名需父触发 UI);属性/删除在 composable 内(properties.open/history.deleteFile)。
3. **PropertiesPanel 无右键**,只用 RenameInput 去重重命名(不接 useFileActions)。
4. **SidebarTreeItem 的文件夹右键不在 T12**(那是文件夹操作,非文件;useFileActions 是文件操作)。
5. `.renaming-input` 样式沿用全局 CSS,RenameInput 不重写 scoped。
6. UI 改动主观验收为主;客观(grep committing/renameFile 零)可查。
7. 双 build 分别 `rm -rf dist`。
