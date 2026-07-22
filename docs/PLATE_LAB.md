# Plate Lab 薄板物理核心

`app/plate-lab-core.js` 是 Signal Field 的无依赖薄板计算内核。它只进行确定性的本地数值计算：没有 DOM、网络、存储、计时器，也不会执行 `soundMotionNative` 命令。

它可以直接在浏览器中以 UMD 全局使用，也可以由 CommonJS 引用：

```html
<script src="plate-lab-core.js"></script>
<script>
  const lab = window.PlateLabCore.createPlateLab({ material: 'steel' });
</script>
```

```js
const PlateLabCore = require('./app/plate-lab-core.js');
```

## 模型边界

所有尺寸均使用 SI 单位：长度为米、厚度为米、密度为 `kg/m³`、杨氏模量为 Pa、频率为 Hz。激振点和观察点使用板面归一化坐标 `{ x, y }`，其中两个坐标均在 `0..1`。

核心采用 Kirchhoff–Love 薄板近似：

```text
D ∇⁴w + ρh ∂²w/∂t² = f
D = E h³ / (12(1 - ν²))
```

这里 `D` 是抗弯刚度，`w` 是横向位移。只适用于厚度远小于板面跨度的情况；模块会拒绝厚度超过最小跨度 10% 的输入，实际使用时建议保持在 5% 或更低。

### `simply-supported`

这是矩形薄板的解析分离变量解：

```text
φmn(x,y) = sin(mπx/a) sin(nπy/b)
ωmn = √(D/(ρh)) · [(mπ/a)² + (nπ/b)²]
```

因此它是本模块中可直接解释为矩形简支 Kirchhoff–Love 模态的分支。激振点耦合为 `φmn(xe, ye)`；激振点落在节点线上时，该模态耦合为零。

### `clamped-approx`

这是一个明确标为**近似**的视觉/交互分支。它将两条 clamped-clamped Euler–Bernoulli 梁的模态相乘，并用对应波数估计频率：

```text
φmn(x,y) ≈ beam_m(x) · beam_n(y)
ωmn ≈ √(D/(ρh)) · (kx² + ky²)
```

它会满足边缘位移为零，并比简支板更“硬”，但不是精确的二维夹持板特征值解。请在产品 UI 中将它显示为“夹持边（近似）”，不要用它报告工程级绝对频率。任意轮廓、开孔、加强筋或需要工程精度的夹持边，应该使用 FEM/Ritz 特征值求解器。

## 材料预设

预设是常温下的名义值，适合视觉和交互实验，不代替材料数据表：

|预设|密度 kg/m³|杨氏模量 Pa|泊松比|
|---|---:|---:|---:|
|`steel`|7850|200e9|0.29|
|`aluminum`|2700|69e9|0.33|
|`glass`|2500|70e9|0.22|
|`acrylic`|1180|3.2e9|0.35|

自定义材料必须显式声明所有材料参数：

```js
const lab = PlateLabCore.createPlateLab({
  material: 'custom',
  width: 0.42,
  height: 0.30,
  thickness: 0.0012,
  density: 1450,
  youngModulus: 8.5e9,
  poissonRatio: 0.31,
  dampingRatio: 0.018,
  excitationPoint: { x: 0.38, y: 0.61 },
  boundary: 'simply-supported',
  modeCount: 16
});
```

预设材料不接受单独覆写 `density`、`youngModulus` 或 `poissonRatio`；要改参数请切换到 `custom`。这是为了防止“预设名称”和实际参数不一致。

## API

### `normalizeConfig(input)`

严格验证并返回不可变配置。支持：

- `material`：`steel`、`aluminum`、`glass`、`acrylic`、`custom`；
- `boundary`：`simply-supported` 或 `clamped-approx`；
- `width`、`height`、`thickness`；
- 自定义材料的 `density`、`youngModulus`、`poissonRatio`；
- `dampingRatio`：`0..0.3`；
- `excitationPoint: {x, y}`；
- `modeCount`：`1..24`。

未知字段、字符串数字、无穷值、错误边界或超出薄板适用范围的几何会抛出异常。函数不会修改传入对象。

