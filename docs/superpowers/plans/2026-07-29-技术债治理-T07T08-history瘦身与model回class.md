# T07+T08 · history 瘦身 + model 恢复实例方法(合并批次)

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 或 `subagent-driven-development` 按步执行。步骤用 `- [ ]` 跟踪。
> **父规划:** [2026-07-29-技术债治理-总规划.md](2026-07-29-技术债治理-总规划.md)
> **合并批次**:T07(极小)+ T08(大,高风险)。一个窗口按序做,各自 commit。**T08 用独立分支 `debt/T08-model回class`**。

**Goal:**
- **T07**:history store 不再直接碰 `rootDirty`/`schedulePersist`(store 越权),改调持久化层的语义入口 `afterTreeMutation`。
- **T08**:`SmartFile.rename/move`、`SmartFolder.toggleExpanded/delete/addFile/removeFile` 从模块函数回到 class 实例方法。消灭「半半设计」(getter 在类、行为在模块)+ `moveFile` 绕门面直接 splice 的循环依赖尴尬 + 删除走门面/移动绕门面的「双风格并存」。**纯算法(scan/enrich/snapshot/find/collect/dispose)留模块级。**

**Why:** 审查根因 2——「纯数据类 + 模块函数」是仪式:没换来真纯度(model 函数照样 mutate + 调池/FS API),反而把方法从类上剥离增加认知负担 + 制造 moveFile 不能调 folder 方法的循环依赖尴尬(只能内联 splice)。回 class 后 `file.move(target)` 比 `moveFile(file, target)` 好读,且 `file.move` 可调 `this.parent.removeFile` + `target.addFile`,消灭绕门面。

**Tech Stack:** Vue 3 + Vitest

---

# Part T07:history 瘦身(先做,小)

**Files:** [persistence.js](../../../src/services/persistence.js) · [history.js](../../../src/stores/history.js)

- [x] **Step T07.1:persistence.js 新增 `afterTreeMutation` 语义入口**

在 [persistence.js](../../../src/services/persistence.js) 加(收口「树变了 → 置脏 + debounce 持久化」,供 history 等改树处调用,store 不再直接碰 rootDirty/schedulePersist):
```js
// 语义入口:树变更后调用(置脏 + debounced 持久化)。history 等改树处调它,不直接碰 rootDirty/schedulePersist。
export function afterTreeMutation(id) {
  const fs = useFsStore();
  fs.rootDirty = true;
  schedulePersist(id);
}
```

- [x] **Step T07.2:history.js 改调 afterTreeMutation**

[history.js](../../../src/stores/history.js) 当前 executeOperation / undoLastOperation 末尾:
```js
const fs = useFsStore();
fs.rootDirty = true;
schedulePersist(useRootStore().currentRootId);
```
改为:
```js
afterTreeMutation(useRootStore().currentRootId);
```
(两个函数都改。删 `const fs = useFsStore()` 若该函数不再用 fs。)

- [x] **Step T07.3:history.js import 调整**

```js
// 改前
import { schedulePersist } from '../services/persistence';
import { useFsStore } from './fs';
// 改后(schedulePersist → afterTreeMutation;useFsStore 若 execute/undo 不再用则删)
import { afterTreeMutation } from '../services/persistence';
```
(确认 useFsStore 是否还有其他用处——若无,删 import + 文件头注释更新。)

- [x] **Step T07.4:测试 + commit**
```bash
npm test -- history.test.js
```
history.test.js 当前 mock `'../services/persistence'` 的 `schedulePersist`。改 mock `afterTreeMutation`(vi.fn),断言改 `afterTreeMutation` 被调。调整后 PASS。
```bash
git add src/services/persistence.js src/stores/history.js src/stores/history.test.js
git commit -m "refactor(T07): history 不直接碰持久化,改调 afterTreeMutation 语义入口"
```

---

# Part T08:model 恢复实例方法(主要,高风险)

