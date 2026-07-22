# 渐进式渲染后端

渲染系统现在分成三层：`app/renderer-capabilities.js` 只负责探测和推荐；`app/webgpu-particle-backend.js` 负责真实 WebGPU device、WGSL compute/render、buffer 和帧提交；`app/webgpu-integration.js` 把 GPU 粒子作为透明增强层接到现有 Canvas 主视觉。能力层本身仍不创建 `GPUDevice`。

## 当前产品行为

- Canvas 继续完整绘制 `sand`、`msand`、`cosmic`、`dcosmic` 四种模式，音频、数据、场景、导出逻辑不变。
- 兼容的普通 Web 页面会尝试创建自适应 64K/128K WebGPU 粒子层；它使用两个 storage buffer 在 compute shader 中 ping-pong 更新三维位置/速度，并用实例化柔边颗粒叠加到主视觉。
- GPU 每帧从现有引擎读取两个稳定的主模态、正负权重、三轴激振点、row-major 旋转矩阵、缩放和相机深度。WGSL 复刻现有三项循环 `phi3`，通过 `-∇(field²)` 向三维节点面聚集。
- 正多面体和不规则多面体通过最多 32 个凸平面约束，圆形高面数模式使用球体约束；只有形状变化时才上传 528-byte shape buffer。四种风格分别控制激振、节点、漂移、阻尼和碰撞回弹。
- 只有 device、context、pipeline、buffer 和首个 `queue.submit()` 都成功后，运行时状态才是 `canvas+webgpu / ready`。
- 用户可在渲染状态面板关闭或重试 GPU。偏好保存在本机。
- WebGPU 不可用、初始化失败或 device lost 时 GPU canvas 立即透明，Canvas 从未被移除，因此不会出现黑帧。
- `nativeOverlay=1`、`parity=1`、透明输出、强制 DPR 导出和 Electron 原生宿主目前锁定 Canvas，以保护透明度和确定性基线。普通 Web 展示壳使用的 `overlay=1` 仍可启用 GPU 增强。

当前 WebGPU 已是真正的三维双模态“计算粒子增强层”，但 Canvas 仍承担完整主视觉、全部既有物理与确定性输出；不要宣传为百万粒子、完整 GPU 迁移或原生 Metal 路径。

## 目标

在同一份产品里明确区分三件事：

1. 浏览器是否具备 WebGPU、WebGL2 Transform Feedback 或 Canvas 2D 能力；
2. 当前用户偏好是否真的可满足；
3. 后端建议与实际运行时是否已提交 GPU 帧，避免把“浏览器有 API”误报成“GPU 已启用”。

## 使用

CommonJS：

```js
const RendererCapabilities = require('./app/renderer-capabilities.js');
const snapshot = await RendererCapabilities.detectRendererCapabilities({ preference: 'auto' });
```

浏览器脚本加载后使用 `window.SignalFieldRendererCapabilities`。探测结果是稳定 JSON：

```js
{
  schema: 'signal-field/renderer-capabilities',
  version: 1,
  secureContext: true,
  preference: 'auto',
  preferenceSatisfied: true,
  backend: 'webgpu', // webgpu | webgl2 | canvas | unsupported
  quality: { tier: 'ultra', particleBudget: 1000000, resolutionScale: 1, targetFps: 60 },
  reasons: [],
  backends: { webgpu: {}, webgl2: {}, canvas: {} }
}
```

WebGPU 探测只调用 `navigator.gpu.requestAdapter()`，并读取 adapter 的 `features` 与关键 `limits`。`requestAdapter()` 返回 `null`、抛出异常或计算存储/工作组限制不足时，`webgpu.available` 会明确为 `false` 并记录原因。它绝不会在本模块中调用 `requestDevice()`。

WebGL2 只有在真实获取到 `webgl2` context 且具备 Transform Feedback API 时才可作为粒子后端；否则会降至 Canvas 2D。Canvas 2D 也不可用时，推荐值是 `unsupported`。

## 偏好与降级

`preference` 支持 `auto`、`webgpu`、`webgl2`、`canvas`。指定的后端不可用时，模块会选择下一个可行后端，但保留原偏好、将 `preferenceSatisfied` 标为 `false`，并加入例如 `preferred-backend-unavailable:webgpu` 的原因。UI 不应把这种状态显示为“WebGPU 已启用”。

## 能力订阅和设备丢失

```js
const store = RendererCapabilities.createRendererCapabilityStore(window, { preference: 'auto' });
const unsubscribe = store.subscribe((snapshot) => renderBackendStatus(snapshot));
await store.refresh();

// 其他宿主创建 device 后，可把现有 device 交给 store 观察；store 本身不创建它。
store.observeDeviceLoss(device);
```

`reportDeviceLost(reason)` 可让宿主主动登记 WebGPU device loss；store 会重新探测并降级。`clearDeviceLost()` 用于设备恢复后重新尝试。`subscribe()` 返回取消订阅函数，适合 Web 设置页或 Electron 控制器。

## 验证

```bash
node scripts/verify-renderer-capabilities.cjs
node scripts/verify-webgpu-particle-backend.cjs
npm run verify:pages
```

测试覆盖能力推荐、非安全上下文、adapter 返回 `null`/抛异常、limits 过低、偏好降级、真实 compute/render pipeline、三维初态、循环模态/解析梯度、双模态权重、160-byte uniform 对齐、相机矩阵、双缓冲绑定次序、64K/128K 档、首帧激活、resize、device loss、资源销毁、无 GPU mock，以及 Pages 中实际 WebGPU/Canvas 状态和 `parity=1` Canvas 锁。