### `createPlateLab(config)`

建立完整的不可变计算结果：

```js
const lab = PlateLabCore.createPlateLab({
  material: 'aluminum', width: 0.3, height: 0.3, thickness: 0.001
});

lab.mechanics.flexuralRigidity; // D, N·m
lab.mechanics.massPerArea;      // ρh, kg/m²
lab.modes[0];                   // (m,n)、频率、耦合、modal mass、阻尼
```

`modes` 按频率升序排列。每一项包含 `frequencyHz`、`angularFrequency`、`coupling`、`couplingMagnitude` 和 `modalMass`。

### `resolveMode(lab, selector)` 与 `modeShape(lab, selector, point)`

`selector` 可以是 modes 的零基数组索引，或 `{m, n}`：

```js
const mode21 = PlateLabCore.resolveMode(lab, { m: 2, n: 1 });
const displacement = PlateLabCore.modeShape(lab, mode21.index, { x: 0.5, y: 0.5 });
```

返回的形状是峰值约为 `±1` 的有符号归一化位移。它不是某一时刻的真实振幅；真实时间行为由模态响应决定。

### `frequencyResponse(lab, frequencyHz, options)`

计算线性受迫模态叠加的复柔度：

```text
H(ω) = Σ φi(xobs) φi(xexc) /
       [Mi(ωi² - ω² + 2iζiωiω)]
```

```js
const response = PlateLabCore.frequencyResponse(lab, 128, {
  observationPoint: { x: 0.5, y: 0.5 },
  forceNewtons: 1,
  modeCount: 12
});

response.magnitude;     // 线性柔度近似，m/N
response.phaseRadians;
response.dominantMode;
```

`sampleFrequencyResponse(lab, { fromHz, toHz, steps, ...options })` 可以生成频率扫描。阻尼越小，共振峰越尖；真实装夹、空气、驱动器和颗粒会造成额外损耗，因而不应把它作为实验校准的唯一来源。

### `sampleModeGrid(lab, selector, options)`

生成可直接上传给渲染器的二维网格：

```js
const grid = PlateLabCore.sampleModeGrid(lab, { m: 2, n: 1 }, {
  columns: 128,
  rows: 96,
  nodeWidth: 0.075
});

grid.values;         // Float32Array，有符号位移
grid.nodeIntensity;  // Float32Array，节点处接近 1，远离节点递减
```

`nodeIntensity` 是由 `abs(w)` 生成的平滑可视化带，不是沙粒密度、颗粒接触或摩擦的数值解。

### `createSoundMotionNativeRecipe(lab, options)`

创建**声明式、受白名单限制且不执行**的视觉映射。可选项为 `mode`、`style`、`nodeWidth`。

```js
const recipe = PlateLabCore.createSoundMotionNativeRecipe(lab, {
  mode: { m: 1, n: 1 },
  style: 'msand'
});

recipe.allowedMethods;
// ['setStyle', 'setSampleMode', 'setRotationMode', 'setParam', 'applyPatternSpec']
```

调用方如决定应用它，必须逐条检查 `allowedMethods` 后再显式调用 native 接口。配方只把薄板模态映射为现有三维视觉器的样式、细节、旋转和 pattern 参数；不会也不能模拟粒粒碰撞、静摩擦、空气耦合或真实沙子堆积。

## 验证

无需新增依赖：

```bash
node --check app/plate-lab-core.js
node --check scripts/verify-plate-lab.cjs
node scripts/verify-plate-lab.cjs
```

测试覆盖简支板 `(1,1)` 的频率数量级、厚度和尺寸标度、节点耦合、受迫共振峰、夹持近似、确定性配方、错误输入隔离，以及 CommonJS 与浏览器 UMD 暴露。

## 参考

- [NASA：矩形板在简支、夹持和弹性约束边界下的振动](https://ntrs.nasa.gov/api/citations/19650014223/downloads/19650014223.pdf)
- [NumChladni：以有限元计算任意形状振动膜的特征模态与节点图样](https://arxiv.org/abs/1308.5523)
- [Chladni 板实验与有限元/测量频率的开放研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC6812332/)
