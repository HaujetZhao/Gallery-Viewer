# T03 · 拆 filesystem 上帝模块(行为不变)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](2026-07-29-技术债治理-总规划.md)
> **本文件自包含**——执行者读 [src/services/filesystem.js](../../../src/services/filesystem.js) 现状 + 本文档即可动手。

**Goal:** 把 `filesystem.js`(~424 行 / 15 导出)按职责拆成 `persistence.js` / `scanIntegration.js` / `folderActions.js` 三个文件,**行为零变化**(纯物理移动 + import 迁移,无逻辑改动)。

**Why:** filesystem.js 是审查标记的「上帝模块」——持久化调度、scan 整合、Vue 代理补丁、入口流程、文件夹 CRUD 六类不相关关注点挤一个文件。拆开后每个文件可独立理解,且**拆散 filesystem↔history 的循环 import**(拆后 history→persistence 单向)。

**Architecture:** 按职责三份;函数从 filesystem.js **整段复制**(含注释)到新文件;删 filesystem.js;改全部 import 点(9 处生产 + history + 测试)。

**Tech Stack:** Vue 3 + Pinia + Vitest

---

## 一、拆分设计:函数归属表

按函数名从 [filesystem.js](../../../src/services/filesystem.js) 复制到对应新文件(整段含注释,不改逻辑):

### 📦 `src/services/persistence.js` — 持久化调度

| 函数 / 符号 | 说明 |
|---|---|
| `persistTimer`(模块级 let)| debounce timer |
| `PERSIST_DEBOUNCE_MS`(模块级 const)= 1000 | debounce 窗口 |
| `persistIfDirty(id)` | 仅 dirty 时 toSnapshot+countAllFiles+saveScan |
| `schedulePersist(id)` | debounced 调度 |
| `cancelPendingPersist()` | 清 timer(reload 用) |
| `flushPendingPersist()` | 立即落盘(switch 用) |

**import 骨架:**
```js
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { saveScan } from './scanCache';
import { countAllFiles, folderToSnapshot } from '../models/SmartFolder';
```
> 把 filesystem.js 里 `persistTimer` / `PERSIST_DEBOUNCE_MS` 定义、`persistIfDirty` / `schedulePersist` / `cancelPendingPersist` / `flushPendingPersist` 四个函数、以及它们上方的竞态防线注释(约 117-163 行)**整段**搬来。

### 🔗 `src/services/scanIntegration.js` — scan 整合 + 树注册(代理陷阱收口)

| 函数 | 说明 | 原 export? |
|---|---|---|
| `resetFoldersData(fs)` | 切根重置(含 `useHistoryStore().clear()`,T02 加) | 已 export |
| `registerFolderTree(folder, fs)` | 递归注册 folder 树 | **原内部 → 改 export**(folderActions 用) |
| `integrateScanResult(folder, result, fs)` | scan 结果写回代理 + 增删检测置 dirty | 已 export |
| `registerAndIntegrate(plainFolder, scanResult, fs)` | set→取代理→integrate 收口 | **原内部 → 改 export**(folderActions 用) |

**import 骨架:**
```js
import { disposeFile } from '../models/SmartFile';
import { createFolder, disposeFolder, scanFolder } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useHistoryStore } from '../stores/history';
```
> 搬 filesystem.js 的 `resetFoldersData` / `registerFolderTree` / `integrateScanResult` / `registerAndIntegrate`(约 24-75 行)。`registerFolderTree` 和 `registerAndIntegrate` 从 `function` 改 `export function`。

### 📂 `src/services/folderActions.js` — 文件夹 CRUD / 编排 / 入口流程

| 函数 | 说明 |
|---|---|
| `bgToken`(模块级)+ `newBackgroundToken()` | 后台扫描取消令牌 |
| `initProject(handle)` | 设 rootHandle + reset + loadProject |
| `scanAndPersist(id)` | 后台扫 + 持久化(内部) |
| `rootEagerScan(root, token)` | root 一层扫(内部) |
| `openFolderPicker()` | picker 打开 |
| `switchToRoot(id)` | 切根 |
| `getFolderData(dirHandle)` | folder 缓存(命中复用/未命中建) |
| `loadProject(handle)` | 建根 folder |
| `startBackgroundScan(parentFolder, token)` | 后台递归扫 |
| `reloadProject()` | 重载当前根 |
| `refreshFolder(folder)` | 重扫单文件夹 |
| `loadFolder(folder)` | 加载显示 |
| `switchToAllPhotos()` | 聚合 ALL_MEDIA |
| `handleFolderClick(folder)` | 文件夹点击编排 |

