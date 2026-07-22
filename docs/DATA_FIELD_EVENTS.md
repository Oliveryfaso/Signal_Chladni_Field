# 数据场事件书签

`app/data-field-events.js` 是一个没有依赖、没有网络请求、没有 DOM 操作的本地数据工具。它负责从数值序列中识别异常，把异常变成可导入/导出的书签，并为每个书签生成稳定的粒子场景配方。

它既能以浏览器全局对象使用，也能被 CommonJS 测试或 Electron 主进程引用：

```html
<script src="data-field-events.js"></script>
<script>
  const result = window.DataFieldEvents.detectAnomalies(values, { metric: 'latency_ms' });
</script>
```

```js
const DataFieldEvents = require('./app/data-field-events.js');
```

## API

### `normalizeSeries(input, options)`

接受以下任一种本地数据：

- 数值数组，例如 `[12, 13, 11]`；
- 行对象数组，例如 `[{ at: '2026-07-20', cpu: 0.42 }]`；
- `{ values, timestamps, metric }`。

`options.column` 指定数值列，`options.timeColumn` 指定时间列。缺失或不能转换为有限数字的值会跳过，绝不会被静默改成 `0`。返回 `{ metric, samples, sourceLength }`，每个 sample 都保留原始行索引。

### `detectAnomalies(input, options)`

使用只观察候选点之前历史数据的滚动稳健 Z 分数（median + MAD）检测异常。返回：

```js
{
  metric: 'latency_ms',
  samplesAnalyzed: 120,
  options: { windowSize: 12, minHistory: 6, sensitivity: 3.25 },
  events: [{ index, timestamp, value, baseline, scale, score, severity, direction }]
}
```

可选参数：

- `metric` / `column`：列名；
- `timeColumn`：行对象中的时间列；
- `windowSize`：基线历史窗口，默认 `12`；
- `minHistory`：开始检测前至少需要的观测数量，默认 `6`；
- `sensitivity`：Z 分数阈值，默认 `3.25`，越小越灵敏；
- `minimumDeviation`：业务上的最小绝对变化阈值，默认 `0`。

### `createEvent(anomaly, options)` 与 `createEvents(detection, options)`

把检测结果变成书签。书签包含异常所在 `index`、统计量、严重程度、标题、笔记和标签；不会携带整段原始数据。`createEvent` 的常用可选项：`title`、`note`、`tags`、`dataset`、`id`、`createdAt`。

`dataset` 只是一段**可选标签**，不是数据本身；不要把包含个人信息、账号或敏感文件名的内容放进去。

### `serializeBookmarks(bookmarks, options)` / `deserializeBookmarks(json)`

将书签输出为版本化 JSON，或安全地读回。导出结构使用 `schemaVersion: 1` 和 `kind: "signal-field-data-bookmarks"`，未来可以安全迁移。不能解析、类型不对或版本不支持时会抛出错误，调用方应显示可理解的导入提示。

```js
const json = DataFieldEvents.serializeBookmarks(bookmarks, {
  dataset: 'Q3 load test', // 可省略；仅作为导出标签
});
const restored = DataFieldEvents.deserializeBookmarks(json);
```

### `sceneRecipeForEvent(bookmark, options)`

为书签生成确定性的可视化配方。相同书签永远得到相同的主模态、能量、锐度和回放范围，便于复盘和分享。返回对象包括：

- `timeline.focusIndex` 和 `timeline.replayRange`：数据场跳转和回放窗口；
- `driver`：单列/合奏模式及参与列名；
- `modal.modes`：三个 `{ l, m, n, weight }` 三维模态候选；
- `excitation`：`energy`、`sharpness` 与频带中心；
- `pattern`：与现有 Signal Field `applyPattern(recipe.pattern)` 兼容的预设；
- `visual`：旋转与灯光建议。

```js
const recipe = DataFieldEvents.sceneRecipeForEvent(bookmark, {
  mode: 'ensemble',
  participatingColumns: ['latency_ms', 'requests_per_minute']
});

// 在页面集成时：
data.setMode(recipe.driver.mode);
data.setColumn(recipe.driver.primaryColumn);
data.seek(recipe.timeline.focusIndex);
applyPattern(recipe.pattern);
```

`modal.modes` 和 `excitation` 为后续“事件回放”渲染器预留；现有页面可先使用 `timeline` 和 `pattern`，不会影响原有音频和数据场效果。

## 隐私与本地性

- 此模块不发起 `fetch`、XHR、WebSocket、分析埋点或任何存储调用。
- 它只处理调用方传入的内存数据；不会自动写入 `localStorage`、IndexedDB 或文件。
- 书签导出只包含事件摘要（异常值、基线、索引、笔记等），**不含 CSV/JSON 原始行或完整序列**。
- `dataset`、标题、笔记、标签均由调用方显式传入，导出前应确认其中没有不应共享的信息。

## 集成建议

1. 当用户载入 CSV/JSON 后，从当前选中的列调用 `detectAnomalies`。
2. 把 `createEvents(result)` 的书签渲染为“异常波”时间轴或列表；点击后用 `sceneRecipeForEvent` 跳转到对应 `data.seek()` 位置。
3. 导出时只导出用户勾选的书签，而不是源数据；导入时捕获异常并给出“书签文件无效或版本不支持”的提示。
4. 后续可让渲染器读取 `recipe.modal.modes` 和 `recipe.excitation`，形成可重复的事件回放，而不改变现有实时数据/音频驱动路径。

## 验证

无需安装额外依赖：

```bash
node --check app/data-field-events.js
node scripts/test-data-field-events.cjs
```