⚠️ **独立分支 `debt/T08-model回class`**。算法层(scan/enrich/snapshot/findFolderByPath/collectAllFiles/countAllFiles/disposeFolder/disposeFile/validateFolder/findValidFolderAncestor/createFolder/createVirtualFolder/createAllMediaFolder/ensureBlobUrl/fileToSnapshot/fileFromSnapshot/folderToSnapshot/folderFromSnapshot)**不动**,只把 6 个「对象行为」从模块函数搬回 class。

## 一、SmartFile:rename / move 回 class

**Files:** [SmartFile.js](../../../src/models/SmartFile.js)

- [x] **Step T08.1:SmartFile 加 `rename` 方法**

把模块函数 `renameFile(file, newName)`(L88-111)的 body 搬进 class(用 `this`):
```js
class SmartFile {
  // ... constructor + getter 不变 ...

  async rename(newName) {
    if (!this.handle || !this.parent)
      throw new Error('无法重命名：缺少必要的句柄或父级引用');
    destroy(this); // 先释放 url,避免 handle.move 报 locked
    try {
      await this.handle.move(newName);
      const entry = await acquire(this);
      this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      this.md5 = null;
      return true;
    }
    catch (err) {
      const entry = await acquire(this).catch((e) => {
        console.warn('重命名失败后重建资源失败,blobUrl 将为 null:', e);
        return null;
      });
      if (entry)
        this._meta = { size: entry.file.size, lastModified: entry.file.lastModified };
      console.error('重命名失败:', err);
      throw err;
    }
  }
}
```
删除模块级 `export async function renameFile`。

- [x] **Step T08.2:SmartFile 加 `move` 方法(消灭绕门面 splice)**

把 `moveFile(file, targetFolder)`(L114-136)搬进 class。**关键改进**:不再内联 `sourceFolder.files.splice` + `targetFolder.files.push/sort`,改调 folder 方法(`this.parent.removeFile` + `target.addFile`)——folder 方法在 T08.4 加。这消灭「移动绕门面、删除走门面」的双风格:
```js
  async move(target) {
    if (!this.parent || !this.parent.handle)
      throw new Error('无法移动：缺少父级引用');
    if (!target || !target.handle)
      throw new Error('移动：目标文件夹无效');
    try {
      await this.handle.move(target.handle);
      this.parent.removeFile(this); // 源移除(走 folder 方法,不再内联 splice)
      target.addFile(this); // 目标按序插入(addFile 内部 push + sort + 设 parent)
      return true;
    }
    catch (err) {
      console.error('移动失败:', err);
      throw err;
    }
  }
```
删除模块级 `export async function moveFile`。

- [x] **Step T08.3:SmartFile import 清理**

move 回方法后不再用 `windowsCompareStrings`(sort 移到 folder.addFile)。删 `import { windowsCompareStrings }`(若 rename/move 不再用)。`acquire/destroy/peek` 保留(方法用)。

## 二、SmartFolder:toggleExpanded / delete / addFile / removeFile 回 class

**Files:** [SmartFolder.js](../../../src/models/SmartFolder.js)

- [x] **Step T08.4:SmartFolder 加 4 个方法**

把 `toggleFolderExpanded` / `deleteFolder` / `addFileAndSort` / `removeFileFromFolder`(L68-100)搬进 class:
```js
class SmartFolder {
  // ... constructor + getter(path/isEmpty)不变 ...

  toggleExpanded() {
    this.expanded = !this.expanded;
  }

  async delete() {
    if (!this.parent || !this.parent.handle)
      throw new Error('无法删除根目录或缺少父级引用');
    try {
      await this.parent.handle.removeEntry(this.name, { recursive: true });
      const index = this.parent.subFolders.indexOf(this);
      if (index > -1)
        this.parent.subFolders.splice(index, 1);
      return true;
    }
    catch (err) {
      console.error('删除文件夹失败:', err);
      throw err;
    }
  }

  addFile(file) {
    if (!this.files.includes(file)) {
      this.files.push(file);
      file.parent = this;
      this.files.sort((a, b) => windowsCompareStrings(a.name, b.name));
    }
  }

  removeFile(file) {
    const index = this.files.indexOf(file);
    if (index > -1)
      this.files.splice(index, 1);
  }
}
```
删除模块级 `toggleFolderExpanded` / `deleteFolder` / `addFileAndSort` / `removeFileFromFolder` 四个 export function。`windowsCompareStrings` 仍 import(addFile 用)。