**import 骨架:**
```js
import { CONFIG } from '../config/index';
import { createFolder, enrichFolder, folderFromSnapshot, scanFolder, validateFolder } from '../models/SmartFolder';
import { useFsStore } from '../stores/fs';
import { useRootStore } from '../stores/root';
import { useToastStore } from '../stores/uiToast';
import { isFileSystemAccessSupported } from '../utils/browser';
import { makeCancelToken, runConcurrent } from '../utils/concurrency';
import * as handleStore from './handleStore';
import { handleFolderNotFound } from './recovery';
import { loadScan } from './scanCache';
import { cancelPendingPersist, flushPendingPersist, persistIfDirty, schedulePersist } from './persistence';
import { integrateScanResult, registerAndIntegrate, registerFolderTree, resetFoldersData } from './scanIntegration';
```
> ⚠️ 注意:**不再 import `countAllFiles`**(它只在 persistIfDirty 里用,已随 persistIfDirty 搬去 persistence)。搬其余全部函数(bgToken/newBackgroundToken + initProject 到 handleFolderClick,约 15-22 行 + 77-417 行)。

---

## 二、生产代码 import 迁移清单(9 处 + history)

拆完删 filesystem.js 后,所有 `from '.../filesystem'` 要改指向新文件。grep 已确认这 10 处:

| 文件 | 原 import | 改为 |
|---|---|---|
| [fileOps.js](../../../src/services/fileOps.js):6 | `loadFolder, refreshFolder, switchToAllPhotos` | `from './folderActions'` |
| [history.js](../../../src/stores/history.js):5 | `schedulePersist` | `from '../services/persistence'` ⭐(顺带解除循环 import) |
| [SidebarTreeItem.vue](../../../src/components/SidebarTreeItem.vue):5 | `handleFolderClick` | `from '../services/folderActions'` |
| [Sidebar.vue](../../../src/components/Sidebar.vue):4 | `switchToAllPhotos` | `from '../services/folderActions'` |
| [SettingsPanel.vue](../../../src/components/SettingsPanel.vue):5 | `refreshFolder, reloadProject` | `from '../services/folderActions'` |
| [RootSwitcher.vue](../../../src/components/RootSwitcher.vue):3 | `openFolderPicker, switchToRoot` | `from '../services/folderActions'` |
| [recovery.js](../../../src/services/recovery.js):6 | `integrateScanResult, startBackgroundScan` | **拆两行**:`integrateScanResult` from `'./scanIntegration'`;`startBackgroundScan` from `'./folderActions'` |
| [App.vue](../../../src/App.vue):15 | `flushPendingPersist, openFolderPicker, switchToRoot` | **拆两行**:`flushPendingPersist` from `'./services/persistence'`;`openFolderPicker, switchToRoot` from `'./services/folderActions'` |

> 迁移后 grep `from ['"][^'"]*filesystem['"]` src/ 应**零结果**(filesystem.js 已删)。

---

## 三、测试拆分([filesystem.test.js](../../../src/services/filesystem.test.js) → 三个文件)

测试用例按被测函数的新归属拆分(用例代码不变,只改 import 源 + 归位):

| 新测试文件 | 迁入的 describe / 用例 | import 源 |
|---|---|---|
| `persistence.test.js` | `persistIfDirty`(3 用例)+ 持久化调度 `schedulePersist/cancel/flush`(7 用例) | `from './persistence'`;保留 `vi.mock('./scanCache')` + spy `folderToSnapshot/countAllFiles` |
| `scanIntegration.test.js` | `integrateScanResult dirty`(3 用例)+ `resetFoldersData 清撤销栈`(T02,1 用例) | `from './scanIntegration'` + `useFsStore`/`useHistoryStore` |
| `folderActions.test.js` | `startBackgroundScan`(3 用例)+ `handleFolderClick`(1 用例) | `from './folderActions'`;保留 `vi.mock('./scanCache')`/`'./handleStore'` + spy SmartFolder(`enrichFolder` 等) |

> `fakeFolder` / `makeValuesIter` 辅助函数:被 `folderActions.test.js` 的 startBackgroundScan 用例用,留在 folderActions.test.js(或抽到共享 helper,但保持简单:复制到用的那个文件)。
> 删除原 `filesystem.test.js`。

---

## 四、任务步骤

