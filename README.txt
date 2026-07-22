Signal Field（本地离线服务）

修改声明：本文档由 Signal Field 贡献者修改；详见 LICENSE、UPSTREAM_NOTICE.md 与 MODIFICATIONS.md。

双击 start.command:它在本机启动本地服务 (http://localhost:8777) 并打开 Web 展示页。
关闭终端窗口即停止。全程离线,不连任何网络。

为什么用本地服务而不是直接双击 HTML:浏览器在 file:// 下对 AudioWorklet/音频初始化有限制,
会出现"有时没声音/要切视图才出声"。用 http://localhost 打开可彻底解决。
- 网页端的演示信号完全由程序生成，不播放或打包第三方音乐；Electron 仍使用用户主动接入的系统音频。
- 动态声沙和动态宇宙网的细节默认值为 1.5;模态声沙和宇宙网的细节默认值为 1.0。四种模式分别记住用户在当前会话中的调整值。

能耗提示:
- Web Demo 和 Mac 音乐可视化应用会持续进行高密度粒子计算与实时渲染,耗电非常快,不建议在笔记本仅使用电池供电时运行。
- macOS 屏幕保护程序使用独立的原生 Metal 渲染路径,已经做过计算量和能耗优化。

手动启动:在仓库根目录运行 python3 -m http.server 8777,浏览器打开 http://localhost:8777/

桌面应用(macOS 已验证;Windows 为开发者贡献方向):
npm install
npm start

桌面结构:
- desktop/main.cjs: Electron 主进程,创建控制窗口、透明可视化窗口、原生菜单和 macOS/Windows menu bar 状态入口。
- desktop/assets/: macOS Dock / app bundle 图标。
- desktop/controller.html: 应用主体控制面板,迁移 Web 端视觉/窗口/3D 参数。
- app/index.html: 原 Web 可视化核心,Electron overlay 直接复用它,粒子渲染逻辑不分叉。

macOS 锁屏动画(系统屏保):
- `npm run build:screensaver:mac` 生成 universal `build/mac-screensaver/product/Signal Field.saver`。
- `npm run install:screensaver:mac` 安装到 `~/Library/Screen Savers/Signal Field.saver` 并打开系统“墙纸 > 屏幕保护程序”设置；选择 Signal Field。
- 屏保的“选项”面板可切换静态声沙/宇宙网、进动/绕轴/翻滚、0–4 倍转速、随机图形以及 30/60 FPS。默认转速 1、帧率 30 FPS,低电量或较高热状态会自动限制到 30 FPS。
- 静态声沙和宇宙网的扩展图形池由 `app/index.html` 按不同随机模态目标生成;宇宙网沿用 Web 的粒子分布、颜色、节点亮度和星点规则。锁屏运行时只把当前图形载入紧凑 Metal buffer,不启动 Electron、WebKit、音频分析或常驻菜单栏进程。
- macOS 按显示器创建 `ScreenSaverView`,按原生 backing pixel 尺寸输出;系统停止屏保时立即停止提交 Metal 帧。开启“减少动态效果”后只绘制一帧。
- `npm run install:lock:mac` 安装 `/Applications/Signal Field Lock.app`；点击它会打开带实时预览的设置窗口，可随机图形和调节转速，再点“开始锁屏”启动粒子屏保并退出。Electron 可视化应用使用 `/Applications/Signal Field.app`，两者不会互相覆盖。原生设置窗口跟随 macOS 的中文/英文系统语言。
- `Control-Command-Q` 打开的密码认证界面仍由 macOS 管理并显示系统墙纸，第三方 `.saver` 不能替换该背景。要主动显示粒子并锁定，使用 Signal Field Lock、屏保热角或 `npm run lock:mac`。

系统音频:
- 应用首次运行时会提示接入系统音频;接入成功后,控制面板不再显示音频控制。
- 应用启动不会自动录制/跟随系统音频;需要用户从控制面板、menu bar 或可视化粒子区域右键菜单手动选择 `跟随系统音频`。
- Electron 通过 getDisplayMedia/desktopCapturer 捕获系统输出。
- 系统音频帧泵使用后台不节流 timer,全屏时仍持续给可视化发送音频帧。
- Windows x64 预留 loopback 音频路径,尚需设备兼容、显示缩放、安装器和能耗验证后才能作为正式版本发布。
- macOS 需要允许屏幕/音频捕获权限;打包配置已写入 NSAudioCaptureUsageDescription、NSScreenCaptureDescription、NSMicrophoneUsageDescription。
- 如果系统没有返回音频轨道,首次接入提示会显示"系统音频 · 未获得音频轨道"。

桌面窗口:
- 系统 menu bar 右上角会出现可见文字状态项 `SM Beat` / `SM 2s`，点击后第一层就有 Sampling；应用顶部菜单栏也有独立的 Sampling 菜单。
- 在可视化粒子区域右键会弹出和 menu bar 相同的菜单,前两项是 `跟随系统音频` / `取消跟随系统音频`。
- overlay 默认透明、圆形、240px、显示在右上角,用户可直接拖动调整位置;3D 自转默认使用绕轴模式、转速 1、打光为旋转扫光。方形 overlay 已移除。粒子初始 15%(用户可自行调整)。
- 控制面板和应用菜单都可切换 overlay 尺寸、置顶、风格(动态声沙/动态宇宙网/模态声沙/宇宙网),并可设置定时采样的 pattern 刷新秒数;overlay 固定为圆形。工具栏🎲按钮随机换一个静态图形(无需音乐)。
- overlay 是透明无边框窗口,直接显示 app/index.html 的 3D 粒子画面。
- 3D 默认缩放为 3.0;按住左 Command 再拖动粒子区域才会手动旋转。模态声沙/宇宙网为静态展示引擎:pattern 每 4 小节(最短 3 秒)更换,亮度按 log dB 响度映射,小音量也保持可见。
- Dock / 应用图标使用 Signal Field 原创信号场图标；透明切换只切换渲染背景，不会重载可视化页面或停止跟随音乐。
- 缩放输入会合并到 requestAnimationFrame 后重绘;全屏/大画布下自动提高 DPR、粒子密度并加强锐化与拖尾清除,保证清晰度。
- 高刷屏最多提交 60 FPS 的 Canvas 画面,粒子物理仍按原生 requestAnimationFrame 更新;Web 标签页或 Electron 可视化窗口不可见时暂停视觉循环,重新显示后自动续上。系统音频帧泵不受影响。

校验:
npm run check
npm run smoke
npm run verify:web-audio
npm run smoke:screensaver:mac
npm run verify:mac-parity

高清视频导出:
- 导出器按目标尺寸原生渲染,固定 dpr=1;4K 输出的 Canvas 就是 3840x2160,不会先渲染 8K 再缩回 4K。
- ProRes 母版使用完整 4:4:4 色度采样,保留暗部和微小彩色粒子细节;加 --alpha 时同时保留透明通道。
- H.264 Web 版使用 CRF 10、slow 和 grain tuning,保持 yuv420p 以兼容浏览器播放。

4K 120fps ProRes 母版:
npm run export:video -- --output exports/cosmic-master-4k120.mov --style cosmic --width 3840 --height 2160 --fps 120 --seconds 10 --codec prores

4K 120fps H.264 Web 版:
npm run export:video -- --output exports/cosmic-web-4k120.mp4 --style cosmic --width 3840 --height 2160 --fps 120 --seconds 10 --codec h264

透明 ProRes 4444:
npm run export:video -- --output exports/cosmic-alpha-4k.mov --style cosmic --width 3840 --height 2160 --fps 60 --seconds 10 --codec prores --alpha

其他参数:
- --pattern <json>:载入兼容的图形 JSON 文件。
- --seed <整数>:固定粒子随机种子,同一参数可重复得到同一画面。
- --rotation single|tumble|precess、--rotation-speed <数值>、--no-rotation:控制导出镜头。
- npm run export:video -- --help:查看完整参数。

打包:
ELECTRON_GET_USE_PROXY=true CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
ELECTRON_GET_USE_PROXY=true npm run package:win

说明:
- 源代码、构建脚本、配置和项目文档使用 Apache-2.0；`LICENSE`、`UPSTREAM_NOTICE.md`、`MODIFICATIONS.md`、`ASSET_LICENSE.md` 和 `THIRD_PARTY_NOTICES.md` 会随桌面发行物提供。
- 历史继承的 Web 宣传媒体和独立粒子预设已从 Signal Field 发布产品移除；相关声明仍保留在 `ASSET_LICENSE.md`。`THIRD_PARTY_NOTICES.md` 是历史第三方音乐声明，当前产品不分发或播放该音频。
- package:mac 生成 `dist/mac-arm64/Signal Field.app`。
- package:win 生成 `dist/win-unpacked/Signal Field.exe`。
- verify:mac-parity 会在 Mac 上加载 Web 版和 Electron overlay,用相同 seed 和参数组合截图,并把报告/截图写入 .cache/visual-parity/。
- 如果不走本机代理,可以去掉 ELECTRON_GET_USE_PROXY=true。
- 正式发布 dmg/exe 时使用 npm run dist:mac 或 npm run dist:win,并按目标平台配置签名。
