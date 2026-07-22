> **修改声明：** 本文档由 Signal Field 贡献者修改；详见 `LICENSE`、`UPSTREAM_NOTICE.md` 与 `MODIFICATIONS.md`。

<p align="center">
  <a href="https://oliveryfaso.github.io/Signal_Chladni_Field/"><strong>打开 Signal Field 在线演示</strong></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

<p align="center">
  <strong>本地优先的音乐视觉短片自动创作工具</strong>
</p>

<p align="center"><sub>签名和公证状态以具体发行版本为准；开发构建不可视为已公证版本。</sub></p>

# Signal Field

Signal Field 把一首本地音乐自动编排成可编辑的 3D 粒子短片时间线。选择模板、画幅和时长后，它会在本机分析音乐、生成场景序列，并让画面与原始音频同步预览。粒子不是贴图或预录动画，而是在模态共振、惯性迁移和三维投影中持续形成新的节面结构。

这个仓库目前包含可直接部署的 Web Demo，以及可从源码构建的 Mac 音乐可视化应用和 Mac 屏幕保护程序 / 锁屏动画。Windows 版作为社区方向，正在招募开发者贡献。

[English](README.md) · [完整桌面说明](README.txt) · [产品与发布指南](docs/PROJECT_GUIDE.md)

## 应用组成