## 三、调用点迁移

- [x] **Step T08.5:[operations.js](../../../src/services/operations.js)**

```js
// import 改:删 moveFile/renameFile/addFileAndSort/removeFileFromFolder 的 import(model 改方法后不再导出模块函数)
// FileDeleteOperation.execute(L99): removeFileFromFolder(this.parentFolder, this.fileData) → this.parentFolder.removeFile(this.fileData)
// FileDeleteOperation.undo(L124):   addFileAndSort(this.parentFolder, this.fileData) → this.parentFolder.addFile(this.fileData)
// FileRenameOperation.execute(L141): await renameFile(this.fileData, this.newName) → await this.fileData.rename(this.newName)
// FileRenameOperation.undo(L145):    await renameFile(this.fileData, this.oldName) → await this.fileData.rename(this.oldName)
// FileMoveOperation.execute(L165):   await moveFile(this.fileData, this.targetFolder) → await this.fileData.move(this.targetFolder)
// FileMoveOperation.undo(L171):      await moveFile(this.fileData, this.sourceFolder) → await this.fileData.move(this.sourceFolder)
```

- [x] **Step T08.6:[fileOps.js](../../../src/services/fileOps.js)**

`deleteFolder(folder)`(L32)→ `folder.delete()`。删 `import { deleteFolder }`。

- [x] **Step T08.7:[SidebarTreeItem.vue](../../../src/components/SidebarTreeItem.vue)**

`toggleFolderExpanded(props.folder)`(L29)→ `props.folder.toggleExpanded()`。import 删 `toggleFolderExpanded`(保留 `collectAllFiles`)。

## 四、测试调整

- [x] **Step T08.8:[smart-file.test.js](../../../src/models/smart-file.test.js) / [smart-folder.test.js](../../../src/models/smart-folder.test.js)**

把模块函数调用改为方法调用:`renameFile(f, n)` → `f.rename(n)`;`moveFile(f, t)` → `f.move(t)`;`addFileAndSort(folder, f)` → `folder.addFile(f)`;`removeFileFromFolder(folder, f)` → `folder.removeFile(f)`;`deleteFolder(folder)` → `folder.delete()`;`toggleFolderExpanded(folder)` → `folder.toggleExpanded()`。import 同步删模块函数。用例语义不变(行为等价)。

- [x] **Step T08.9:全量测试**
```bash
npm test
```
Expected: 用例数不变(92),全 PASS。

---

## 五、整体验收

- [x] **Step V.1:grep 硬指标——6 个模块函数零残留**
```bash
grep -rn "addFileAndSort\|removeFileFromFolder\|deleteFolder\|toggleFolderExpanded\|\bmoveFile\b\|\brenameFile\b" src/
```
Expected: **零结果**(全回 class,模块函数删除;方法定义是 `move(`/`rename(` 不含 `moveFile`/`renameFile` 字样)。

- [x] **Step V.2:Lint + 双 build(分别清 dist)**
```bash
npm run lint
rm -rf dist && npm run build
rm -rf dist && npm run build:pwa
```

- [x] **Step V.3:全量测试**
```bash
npm test
```
Expected: 92 PASS。

---

## 六、验收点

**客观断言:**
- grep 6 模块函数零;test/lint/build/build:pwa 四绿。
- history 不再 import schedulePersist / 直接置 rootDirty(T07)。
- file.move 内部调 parent.removeFile + target.addFile(不再内联 splice)(T08)。

**主观体验(产品负责人,冒烟——行为不变):**
1. 重命名文件(卡片内联 + 属性面板两处)→ 正常 + 撤销正常。
2. 移动文件(拖到侧栏文件夹)→ 正常 + 撤销正常。
3. 删除文件 → 进 .trash + 撤销恢复。
4. 删除文件夹(侧栏右键)→ 正常。
5. 展开/折叠侧栏文件夹 → 正常(toggleExpanded)。

