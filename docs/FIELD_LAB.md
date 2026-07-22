# 交互物理实验室（兼容模块）

> 当前产品界面优先使用 `app/plate-lab-core.js` 与 `app/plate-lab-ui.js`。它们提供带 SI 参数校验的矩形薄板解析模型、理论频率、频响、节点网格和触控/键盘交互。本文描述的 `field-lab.js` 继续保留为轻量兼容回退和纯函数参考，不再是首选 UI。

`app/field-lab.js` 是一个无依赖、可独立挂载的实验室模块。它不改写粒子引擎；它将“激振位置 + 驱动频率”转换为一个可解释的模态选择，以及现有可视化器可以接收的命令配方。

## 用户效果

- 在板面拖动激振点；也可聚焦板面后用方向键移动，`Shift` 加速，`Home` 回到中心。
- 调节或自动扫描频率，模块会显示最易被激发的 `(m,n)` 主模态、理论共振频率、频率偏差和耦合强度。
- 板面会画出对应模态的节点线，激振点会同时标注为节点、腹部或过渡区。
- 点击“应用到粒子场”会生成命令配方；当传入现有渲染器目标时，会调用其公开的 `setStyle`、`setParam` 和 `applyPatternSpec` 方法。

节点是振幅接近零的稳定区域，颗粒会逐渐聚集到那里；腹部是振幅最大的位置，适合放置激振点来耦合该模态。这里使用的是矩形板的教学近似 `sin(mπx)sin(nπy)`，不是对真实材料、边界条件或三维实体的数值仿真。

## 接入方式

在 `app/index.html` 中加载模块（未来集成时添加，当前模块不自动修改主界面）：

```html
<script src="field-lab.js"></script>
<div id="field-lab-slot"></div>
<script>
  const lab = SignalFieldLab.mount('#field-lab-slot', {
    target: window.soundMotionNative,
    style: 'msand',
    baseHz: 42,
    onRecipe(recipe) {
      // 可选：存进收藏、导出 JSON、或写进场景系统。
      console.log(recipe);
    }
  });
</script>
```

`mount()` 返回的控制器包含：

- `getState()` / `setState(next)`：读取或设置激振点、频率及基础频率。
- `getRecipe()`：获得一个 JSON 可序列化的 `signal-field/field-lab-recipe@1` 配方。
- `apply(target)`：对 `soundMotionNative` 兼容对象执行受限命令。
- `startScan()` / `stopScan()`：控制频率扫描。
- `destroy()`：停止定时器并移除 UI。

## 配方契约

配方的 `featureFrame` 是 `{ bands[16], energy, sharpness, flat }`，可被后续实时驱动层消费；`commands` 则保持为现有引擎已经公开的指令：

```js
[
  { type: 'call', method: 'setStyle', args: ['msand'] },
  { type: 'call', method: 'setParam', args: ['detail', 1.2] },
  { type: 'call', method: 'setParam', args: ['particles', 0.36] },
  { type: 'call', method: 'setParam', args: ['evolve', 0.48] },
  { type: 'call', method: 'applyPatternSpec', args: [/* pattern */] }
]
```

`applyVisualizerRecipe()` 只允许这三个公开的方法，避免 UI 生成任意调用。若渲染器尚未连接，仍可生成和导出配方，但不会调用任何全局对象。

## 验证

执行：

```bash
node scripts/verify-field-lab.cjs
```

测试覆盖纯函数：坐标规范化、基础/高阶模态频率、节点与腹部耦合、16 频带映射、命令配方形状和受限应用器。UI 通过浏览器手动验证：鼠标/触摸拖动、键盘移动、频率扫描、窄屏布局以及 `prefers-reduced-motion` 下的较慢扫描。