### Task 1:创建三个新文件,搬函数

- [ ] **Step 1.1:创建 `persistence.js`** —— 按一节的 import 骨架 + 搬 4 函数 + 2 模块级符号(整段含注释)。
- [ ] **Step 1.2:创建 `scanIntegration.js`** —— 按 import 骨架 + 搬 4 函数(registerFolderTree/registerAndIntegrate 改 export)。
- [ ] **Step 1.3:创建 `folderActions.js`** —— 按 import 骨架 + 搬 bgToken/newBackgroundToken + 14 函数。
- [ ] **Step 1.4:三个文件各自 lint**
```bash
npm run lint
```
Expected: 通过(此时 filesystem.js 还在,可能报"未使用"——若报可暂忽略,Step 2 删 filesystem.js 后即净)。

- [ ] **Step 1.5:Commit**
```bash
git add src/services/persistence.js src/services/scanIntegration.js src/services/folderActions.js
git commit -m "refactor(T03): 新建 persistence/scanIntegration/folderActions,从 filesystem 搬函数"
```

### Task 2:迁移 import + 删 filesystem.js

- [ ] **Step 2.1:改 8 个生产文件的 import**(按第二节清单)
- [ ] **Step 2.2:改 history.js import**(schedulePersist → persistence)
- [ ] **Step 2.3:删除 `src/services/filesystem.js`**
- [ ] **Step 2.4:grep 确认零残留**
```bash
grep -rn "from ['\"][^'\"]*filesystem['\"]" src/
```
Expected: 零结果。
```bash
npm run lint
```
Expected: 通过。

- [ ] **Step 2.5:Commit**
```bash
git add -A
git commit -m "refactor(T03): 迁移全部 import 到新模块 + 删 filesystem.js 上帝模块"
```

### Task 3:拆分测试文件

- [ ] **Step 3.1:创建 `persistence.test.js`** —— 迁入 persistIfDirty + 调度用例,import from './persistence'。
- [ ] **Step 3.2:创建 `scanIntegration.test.js`** —— 迁入 integrateScanResult dirty + resetFoldersData 清栈用例。
- [ ] **Step 3.3:创建 `folderActions.test.js`** —— 迁入 startBackgroundScan + handleFolderClick 用例(+ fakeFolder/makeValuesIter)。
- [ ] **Step 3.4:删除 `filesystem.test.js`**
- [ ] **Step 3.5:跑测试**
```bash
npm test
```
Expected: 用例总数不变(应仍为 89,只是分散到 3 文件),全 PASS。

- [ ] **Step 3.6:Commit**
```bash
git add -A
git commit -m "test(T03): 测试文件按新模块拆分(persistence/scanIntegration/folderActions)"
```

---

## 五、整体验收

- [ ] **Step 5.1:全量测试**
```bash
npm test
```
Expected: 89 用例全 PASS(分布到 persistence/scanIntegration/folderActions 三 test 文件)。

- [ ] **Step 5.2:Lint**
```bash
npm run lint
```

- [ ] **Step 5.3:双 build(先清 dist)**
```bash
rm -rf dist && npm run build && npm run build:pwa
```

- [ ] **Step 5.4:客观断言核对**
- `grep -rn "from ['\"][^'\"]*filesystem['\"]" src/` → 零结果。
- `src/services/filesystem.js` 不存在;`persistence.js`/`scanIntegration.js`/`folderActions.js` 存在。
- 循环 import 消失:history → persistence(单向),无 history←persistence 回边。

---

## 六、验收点

**客观断言(执行者自查):**
- 89 用例全 PASS(无新增无减少——纯拆分)。
- test / lint / build / build:pwa 四绿。
- filesystem.js 删除,三新文件就位,import 零残留。

**主观体验(产品负责人,冒烟——证明拆分行为不变):**
1. 打开一个文件夹 → 缩略图正常显示、子目录可展开。
2. 切换到另一个根 → 秒显 + 后台校验正常。
3. 删一个文件 → Ctrl+Z → 恢复(T02 的撤销仍工作)。
4. 改名 / 移动文件 → 正常 + 持久化(切走再切回改动还在)。

---

## 七、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T03

