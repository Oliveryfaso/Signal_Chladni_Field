/* Signal Field — focused browser UI for the physical thin-plate core. */
(function attachPlateLabUi(globalScope) {
  'use strict';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function replace(character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value)));
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById('signal-field-plate-lab-styles')) return;
    const style = documentRef.createElement('style');
    style.id = 'signal-field-plate-lab-styles';
    style.textContent = [
      '.spl-lab{--spl-line:rgba(255,255,255,.13);--spl-muted:#a8afc0;--spl-amber:#f4b23c;--spl-blue:#83a2ff;color:#eef1f7;background:linear-gradient(145deg,rgba(244,178,60,.05),rgba(131,162,255,.055));border:1px solid var(--spl-line);border-radius:18px;padding:clamp(16px,3vw,24px);box-shadow:0 22px 50px -34px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.05)}',
      '.spl-lab *{box-sizing:border-box}.spl-lab>header{display:block;border:0;padding:0;margin:0}.spl-eyebrow{margin:0 0 5px;color:var(--spl-amber);font:700 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em}.spl-lab h2{margin:0;font-size:clamp(19px,2.6vw,25px);line-height:1.2}.spl-intro,.spl-explain,.spl-note,.spl-live{margin:8px 0 0;color:var(--spl-muted);font-size:12.5px;line-height:1.55}.spl-grid{display:grid;grid-template-columns:minmax(0,1.16fr) minmax(270px,.84fr);gap:clamp(18px,3vw,30px);align-items:start;margin-top:18px}',
      '.spl-plate{display:block;position:relative;width:100%;aspect-ratio:1.3125/1;min-height:220px;padding:0;overflow:hidden;background:#060912;border:1px solid var(--spl-line);border-radius:14px;color:inherit;cursor:crosshair;touch-action:none}.spl-plate:hover{border-color:rgba(244,178,60,.72)}.spl-plate:focus-visible,.spl-lab button:focus-visible,.spl-lab input:focus-visible,.spl-lab summary:focus-visible{outline:2px solid var(--spl-blue);outline-offset:3px}.spl-plate svg{display:block;width:100%;height:100%}.spl-exciter{position:absolute;width:13px;height:13px;border-radius:50%;background:var(--spl-amber);border:2px solid #080a0f;box-shadow:0 0 0 6px rgba(244,178,60,.2),0 0 22px rgba(244,178,60,.65);transform:translate(-50%,-50%);pointer-events:none}.spl-exciter:before,.spl-exciter:after{content:"";position:absolute;background:rgba(244,178,60,.55);left:50%;top:50%;transform:translate(-50%,-50%)}.spl-exciter:before{width:29px;height:1px}.spl-exciter:after{width:1px;height:29px}',
      '.spl-overlay{position:absolute;inset:10px 10px auto;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none}.spl-chip,.spl-model-chip{border:1px solid rgba(255,255,255,.13);border-radius:999px;background:rgba(6,8,13,.68);backdrop-filter:blur(10px);padding:4px 8px;color:#eef1f7;font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}.spl-chip strong{color:var(--spl-amber)}.spl-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;color:var(--spl-muted);font-size:11.5px}.spl-legend b{color:#eef1f7;font-weight:600}.spl-legend i{display:inline-block;width:9px;height:9px;margin-right:5px;border-radius:99px;background:var(--spl-amber)}.spl-legend i.node{height:2px;border-radius:0;background:#eef1f7;vertical-align:middle}',
      '.spl-controls{display:grid;gap:13px}.spl-model-chip{justify-self:start;color:var(--spl-muted);background:rgba(6,8,13,.35)}.spl-readout{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.spl-stat{border:1px solid var(--spl-line);border-radius:10px;padding:9px;background:rgba(5,7,11,.42)}.spl-stat span{display:block;color:var(--spl-muted);font-size:10.5px}.spl-stat b{display:block;margin-top:3px;color:#eef1f7;font:700 12px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.spl-stat b.hot{color:var(--spl-amber)}.spl-control{display:grid;gap:6px}.spl-labelrow{display:flex;justify-content:space-between;gap:8px;color:#eef1f7;font-size:12.5px}.spl-value{color:var(--spl-amber);font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.spl-lab input[type=range]{width:100%;accent-color:var(--spl-amber);cursor:pointer}.spl-meter{height:5px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.08)}.spl-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--spl-blue),var(--spl-amber));border-radius:inherit;transition:width .18s ease}',
      '.spl-buttons{display:grid;grid-template-columns:auto 1fr;gap:8px}.spl-lab button{min-height:44px;padding:8px 13px;border:1px solid var(--spl-line);border-radius:10px;background:rgba(255,255,255,.045);color:#eef1f7;font:inherit;font-size:12.5px;cursor:pointer}.spl-lab button:hover{border-color:var(--spl-blue);background:rgba(131,162,255,.1)}.spl-lab button.primary{border:0;background:linear-gradient(120deg,var(--spl-amber),var(--spl-blue));color:#08090c;font-weight:750}.spl-lab button:disabled{opacity:.43;cursor:default}.spl-live{min-height:1.5em;color:var(--spl-amber)}.spl-note{padding:9px 10px;border-left:2px solid rgba(131,162,255,.65);background:rgba(131,162,255,.05)}.spl-lab details{border-top:1px solid var(--spl-line);padding-top:11px}.spl-lab summary{cursor:pointer;color:#eef1f7;font-size:12.5px}.spl-lab details p{margin:7px 0 0}',
      '@media(max-width:680px){.spl-grid{grid-template-columns:1fr}.spl-plate{min-height:210px}.spl-buttons{grid-template-columns:1fr}.spl-buttons button.primary{order:-1}.spl-lab button{width:100%}}@media(max-width:420px){.spl-lab{padding:15px}.spl-readout{gap:5px}.spl-stat{padding:8px 6px}.spl-stat b{font-size:11px}.spl-plate{min-height:200px}}@media(prefers-reduced-motion:reduce){.spl-lab *{scroll-behavior:auto!important;transition:none!important}}'
    ].join('');
    documentRef.head.appendChild(style);
  }

  function renderModeSvg(core, lab, mode) {
    const grid = core.sampleModeGrid(lab, { m: mode.m, n: mode.n }, { columns: 32, rows: 24, nodeWidth: 0.07 });
    const width = 100 / grid.columns;
    const height = 100 / grid.rows;
    const cells = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const index = row * grid.columns + column;
        const value = grid.values[index];
        const intensity = Math.min(1, Math.abs(value));
        const color = value >= 0 ? '#f4b23c' : '#83a2ff';
        cells.push('<rect x="' + (column * width).toFixed(3) + '" y="' + (row * height).toFixed(3) + '" width="' + (width + 0.12).toFixed(3) + '" height="' + (height + 0.12).toFixed(3) + '" fill="' + color + '" opacity="' + (0.055 + intensity * 0.54).toFixed(3) + '"/>');
      }
    }
    const nodes = [];
    for (let column = 1; column < mode.m; column += 1) nodes.push('<line x1="' + (column * 100 / mode.m).toFixed(3) + '" y1="0" x2="' + (column * 100 / mode.m).toFixed(3) + '" y2="100"/>');
    for (let row = 1; row < mode.n; row += 1) nodes.push('<line x1="0" y1="' + (row * 100 / mode.n).toFixed(3) + '" x2="100" y2="' + (row * 100 / mode.n).toFixed(3) + '"/>');
    const label = `薄板模态 m${mode.m}n${mode.n}，节点线以白色表示`;
    return '<svg viewBox="0 0 100 100" role="img" aria-label="' + escapeHtml(label) + '" preserveAspectRatio="none"><rect width="100" height="100" fill="#060912"/>' + cells.join('') + '<g stroke="#f6f3ea" stroke-width=".62" opacity=".84">' + nodes.join('') + '</g><rect x=".5" y=".5" width="99" height="99" fill="none" stroke="#f6f3ea" stroke-opacity=".35" stroke-width=".7"/></svg>';
  }

  function mount(container, options) {
    const settings = options || {};
    const documentRef = settings.document || (typeof document !== 'undefined' ? document : null);
    const core = settings.core || globalScope.PlateLabCore;
    if (!documentRef || !core) throw new Error('Plate Lab needs a browser document and PlateLabCore.');
    const host = typeof container === 'string' ? documentRef.querySelector(container) : container;
    if (!host) throw new Error('Plate Lab needs a valid container.');
    injectStyles(documentRef);

    const root = documentRef.createElement('section');
    root.className = 'spl-lab';
    root.setAttribute('aria-label', '薄板共振实验');
    root.innerHTML = '<header><p class="spl-eyebrow">PLATE LAB · EDUCATIONAL MODEL</p><h2>薄板共振实验</h2><p class="spl-intro">移动激振点或驱动频率，找出颗粒会聚集的节点，再把这一刻映射到 3D 粒子场。</p></header><div class="spl-grid"><div><div class="spl-plate" data-role="plate" tabindex="0" aria-describedby="spl-instructions"><span id="spl-instructions" hidden>在板面拖动激振点。方向键移动，按住 Shift 加速，Home 回到中心。</span><div data-role="mode-svg"></div><div class="spl-overlay"><span class="spl-chip" data-role="mode-chip"></span><span class="spl-chip" data-role="frequency-chip"></span><span class="spl-chip" data-role="region-chip"></span></div><span class="spl-exciter" data-role="exciter"></span></div><div class="spl-legend"><span><i></i><b>激振点</b>：输入能量</span><span><i class="node"></i><b>节点</b>：位移接近 0</span></div></div><div class="spl-controls"><span class="spl-model-chip">钢板 · 简支 · 420 × 320 × 0.38 mm</span><div class="spl-readout"><div class="spl-stat"><span>主模态</span><b data-role="mode-value"></b></div><div class="spl-stat"><span>理论频率</span><b data-role="natural-value"></b></div><div class="spl-stat"><span>耦合</span><b class="hot" data-role="coupling-value"></b></div></div><p class="spl-explain" data-role="point-status"></p><div class="spl-meter" aria-hidden="true"><i data-role="meter"></i></div><label class="spl-control"><span class="spl-labelrow"><span>驱动频率</span><output class="spl-value" data-role="frequency-output"></output></span><input type="range" min="10" max="480" value="126" step="1" data-role="frequency" aria-label="驱动频率"></label><div class="spl-buttons"><button type="button" data-action="next">下一共振</button><button type="button" class="primary" data-action="apply">映射到 3D 粒子场</button></div><p class="spl-live" data-role="live" aria-live="polite"></p><p class="spl-note">映射会把频率、激振位置和模态复杂度转成 3D 结构、细节与能量；这是受薄板共振启发的可解释视觉映射，不是同一块材料的严格 3D 仿真。</p><details><summary>节点、腹部与模型边界</summary><p class="spl-explain">节点的位移接近零，颗粒会在稳定线附近聚集；腹部位移最大。这里使用矩形简支 Kirchhoff–Love 薄板解析模态。材料参数采用名义值，未模拟夹具、空气和粒粒碰撞。</p></details></div></div>';
    host.innerHTML = '';
    host.appendChild(root);

    const plate = root.querySelector('[data-role="plate"]');
    const svgSlot = root.querySelector('[data-role="mode-svg"]');
    const exciter = root.querySelector('[data-role="exciter"]');
    const frequency = root.querySelector('[data-role="frequency"]');
    const frequencyOutput = root.querySelector('[data-role="frequency-output"]');
    const live = root.querySelector('[data-role="live"]');
    const applyButton = root.querySelector('[data-action="apply"]');
    const nextButton = root.querySelector('[data-action="next"]');
    const bridge = settings.target || globalScope.soundMotionNative || null;
    let state = { x: 0.5, y: 0.5, frequencyHz: 126.2425423 };
    let lab = null;
    let mode = null;
    let lastModeKey = '';
    let pointerActive = false;

    function createLab() {
      return core.createPlateLab({
        material: 'steel', boundary: 'simply-supported', width: 0.420, height: 0.320,
        thickness: 0.00038, dampingRatio: 0.012,
        excitationPoint: { x: state.x, y: state.y }, modeCount: 24
      });
    }

    function pointDescription(coupling) {
      if (coupling < 0.14) return { key: '节点', text: '节点｜位移接近 0。颗粒会在这些稳定线附近聚集。' };
      if (coupling > 0.72) return { key: '腹部', text: '腹部｜位移最大。把激振点放在这里，当前模态最容易被点亮。' };
      return { key: '过渡区', text: '过渡区｜能量会进入薄板，但耦合不是最强。试着靠近色块中心。' };
    }

    function dominantMode() {
      const response = core.frequencyResponse(lab, state.frequencyHz, { observationPoint: { x: state.x, y: state.y }, modeCount: lab.modes.length });
      return response.dominantMode || lab.modes[0];
    }

    function render(announce) {
      lab = createLab();
      mode = dominantMode();
      const coupling = mode.couplingMagnitude;
      const point = pointDescription(coupling);
      const detune = state.frequencyHz - mode.frequencyHz;
      const modeKey = `${mode.m}-${mode.n}`;
      if (modeKey !== lastModeKey) {
        svgSlot.innerHTML = renderModeSvg(core, lab, mode);
        lastModeKey = modeKey;
      }
      exciter.style.left = `${state.x * 100}%`;
      exciter.style.top = `${state.y * 100}%`;
      root.querySelector('[data-role="mode-chip"]').innerHTML = `m=<strong>${mode.m}</strong> · n=<strong>${mode.n}</strong>`;
      root.querySelector('[data-role="frequency-chip"]').textContent = Math.abs(detune) <= 1 ? `${Math.round(state.frequencyHz)} Hz · 共振` : `${Math.round(state.frequencyHz)} Hz · 偏离 ${detune > 0 ? '+' : ''}${detune.toFixed(1)}`;
      root.querySelector('[data-role="region-chip"]').textContent = `${point.key} · ${Math.round(coupling * 100)}%`;
      root.querySelector('[data-role="mode-value"]').textContent = `m${mode.m}n${mode.n}`;
      root.querySelector('[data-role="natural-value"]').textContent = `${mode.frequencyHz.toFixed(1)} Hz`;
      root.querySelector('[data-role="coupling-value"]').textContent = `${Math.round(coupling * 100)}%`;
      root.querySelector('[data-role="point-status"]').textContent = point.text;
      root.querySelector('[data-role="meter"]').style.width = `${Math.round(coupling * 100)}%`;
      frequency.value = String(Math.round(state.frequencyHz));
      frequencyOutput.textContent = `${Math.round(state.frequencyHz)} Hz`;
      plate.setAttribute('aria-label', `激振点：横向 ${Math.round(state.x * 100)}%，纵向 ${Math.round(state.y * 100)}%；m${mode.m}n${mode.n}，耦合 ${Math.round(coupling * 100)}%，${point.key}。`);
      applyButton.disabled = !bridge;
      if (!bridge) live.textContent = '3D 粒子场未准备好；仍可继续探索薄板。';
      if (announce) live.textContent = `当前 m${mode.m}n${mode.n}，${point.key}，耦合 ${Math.round(coupling * 100)}%。`;
      if (typeof settings.onStateChange === 'function') settings.onStateChange(Object.assign({}, state), { lab, mode });
    }

    function setState(next, announce) {
      if (next.x != null) state.x = clamp(next.x, 0, 1);
      if (next.y != null) state.y = clamp(next.y, 0, 1);
      if (next.frequencyHz != null) state.frequencyHz = clamp(next.frequencyHz, 10, 480);
      render(Boolean(announce));
    }

    function moveFromPointer(event, announce) {
      const rect = plate.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setState({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }, announce);
    }

    function nextResonance() {
      lab = createLab();
      const coupled = lab.modes.filter((candidate) => candidate.couplingMagnitude > 0.2 && candidate.frequencyHz <= 480);
      const next = coupled.find((candidate) => candidate.frequencyHz > state.frequencyHz + 0.8) || coupled[0];
      if (next) setState({ frequencyHz: next.frequencyHz }, true);
    }

    function applyRecipe() {
      if (!bridge || !mode) return { applied: [], skipped: [] };
      const recipe = core.createSoundMotionNativeRecipe(lab, { mode: { m: mode.m, n: mode.n }, style: settings.style || 'msand' });
      const allowed = new Set(recipe.allowedMethods);
      const result = { applied: [], skipped: [] };
      recipe.commands.forEach((command) => {
        if (!allowed.has(command.method) || typeof bridge[command.method] !== 'function') { result.skipped.push(command.method); return; }
        bridge[command.method].apply(bridge, command.args);
        result.applied.push(command.method);
      });
      live.textContent = `已把 m${mode.m}n${mode.n} 的视觉配方交给粒子场；音频/数据输入保持不变。`;
      if (typeof settings.onRecipe === 'function') settings.onRecipe(recipe, result);
      return result;
    }

    plate.addEventListener('pointerdown', (event) => { pointerActive = true; if (plate.setPointerCapture) plate.setPointerCapture(event.pointerId); moveFromPointer(event, false); });
    plate.addEventListener('pointermove', (event) => { if (pointerActive) moveFromPointer(event, false); });
    plate.addEventListener('pointerup', (event) => { pointerActive = false; if (plate.releasePointerCapture && plate.hasPointerCapture && plate.hasPointerCapture(event.pointerId)) plate.releasePointerCapture(event.pointerId); moveFromPointer(event, true); });
    plate.addEventListener('pointercancel', () => { pointerActive = false; });
    plate.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.08 : 0.025;
      const next = {};
      if (event.key === 'ArrowLeft') next.x = state.x - step;
      else if (event.key === 'ArrowRight') next.x = state.x + step;
      else if (event.key === 'ArrowUp') next.y = state.y - step;
      else if (event.key === 'ArrowDown') next.y = state.y + step;
      else if (event.key === 'Home') { next.x = 0.5; next.y = 0.5; }
      else return;
      event.preventDefault();
      setState(next, true);
    });
    frequency.addEventListener('input', () => setState({ frequencyHz: Number(frequency.value) }, false));
    frequency.addEventListener('change', () => render(true));
    nextButton.addEventListener('click', nextResonance);
    applyButton.addEventListener('click', applyRecipe);
    render(false);

    return {
      root,
      getState: () => Object.assign({}, state),
      getPlateLab: () => lab,
      getMode: () => mode,
      setState: (next) => setState(next, true),
      nextResonance,
      apply: applyRecipe,
      destroy: () => { pointerActive = false; if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  globalScope.SignalFieldPlateLabUI = { mount, renderModeSvg };
}(typeof globalThis !== 'undefined' ? globalThis : this));
