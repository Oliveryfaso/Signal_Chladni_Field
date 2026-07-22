# 场景、项目与时间线核心

`app/scene-studio.js` 是 Signal Field 的无依赖场景状态模块。它没有 DOM、存储或渲染循环依赖，因此 Web 页面、Electron 控制器、导出器和后续的场景编辑器都可以复用同一份项目格式。

## 接入方式

浏览器直接加载后使用 `window.SignalFieldSceneStudio`；CommonJS 环境使用：

```js
const SceneStudio = require('./app/scene-studio.js');
const studio = SceneStudio.createStore();
```

模块不会自动改写 `window.soundMotionNative`，也不会直接修改粒子引擎。只有调用者明确请求 `restoreScene(id, target)` 或 `applySoundMotionRecipe(recipe, target)` 时，才会对传入的公开渲染器目标执行受限命令。

## 快照与场景

一个完整快照包含：视觉模式、采样方式、旋转模式、几何形状、细节/粒子/演化/缩放/灯光等数值参数、旋转/对称/边框/透明开关，以及完整粒子图案规格。`createSnapshot()` 可把当前运行时状态或表单输入规范化为独立的 JSON 数据；返回值不会和输入对象共享引用。

```js
const scene = studio.addScene({
  id: 'focus-cosmic',
  name: '深度专注',
  snapshot: SceneStudio.createSnapshot(runtimeState)
});

studio.updateScene(scene.id, { name: '深度专注 · 蓝图' });
studio.reorderScenes(['focus-cosmic']);
const restored = studio.restoreScene('focus-cosmic');
```

场景支持新增、读取（`getProject()` / `getScene()` / `restoreScene()`）、更新（`updateScene()` / `saveSceneSnapshot()`）、删除和显式排序。未知 ID、重复排序、超过范围的关键帧等输入都会在写入前被拒绝。

## 项目格式与导入导出

项目格式为 `signal-field/scene-project`、版本 `1`。`exportProject()` 会先严格校验再以稳定字段顺序输出 JSON；`importProject()` 会验证 schema、版本、快照、唯一 ID 和时间线范围。相同项目的“导出 → 导入 → 导出”字节一致。

```js
const json = studio.exportJSON();
const result = studio.tryImportJSON(json);
if (!result.ok) console.error(result.error);
```

`tryImportJSON()` 在解析、schema 或版本校验失败时返回 `{ ok: false }`，并保留原有项目状态。它是 UI 文件导入流程的默认入口。

## 时间线

时间线用毫秒表示，关键帧按 `timeMs` 和 ID 稳定排序：

```js
studio.setTimelineDuration(12_000);
studio.upsertKeyframe({ id: 'intro', timeMs: 0, snapshot: introSnapshot });
studio.upsertKeyframe({ id: 'peak', timeMs: 8_000, snapshot: peakSnapshot });
const frame = studio.seek(4_000);
```

`seek()` 返回 `fromId`、`toId`、`progress` 和独立 `snapshot`。数值字段线性插值；布尔和枚举字段（例如模式、旋转开关）在到达下一个关键帧前保持前一帧的值，再进行步进切换。没有关键帧时 `snapshot` 为 `null`。

## 安全的渲染器配方

```js
const recipe = SceneStudio.createSoundMotionRecipe(frame.snapshot);
const applied = SceneStudio.applySoundMotionRecipe(recipe, window.soundMotionNative);
```

配方只可调用当前公开 API 中的 `setStyle`、`setSampleMode`、`setRotationMode`、`setSolidShape`、`setParam`、`setBoolean`、`setTransparent` 和 `applyPatternSpec`。应用前会把命令与快照的批准映射逐项比对；任何被篡改或不在白名单中的命令均不会执行。

## 验证

```bash
node scripts/verify-scene-studio.cjs
```

验证覆盖完整快照、场景 CRUD/排序、确定性导入导出、schema/version 错误隔离、数值与布尔/枚举关键帧插值、时间线 seek、安全命令应用，以及 CommonJS 和浏览器全局两种加载方式。
