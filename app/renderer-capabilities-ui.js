/* Signal Field — capability recommendation plus truthful active-renderer status. */
(function mountRendererCapabilityUi() {
  'use strict';
  const root = document.getElementById('rendererCapability');
  const api = window.SignalFieldRendererCapabilities;
  if (!root || !api) return;
  const summary = root.querySelector('summary');
  const detail = root.querySelector('[data-role="renderer-detail"]');
  const runtime = window.signalFieldGpuController || null;
  const labels = { webgpu: 'WebGPU Compute', webgl2: 'WebGL2 Transform Feedback', canvas: 'Canvas 2D', unsupported: '无可用后端' };
  const reasonLabels = {
    'webgpu-requires-secure-context': 'WebGPU 需要 HTTPS 或 localhost',
    'webgpu-api-unavailable': '浏览器没有开放 WebGPU',
    'webgpu-adapter-unavailable': '没有可用的 WebGPU 适配器',
    'webgpu-request-adapter-failed': 'WebGPU 适配器探测失败',
    'webgpu-canvas-context-unavailable': '无法创建 WebGPU 画布',
    'webgpu-device-lost': 'WebGPU 设备已丢失',
    'webgl2-context-unavailable': 'WebGL2 不可用',
    'webgl2-transform-feedback-unavailable': 'WebGL2 缺少 Transform Feedback',
    'canvas-locked': '此运行模式锁定 Canvas',
    'overlay-lock': '覆盖层模式锁定 Canvas',
    'parity-lock': '一致性测试锁定 Canvas',
    'alpha-lock': '透明输出锁定 Canvas',
    'deterministic-export-lock': '确定性导出锁定 Canvas',
    'native-host-lock': '原生宿主暂时锁定 Canvas',
    'user-selected-canvas': '你选择了 Canvas 模式'
  };
  let capabilitySnapshot = null;
  let runtimeSnapshot = runtime ? runtime.state() : null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function render() {
    if (!capabilitySnapshot) return;
    const next = labels[capabilitySnapshot.backend] || capabilitySnapshot.backend;
    const current = runtimeSnapshot || { actual: 'canvas', status: 'fallback', fallbackReason: 'webgpu-unavailable', particleCount: 0 };
    const enhanced = current.actual === 'canvas+webgpu' && current.status === 'ready';
    const actualLabel = enhanced ? 'Canvas 2D + WebGPU 三维模态增强' : 'Canvas 2D';
    if (enhanced) summary.textContent = `渲染 · WebGPU 三维模态 · ${Math.round(current.particleCount / 1024)}K`;
    else if (current.status === 'initializing') summary.textContent = '渲染 · Canvas 工作中 · WebGPU 初始化';
    else if (current.status === 'lost') summary.textContent = '渲染 · Canvas 已接管 · GPU 丢失';
    else summary.textContent = '渲染 · Canvas 稳定兼容';

    const capabilityReasons = capabilitySnapshot.reasons.map((reason) => reasonLabels[reason] || reason).slice(0, 3);
    const fallback = current.fallbackReason ? (reasonLabels[current.fallbackReason] || current.fallbackReason) : '';
    const architecture = enhanced
      ? `GPU 已真实提交首帧；Canvas 保留原四种主视觉，WebGPU 叠加双模态三维节点粒子${current.modePair ? `（${current.modePair}）` : ''}。`
      : 'Canvas 继续承担完整主视觉、音频/数据响应与确定性导出。';
    let action = '';
    if (runtime) {
      if (enhanced || current.status === 'initializing') action = '<button type="button" data-action="renderer-disable">关闭 GPU 增强</button>';
      else if (capabilitySnapshot.backends.webgpu.available) action = '<button type="button" data-action="renderer-enable">启用 / 重试 WebGPU</button>';
    }
    detail.innerHTML = `<b>当前实际后端：${escapeHtml(actualLabel)}</b><span>能力建议：${escapeHtml(next)} · ${escapeHtml(capabilitySnapshot.quality.tier)} · 目标 ${capabilitySnapshot.quality.targetFps} FPS</span><span>${escapeHtml(architecture)}</span>${fallback ? `<span>当前说明：${escapeHtml(fallback)}</span>` : ''}${capabilityReasons.length ? `<span>能力说明：${capabilityReasons.map(escapeHtml).join('；')}</span>` : ''}${action}`;
    root.dataset.recommendedBackend = capabilitySnapshot.backend;
    root.dataset.actualBackend = current.actual;
  }

  const store = api.createRendererCapabilityStore(window, { preference: 'auto' });
  store.subscribe((snapshot) => { capabilitySnapshot = snapshot; render(); });
  if (runtime) runtime.subscribe((snapshot) => { runtimeSnapshot = snapshot; render(); });
  detail.addEventListener('click', (event) => {
    const action = event.target && event.target.dataset && event.target.dataset.action;
    if (!runtime || !action) return;
    if (action === 'renderer-disable') runtime.disable();
    if (action === 'renderer-enable') runtime.enable();
  });
  store.refresh().catch((error) => {
    summary.textContent = '渲染 · Canvas 稳定兼容';
    detail.innerHTML = `<b>当前实际后端：Canvas 2D</b><span>高级能力探测未完成：${escapeHtml(error && error.message || '未知错误')}</span>`;
  });
  window.rendererCapabilityController = {
    refresh: () => store.refresh(),
    state: () => ({ capability: store.getSnapshot(), runtime: runtime ? runtime.state() : null })
  };
}());