| 应用 | 状态 | 说明 |
| --- | --- | --- |
| Web 创作器 | [在线使用](https://oliveryfaso.github.io/Signal_Chladni_Field/) | 上传本地音乐、自动生成编排、随音乐预览并导出可编辑项目 |
| Mac 音乐可视化应用 | 可从源码构建 | Electron 桌面应用，用户授权后跟随系统音频，支持透明浮层和全屏；不宣称已有公证安装包 |
| Mac 屏保 / 锁屏动画 | 可从源码构建 | 原生 Metal 实现，可在本机完成构建和安装 |
| Windows 音乐可视化应用 | 招募贡献者 | 已有跨平台 Electron 与打包基础，尚需完成 Windows 适配、设备测试和正式发布 |

> [!WARNING]
> **能耗提示：** Web Demo 和 Mac 音乐可视化应用会持续进行高密度粒子计算与实时渲染，耗电非常快，不建议在笔记本仅使用电池供电时运行。macOS 屏幕保护程序使用独立的原生 Metal 渲染路径，已经做过计算量和能耗优化。

## 四种视觉模式

| 模式 | 输入 | 默认细节 | 视觉行为 |
| --- | --- | --- | --- |
| 动态声沙 | 程序生成演示信号 / 用户音频 / 系统音频 | `1.5×` | 频谱驱动的惯性声沙迁移 |
| 模态声沙 | 无需音频 | `1.0×` | 稳定的克拉尼节面雕塑 |
| 宇宙网 | 无需音频 | `1.0×` | 三维粒子网络、进动与扫光 |
| 动态宇宙网 | 程序生成演示信号 / 用户音频 / 系统音频 | `1.5×` | 信号驱动的模态混合与空间形变 |

四种模式分别记住当前会话中的细节调整值。默认粒子密度为 `15%`。动态模式带低频模态保护，低频占主导时仍保留可见的结构细节。

## 制作一条音乐视觉短片

1. 打开 Web 创作器并选择本地音频；浏览器不会上传音乐。
2. 选择“星云轨道”“脉冲切片”或“声沙叙事”，再选择 `16:9`、`9:16` 或 `1:1` 画幅和整首/短时长。
3. 点击“分析并生成”。Signal Field 会估计音乐强弱、频谱明暗、变化强度、速度与段落，并生成经过校验的场景时间线。
4. 展开“成片精修”，选择极简、电影、动感或无标题开场；可粘贴/导入带时间戳的 LRC 歌词，并选择舒缓、均衡或强烈节拍切换。
5. 随原始音乐预览。预览与最终导出使用同一个字幕/节拍合成器。网页下载经过校验的创作方案；桌面 Creator 可选择“一键渲染视频”，通过原生保存窗口加入本机队列。

桌面 Creator 提供一键路径；等价命令也可以直接读取创作方案：

```bash
npm run export:video -- --production signal-field-production.json --audio song.mp3 \
  --aspect 9:16 --output signal-field-video.mp4
```

队列会显示等待、逐帧进度、完成、失败和取消状态。`.mp4` 默认生成 H.264，输出名为 `.mov` 时默认生成 ProRes。网页版导出创作方案而不是伪装成视频，音频也不会打包进 JSON。确定性视频导出使用完整 Canvas 渲染器，不包含额外叠加的 WebGPU 增强层。

## Web 创作器与高级工作台

仓库根目录的 `index.html` 就是发布入口。它复用 `app/index.html` 的真实视觉内核，不维护第二套粒子实现。

**[打开在线 Web Demo](https://oliveryfaso.github.io/Signal_Chladni_Field/)**

- 首屏创作区完成本地上传、三种编排模板、三种输出画幅、自动时间线、音频同步预览和可编辑项目导出。
- 成片精修支持四种开场标题、带时间戳的 LRC 字幕和三档节拍切换；预览与编码视频共用同一个 Canvas 合成器。
- 下方完整可视化器支持中文 / English 即时切换，并记住用户选择。
- 支持随机图案、全屏、暂停旋转和拖拽观察。
- 高级面板提供进动 / 单轴 / 翻滚、转速、缩放、细节、粒子、打光和立体形状控制。
- 薄板共振实验用真实矩形薄板解析模态展示节点、理论频率和激振耦合，并把结果映射到原有 3D 粒子场；映射不会切换正在使用的音频或数据源。
- 场景工作室可捕获、覆盖、重命名、排序和删除完整效果，并在时间线上平滑预览；项目以经过版本校验的 JSON 导入/导出并保存在本机。
- 支持真实 WebGPU Compute 三维共振粒子增强：64K/128K 粒子使用双模态节点梯度、三轴激振点、现有相机，并同步球体、正多面体和不规则凸多面体边界；四种风格分别配置激振、节点、漂移、阻尼和碰撞回弹。首帧成功后才显示“已启用”，失败时始终保留完整 Canvas 主视觉。
- 全屏会隐藏标题、底栏和设置；`Esc` 退出。
- 移动端底栏自动换行，不产生横向溢出。

发布截图和视频必须从当前 Signal Field 构建重新捕获。继承的 `media/` 目录已移除，不属于 Signal Field。

## 本地运行

macOS 可双击 `start.command`，或在仓库根目录运行：

```bash
python3 -m http.server 8777
```

打开 [http://localhost:8777/](http://localhost:8777/)。请使用 HTTP 服务，不要直接用 `file://` 打开；浏览器对本地音频初始化和 AudioContext 有额外限制。

## GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。推送到 `main` 后，在仓库 **Settings → Pages → Source** 中选择 **GitHub Actions**，工作流会：

1. 检查 JavaScript 和发布脚本语法。
2. 打包 Web 壳层（`index.html`、`app/` 和兼容入口 `website/`）及许可证、声明文件。
3. 将静态 artifact 发布到仓库对应的 `github.io` 地址。

相对路径已经适配项目型 Pages 地址，例如 `https://owner.github.io/repository/`。旧的 `/website/` 链接会保留查询参数和锚点并跳转到新首页。

手动构建与验证：

```bash
npm run build:pages
npm run verify:pages
```

## 应用能力边界

| 能力 | Web 创作器 | Mac 音乐可视化 | Mac 屏保 / 锁屏动画 |
| --- | --- | --- | --- |
| 动态声沙 / 动态宇宙网 | 支持 | 支持 | 不启用音频分析 |
| 模态声沙 / 宇宙网 | 支持 | 支持 | 支持 |
| 程序生成演示信号 | 支持 | 支持 | 不需要音频 |
| 用户音频文件 / 麦克风 | 浏览器内支持 | 支持 | 不支持 |
| 自动音乐编排 / 可编辑项目 | 本地音频文件支持 | 可通过桌面 CLI 渲染 Web 项目 | 不支持 |
| H.264 / ProRes 视频 | 先导出项目，再用桌面 CLI | 确定性 CLI 支持 | 不支持 |
| 系统音频 | 浏览器不提供通用接口 | 用户主动授权后支持 | 不支持 |
| 透明浮层与 menu bar | 不支持 | 支持 | 不适用 |
| WebGPU Compute 粒子增强 | 兼容浏览器支持，自动回退 | 暂锁定 Canvas | 不适用 |
| 原生优化渲染 | 不支持 | 不支持 | 支持 |

网页和桌面可视化器使用程序生成、不可听见的演示信号来预览动态模式，不再打包第三方音乐。Mac 屏保使用独立的原生 Metal 渲染路径，不启动 Electron、WebKit 或音频分析。

## Mac 音乐可视化应用

```bash
npm install
npm start
```

macOS 打包命令：

```bash
npm run package:mac
```

macOS 屏保和锁屏启动器的构建、安装及系统限制见 [README.txt](README.txt)。

## Windows 开发者招募

Windows 音乐可视化应用目前不作为已完成发布物。仓库已经具备 Electron 视觉内核、Windows 打包配置和系统音频接入基础，欢迎开发者通过 Issue / Pull Request 推进：

- Windows 10 / 11 与不同声卡、蓝牙设备下的 loopback 音频兼容性。
- 透明浮层、全屏、多显示器和不同 DPI 缩放组合的稳定性。
- 安装器、代码签名、自动更新和发布流程。
- GPU / CPU / 电池能耗测试，以及和 Mac / Web 视觉结果的对齐。

开发构建入口为 `npm run package:win`。在完成设备矩阵验证前，README 不将 Windows 版标记为正式支持。

## 架构

```text
index.html                  GitHub Pages / 本地 Web 展示壳
app/index.html              粒子物理、音频分析、Canvas 渲染真源
app/music-director.js       本地音乐特征分析与确定性自动编排计划
app/production-spec.js      项目、标题、LRC、节拍和输出的严格创作方案
app/production-overlay.js   预览/导出共用的标题、歌词、强调和停顿合成器
app/plate-lab-core.js       薄板模态、频响、网格采样和安全映射核心
app/plate-lab-ui.js         触控/键盘薄板实验与节点图
app/scene-studio.js         场景、项目、关键帧与安全配方核心
app/scene-studio-ui.js      场景工作室、时间线和本地项目交互
app/renderer-capabilities.js 渲染能力、降级与设备丢失状态
app/webgpu-particle-backend.js WGSL Compute/Render、双缓冲和 64K/128K 粒子后端
app/webgpu-integration.js    Canvas 主视觉与 WebGPU 增强层的运行时接入
scripts/verify-webgpu-integration.cjs 形状/力学桥接集成验证
scripts/export-video.cjs    项目、音频和画幅驱动的 H.264 / ProRes 确定性导出
desktop/render-queue.cjs    本机串行渲染任务、进度、取消和失败状态
desktop/                    Electron 主进程、控制面板和系统音频桥
macos-screensaver/          原生 Metal 屏保
scripts/build-pages.sh      最小静态发布 artifact
scripts/verify-pages.cjs    Pages 路径、双语、默认值与音频验证
```

渲染器最多提交 `60 FPS`，隐藏页面时暂停视觉循环；粒子密度与 DPR 会按画布尺寸调整，质量降级优先关闭高成本后处理，而不是改变图案结构。

## 校验

```bash
npm run check
npm run smoke
npm run verify:web-audio
npm run verify:pages
npm run verify:scene-studio
npm run verify:music-director
npm run verify:production-spec
npm run verify:production-overlay
npm run verify:render-queue
npm run verify:video-export-options
npm run verify:video-export-smoke
npm run verify:plate-lab
npm run verify:renderer-capabilities
npm run verify:webgpu
npm run verify:webgpu-integration
npm run verify:mac-parity
```

发布素材可重新生成：

```bash
npm run capture:release-media
npm run export:video -- --production signal-field-production.json --audio song.mp3 \
  --aspect 9:16 --output exports/signal-field-music-video.mp4

# 也可以不使用场景项目，手动指定单个视觉：
npm run export:video -- --output exports/signal-field-cosmic-demo.mp4 \
  --style cosmic --width 1280 --height 720 --fps 30 --seconds 6 \
  --codec h264 --rotation precess --rotation-speed 1 --seed 20260711
```

## 许可证

本仓库采用分范围授权，Apache-2.0 不覆盖已从 Signal Field 发布产品移除的继承媒体：

| 范围 | 协议 |
| --- | --- |
| 源代码、构建脚本、配置与项目文档 | [Apache License 2.0](LICENSE)，且必须保留 [UPSTREAM_NOTICE.md](UPSTREAM_NOTICE.md) 与 [MODIFICATIONS.md](MODIFICATIONS.md) 中的声明 |
| 历史继承的截图、GIF、MP4、宣传素材和独立粒子预设 | [CC BY-NC 4.0](ASSET_LICENSE.md)，已从 Signal Field 发布产品移除 |
| 历史第三方音乐声明 | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，Signal Field 不分发或播放第三方音乐 |
| Signal Field 图标源文件和生成的应用图标 | 本项目原创资产，随仓库按 Apache-2.0 提供 |

Signal Field 的网页演示使用程序生成信号，而非内置音乐。Apache-2.0 的声明义务和继承媒体排除项是发布前提，不是可选的清理工作。代码贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 发布检查

公开仓库前请完成 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)，尤其要确认保留代码声明，并从当前构建重新捕获 Signal Field 宣传素材。
