# Signal Field 高级视觉与产品研究

**更新：** 2026-07-21
**结论：** 保留现有 3D 模态体积与四种粒子风格，把产品升级成“可解释、可编排、可复现的信号仪器”。第一阶段先补项目文件和场景时间线；薄板物理、GPU 粒子与体积渲染作为独立增强，不替换现有兼容路径。

## 1. 当前引擎的真实边界

现有主视觉计算的是三维声腔式正弦模态及其节点面，不是传统金属薄板上的二维 Chladni 节线。粒子通过场梯度、阻尼和冲击波向节点区域迁移，当前 Canvas 路径在默认配置下约绘制数万粒子。这个实现非常适合沉浸式“空间结晶”，应该继续作为默认体验。

真正的薄板 Chladni 应作为新的 **Plate Lab**：矩形板可先采用解析模态，任意轮廓后续使用有限元预计算特征模态。界面需要明确区分“教学近似”“预计算物理模态”和“艺术映射”，避免把漂亮效果误称为精确工程仿真。

## 2. 产品定位

Signal Field 不应复制 TouchDesigner、Notch 或 Resolume 的完整节点图、素材播放器、投影映射和硬件协议生态，也不应扩张为通用 BI 图表平台。更清晰的定位是：

> 将声音、时间序列与现场事件转换成可探索、可编排、可复现的空间体验。

优先用户场景：教育讲解、展陈、产品演示、个人数据回顾和小型现场表演。视觉吸引负责“第一眼”，场景配方、来源记录和可回放事件负责持续价值。

## 3. 推荐架构

### A. 双物理引擎

- **Modal Volume：** 原有 3D 模态体积，保留四种粒子风格、当前输入、收藏、导出和桌面路径。
- **Plate Lab：** 新增真实二维板模态。先提供矩形简单支撑板、4–12 个解析模态、材质/板厚/激励点/阻尼参数；任意形状采用预烘焙有限元模态库。

### B. 渐进式 GPU 后端

- 当前 Canvas 实现永远作为兼容和确定性导出后端。
- WebGPU 路径使用双粒子状态缓冲、compute shader 更新位置/速度、实例化颗粒绘制；主线程每帧只上传统一参数，不回读粒子。
- 新增 capability 检测、设备丢失处理、GPU 帧耗时与自动降级。WebGPU 不可用时自动回退，不改变现有产品行为。
- 旗舰模式再增加半分辨率 3D 场 raymarch、选择性 bloom 与透明粒子合成；它只作为新的 `crystal / mist / lab` 风格，不覆盖原来的砂粒质感。

### C. Signal / Scene / Recipe 三层模型

- **Signal Bus：** 统一音频、文件、数据、手动事件，以及后续的 WebSocket、OSC/MIDI。每个输入都携带时间戳、归一化信息与断流降级策略。
- **Scene Score：** 场景列表、时长、转场曲线、时间线、cue 与安全场景。
- **Recipe / Provenance：** 版本化 JSON 记录输入摘要、映射、阈值、相机、视觉参数、事件和应用版本，支持保存、导入、重放与比较。

## 4. 分阶段路线

### Phase 1 — 已完成

1. 场景工作室：捕获当前效果、场景增删改排、时间线预览、项目 JSON 导入/导出。
2. 项目格式做严格校验；坏文件不能覆盖当前状态。
3. 无依赖、响应式、键盘可操作；原四种风格与所有输入路径保持不变。

### Phase 2 — 进行中：性能与真实薄板

1. **已完成：** WebGPU / WebGL2 / Canvas 检测、真实运行时状态、首帧确认、用户关闭/重试、降级状态和设备丢失处理。
2. **三维增强后端已完成：** 真实 WGSL compute/render、双 storage buffer ping-pong、64K/128K 三维粒子、循环双模态、解析节点梯度、Z 激振点与现有相机桥接；Canvas 保留四种完整主视觉。
3. **形状与风格力学已完成：** GPU 已同步正多面体、不规则凸多面体和球体边界，并为四种风格分别配置激振、节点、漂移、阻尼与碰撞回弹。下一步是受控 GPU 截图基线、晶体/雾场体积风格和自动质量降级；在通过前不替换 Canvas 物理与确定性导出。
4. **Plate Lab 首版已完成：** 矩形简支薄板、材质/尺寸/激励核心、频率响应、节点图和 3D 映射；精确夹持边界、任意轮廓与预测/实测对照留给后续数值求解层。

### Phase 3 — 旗舰视觉与现场能力

1. `crystal / mist / lab` 三种 GPU 体积风格，自适应分辨率与步数。
2. 方、圆、椭圆、叶片等 6–10 种预计算薄板轮廓。
3. Scene Score 增加 cue、节拍/条件触发和 OSC/MIDI；只做轻量现场控制，不扩张成完整媒体服务器。
4. 发布可嵌入播放器与只读项目回放链接。

## 5. 验收指标

- Canvas 默认视觉与四种已有风格不发生功能性回归。
- WebGPU 路径在主流桌面设备的目标是 60 fps；根据 GPU 时间主动降级。
- 每个保存的项目都可在无原始运行状态的情况下重放，并能说明输入、映射和版本。
- Plate Lab 对节点线、边界条件、近似范围给出可读说明；不使用“精确仿真”式误导表述。
- 移动端不横向溢出；场景为空、项目损坏、GPU 不支持和输入中断均有明确状态。

## 6. 研究依据

- NumChladni 以有限元特征值问题计算任意二维形状的节点图：[Numerical Chladni figures](https://arxiv.org/abs/1308.5523)
- 薄板的支撑、夹持和边界载荷会改变频率与模态：[NASA — Effect of edge loadings on vibration of rectangular plates](https://ntrs.nasa.gov/api/citations/19650014223/downloads/19650014223.pdf)
- WebGPU 官方示例展示了 compute shader 与实例缓冲驱动的 50,000 粒子路径：[WebGPU Samples — Particles](https://webgpu.github.io/webgpu-samples/samples/particles/)
- WGSL 标准包含存储缓冲与三维纹理所需的着色语言基础：[W3C WGSL](https://www.w3.org/TR/WGSL/)
- WebGPU compute 的 storage buffer 和 dispatch 工作流：[Chrome Developers — GPU computations on the web](https://developer.chrome.com/docs/capabilities/web-apis/gpu-compute)
- TouchDesigner 将音频、控制和数学数据统一为连续通道：[TouchDesigner CHOP](https://docs.derivative.ca/CHOP)
- Flourish 的核心发布能力包括故事、滚动叙事、自动播放、循环与嵌入：[Flourish data storytelling](https://flourish.studio/product/data-storytelling/)
- Sonic Visualiser 展示了注释、特征提取、多分辨率查看和导出的研究型工作流：[Sonic Visualiser features](https://sonicvisualiser.org/features.html)