---

## 七、变更技术报告(执行者完成后填写)

```
## 变更技术报告 — T07+T08

### T07
- [x] persistence 加 afterTreeMutation([persistence.js](../../../src/services/persistence.js#L49-L53))
- [x] history 改调 afterTreeMutation(删 useFsStore 直接碰 rootDirty + 删 schedulePersist/useFsStore import)
- [x] history.test.js mock/断言 schedulePersist → afterTreeMutation

### T08
- [x] SmartFile.rename/move 回 class(move 调 this.parent.removeFile + target.addFile,不再内联 splice;删 windowsCompareStrings import)
- [x] SmartFolder.toggleExpanded/delete/addFile/removeFile 回 class(删 4 模块函数,windowsCompareStrings 保留)
- [x] 调用点迁移:operations(6 处)/ fileOps(delete)/ SidebarTreeItem(toggleExpanded)
- [x] 测试调整:smart-file/smart-folder.test.js 无现存用例用到这 6 函数 → no-op;仅 history.test.js 随 T07 改

### grep 硬指标
- model 6 模块函数 `export function renameFile|moveFile|toggleFolderExpanded|deleteFolder|addFileAndSort|removeFileFromFolder` → 零(精确 grep: No matches found)
- 宽口径残留均为合法:history store 便捷函数 renameFile/moveFile(PhotoCard/PropertiesPanel/SidebarTreeItem 调用)+ SmartFile.js 注释文字

### 测试
- 全量 92 PASS(15 文件,用例数不变)

### 验收基线
- lint ✅  test ✅(92)  build ✅(单HTML 1.4MB 自包含)  build:pwa ✅(SW + 14 预缓存)

### 主观冒烟(产品负责人浏览器验收)
- 重命名/移动/删除文件/删文件夹/展开折叠:待验收

### 遗留 / 风险 / 偏离
1. plan V.1 grep"零结果"口径不精确:history store 有同名便捷函数 renameFile/moveFile(非 model 模块函数,是 store API),命中 \bmoveFile\b/\brenameFile\b。真正归零的是 model 的 6 模块函数定义 + 其 import——已以精确口径核实为零。
2. plan T08.8(smart-file/smart-folder.test.js 改方法调用)是 no-op:两文件无现存用例用到这 6 函数。本任务未新增这 6 函数单元测试(行为等价搬移,靠 operations/history 集成路径 + 手动冒烟兜底);如需补,归 T15。
3. 默认分支为 master(非 main)。T07 commit 落在 debt/T06-单ref持树 分支(接续 T06 线,427b115);T08 在独立分支 debt/T08-model回class(811528b,含 T07)。两者均未合并 master,合并/PR 待产品负责人决定。
4. 无循环依赖引入:SmartFile.move 调 folder 实例方法(JS 动态分派),不再反向 import SmartFolder,旧 moveFile 的循环依赖尴尬已消除。
```

---

## 八、执行者注意

1. **顺序**:先 T07(小,~4 处改)commit,再 T08(大)commit。T08 独立分支。
2. **T08 只搬「对象行为」回 class,纯算法(scan/enrich/snapshot/find/collect/count/dispose/validate/create 系列/ensureBlobUrl)留模块级**——别把算法也塞进 class(那会回到 God Object)。
3. **file.move 的关键**:调 `this.parent.removeFile(this)` + `target.addFile(this)`,**不要内联 splice**(那是 T08 要消灭的绕门面)。这依赖 T08.4 先把 addFile/removeFile 加到 class——所以 T08.4 在 T08.5(operations 迁移)前做,或同批。
4. **getter 保留**(name/size/path/isEmpty 等)——Vue 响应式追踪属性访问,勿函数化。
5. **每步测试**:加一个方法 → 改调用点 → 测试绿 → 下一个。别全改完再测。
6. 双 build 分别 `rm -rf dist`。
7. grep 6 模块函数零是完成硬指标。