### 改了什么
- 新建 persistence.js(67 行:persistIfDirty / schedulePersist / cancelPendingPersist / flushPendingPersist + persistTimer / PERSIST_DEBOUNCE_MS)
- 新建 scanIntegration.js(62 行:resetFoldersData / registerFolderTree / integrateScanResult / registerAndIntegrate;registerFolderTree 与 registerAndIntegrate 原内部 → 改 export)
- 新建 folderActions.js(304 行:bgToken / newBackgroundToken + initProject / scanAndPersist / rootEagerScan / openFolderPicker / switchToRoot / getFolderData / loadProject / startBackgroundScan / reloadProject / refreshFolder / loadFolder / switchToAllPhotos / handleFolderClick 共 14 函数)
- 删 filesystem.js(-421 行)
- 迁移 8 生产文件 + history.js 的 import(fileOps / history / SidebarTreeItem / Sidebar / SettingsPanel / RootSwitcher / recovery / App;recovery 与 App 各拆两行)
- 测试拆三文件 + 补 smart-folder.test.js / history.test.js 的动态 import 漏迁

### 涉及文件 + 行数
- 新增:persistence.js(+67) / scanIntegration.js(+62) / folderActions.js(+304)
- 删除:filesystem.js(-421)
- import 迁移(各 ±2~3 行):App.vue / Sidebar.vue / SidebarTreeItem.vue / SettingsPanel.vue / RootSwitcher.vue / services/fileOps.js / services/recovery.js / stores/history.js
- 动态 import 补漏:models/smart-folder.test.js(integrateScanResult → scanIntegration,3 处) / stores/history.test.js(schedulePersist → persistence,mock + 2 处动态 + 注释)

### 测试
- persistence.test.js: 9 PASS(persistIfDirty 3 + 持久化调度 6)
- scanIntegration.test.js: 4 PASS(integrateScanResult dirty 3 + resetFoldersData 清栈 1)
- folderActions.test.js: 4 PASS(startBackgroundScan 3 + handleFolderClick 1)
- 总计 89 PASS(与拆前一致)

### 验收基线
- lint ✅  test ✅(89)  build ✅  build:pwa ✅(双 build 须分别清 dist,连续跑会冲突)

### 循环 import(T03 核心目标)
- 拆散原 filesystem↔history 循环。新依赖链:scanIntegration → history → persistence,单向无回边。
- persistence.js 只 import models/SmartFolder + stores/fs + stores/root + services/scanCache,不反向 import history / scanIntegration / folderActions。

### 主观冒烟(产品负责人)
- 打开 / 浏览 / 切根 / 撤销 / 改名移动:待产品负责人上手验收(客观断言全绿,纯物理拆分行为应不变)。

### 偏离 / 修正(均非逻辑改动)
1. 计划骨架 scanIntegration.js import 误含 useFsStore / createFolder / scanFolder —— 4 个函数实际均通过参数 `fs` 收 store、不调 useFsStore(),也不用 createFolder / scanFolder → 按实际精简,只留 disposeFile / disposeFolder / useHistoryStore。
2. 计划骨架 persistence.test.js 漏 vi.mock('./handleStore') —— persistIfDirty → useRootStore().updateMeta → handleStore.update 触发 idb-keyval 读 indexedDB(jsdom 无) → 补 mock。
3. Task 2 静态 grep(`from ['"]...filesystem['"]`)漏抓动态 `import('...')`,导致 smart-folder.test.js / history.test.js collect 阶段加载失败(0 test) → 补迁。
4. 双 build 验证须分别 `rm -rf dist`(两套共用 dist,先跑单 HTML 留产物会让 build:pwa 的 PWA 插件扫描冲突,exit 127;清后正常)。

### 遗留 / 风险
- 无功能性遗留。主观 UI 冒烟待产品负责人。
```

---

## 八、执行者注意

1. **纯移动,零逻辑改动**——任何函数体都不要改,只搬位置 + 改 import。若发现需要改逻辑,**停,反馈架构师**(那超出 T03 范围)。
2. **registerFolderTree / registerAndIntegrate 要改 export**(原是内部 function,现 folderActions 要 import)。
3. **folderActions 不 import countAllFiles**(已随 persistIfDirty 去 persistence)——多了会 lint 报未使用。
4. **循环 import 验证**:拆后 history 只 import persistence(不再经 filesystem);persistence 不反向 import history/scanIntegration/folderActions。若 build 报循环 import 相关错误,检查 persistence 是否误 import 了上层。
5. **测试用例数必须 = 89**(拆前)。少了 = 迁漏;多了 = 误增。这是"行为不变"的硬指标。
6. **build 前 `rm -rf dist`**。
7. 每步小 commit,出错可回退到上一个绿点。
