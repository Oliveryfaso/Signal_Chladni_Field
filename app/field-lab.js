/*
 * Signal Field — interactive field laboratory
 *
 * A dependency-free UMD module. It is intentionally separate from the renderer:
 * the same pure recipe functions can power the web app, an Electron controller,
 * a lesson page, or a unit test without creating a DOM.
 */
(function attachFieldLab(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldLab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFieldLab() {
  'use strict';

  const VERSION = '1.0.0';
  const BAND_COUNT = 16;
  const EPSILON = 1e-9;

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, number(value, min)));
  }

  function round(value, digits) {
    const multiplier = Math.pow(10, digits == null ? 3 : digits);
    return Math.round(number(value, 0) * multiplier) / multiplier;
  }

  function normalizedPoint(point) {
    const source = point || {};
    return {
      x: clamp(number(source.x, 0.5), 0, 1),
      y: clamp(number(source.y, 0.5), 0, 1)
    };
  }

  /** Convert browser/client coordinates into a normalized plate position. */
  function pointerToNormalizedPoint(pointer, rect) {
    const box = rect || {};
    const left = number(box.left, 0);
    const top = number(box.top, 0);
    const width = number(box.width, number(box.right, left) - left);
    const height = number(box.height, number(box.bottom, top) - top);
    if (width <= 0 || height <= 0) return { x: 0.5, y: 0.5 };
    return normalizedPoint({
      x: (number(pointer && pointer.clientX, left + width / 2) - left) / width,
      y: (number(pointer && pointer.clientY, top + height / 2) - top) / height
    });
  }

  /**
   * Frequency of a rectangular-plate standing-wave approximation. The (1, 1)
   * mode is intentionally `baseHz`, so the control reads like a real lab dial.
   */
  function modalFrequency(m, n, options) {
    const settings = options || {};
    const baseHz = Math.max(1, number(settings.baseHz, 42));
    const aspect = clamp(number(settings.aspect, 1), 0.35, 3);
    const orderM = Math.max(1, Math.round(number(m, 1)));
    const orderN = Math.max(1, Math.round(number(n, 1)));
    return baseHz * Math.sqrt(orderM * orderM + Math.pow(orderN / aspect, 2)) / Math.sqrt(2);
  }

  function buildModalBank(options) {
    const settings = options || {};
    const maxOrder = Math.round(clamp(number(settings.maxOrder, 5), 1, 10));
    const modes = [];
    for (let m = 1; m <= maxOrder; m += 1) {
      for (let n = 1; n <= maxOrder; n += 1) {
        modes.push({
          id: 'm' + m + 'n' + n,
          m: m,
          n: n,
          frequencyHz: modalFrequency(m, n, settings),
          order: m + n - 2
        });
      }
    }
    return modes.sort(function byFrequency(a, b) {
      return a.frequencyHz - b.frequencyHz || a.m - b.m || a.n - b.n;
    });
  }

  /** Displacement magnitude at a point in the standard sin(mπx)sin(nπy) field. */
  function modeAmplitude(point, mode) {
    const p = normalizedPoint(point);
    const m = Math.max(1, Math.round(number(mode && mode.m, 1)));
    const n = Math.max(1, Math.round(number(mode && mode.n, 1)));
    return Math.abs(Math.sin(Math.PI * m * p.x) * Math.sin(Math.PI * n * p.y));
  }

  /** A driver couples weakly on a node and strongly at an antinode. */
  function excitationCoupling(point, mode) {
    return modeAmplitude(point, mode);
  }

  function describePointInMode(point, mode) {
    const amplitude = modeAmplitude(point, mode);
    let region = 'transition';
    let label = '过渡区';
    let explanation = '此处会参与振动，但不是最安静或最强烈的位置。';
    if (amplitude < 0.14) {
      region = 'node';
      label = '节点';
      explanation = '节点的位移接近零；颗粒通常会聚集到这些稳定的线或面上。';
    } else if (amplitude > 0.72) {
      region = 'antinode';
      label = '腹部';
      explanation = '腹部的位移最大；把激振点放在这里，最容易激发当前模态。';
    }
    return { region: region, label: label, amplitude: amplitude, explanation: explanation };
  }

  function findResonantModes(frequencyHz, point, modes, options) {
    const settings = options || {};
    const requestedHz = Math.max(1, number(frequencyHz, 120));
    const bank = Array.isArray(modes) && modes.length ? modes : buildModalBank(settings);
    const baseHz = Math.max(1, number(settings.baseHz, 42));
    const bandwidthHz = Math.max(2, number(settings.bandwidthHz, baseHz * 0.32));
    const limit = Math.round(clamp(settings.limit, 1, 8));
    const p = normalizedPoint(point);
    return bank.map(function scoreMode(mode) {
      const detune = (requestedHz - mode.frequencyHz) / bandwidthHz;
      const resonance = Math.exp(-0.5 * detune * detune);
      const coupling = excitationCoupling(p, mode);
      return Object.assign({}, mode, {
        detuneHz: requestedHz - mode.frequencyHz,
        resonance: resonance,
        coupling: coupling,
        score: resonance * (0.14 + 0.86 * coupling)
      });
    }).sort(function byScore(a, b) {
      return b.score - a.score || Math.abs(a.detuneHz) - Math.abs(b.detuneHz) || a.frequencyHz - b.frequencyHz;
    }).slice(0, limit);
  }

  function bandForFrequency(frequencyHz, baseHz, bands) {
    const count = Math.max(2, Math.round(number(bands, BAND_COUNT)));
    const ratio = Math.max(1, number(frequencyHz, baseHz) / Math.max(1, baseHz));
    const logarithmic = Math.log2(ratio + 0.35) / Math.log2(12.35);
    return Math.round(clamp(logarithmic, 0, 1) * (count - 1));
  }

  /** Convert ranked physical modes into the renderer's 16-band feature-frame shape. */
  function createFeatureFrame(activeModes, options) {
    const settings = options || {};
    const bands = new Array(Math.max(2, Math.round(number(settings.bands, BAND_COUNT)))).fill(0);
    const baseHz = Math.max(1, number(settings.baseHz, 42));
    const modes = Array.isArray(activeModes) ? activeModes : [];
    let total = 0;
    modes.forEach(function addMode(mode, index) {
      const weight = Math.max(0, number(mode.score, 0)) * (index === 0 ? 1 : 0.72);
      const band = bandForFrequency(mode.frequencyHz, baseHz, bands.length);
      bands[band] = Math.min(1.5, bands[band] + weight * 1.38);
      total += weight;
    });
    const primary = modes[0] || { order: 0, coupling: 0 };
    const energy = clamp(0.16 + total * 0.92, 0.12, 1.45);
    const sharpness = clamp(0.28 + number(primary.order, 0) * 0.09 + number(primary.coupling, 0) * 0.22, 0.22, 0.96);
    return {
      bands: bands,
      energy: energy,
      sharpness: sharpness,
      flat: clamp(0.68 - sharpness * 0.42, 0.12, 0.7)
    };
  }

  function allowedStyle(value) {
    return ['sand', 'msand', 'cosmic', 'dcosmic'].indexOf(value) >= 0 ? value : 'msand';
  }

  /**
   * Build a renderer-neutral command recipe. The commands are intentionally
   * limited to the public `soundMotionNative` API exposed by app/index.html.
   */
  function createVisualizerCommandRecipe(input) {
    const settings = input || {};
    const excitation = normalizedPoint(settings.excitation || settings.point);
    const baseHz = Math.max(1, number(settings.baseHz, 42));
    const aspect = clamp(number(settings.aspect, 1), 0.35, 3);
    const maxOrder = Math.round(clamp(number(settings.maxOrder, 5), 1, 10));
    const frequencyHz = clamp(number(settings.frequencyHz, 120), 1, 4000);
    const bank = Array.isArray(settings.modes) && settings.modes.length
      ? settings.modes
      : buildModalBank({ baseHz: baseHz, aspect: aspect, maxOrder: maxOrder });
    const activeModes = findResonantModes(frequencyHz, excitation, bank, {
      baseHz: baseHz,
      bandwidthHz: settings.bandwidthHz,
      limit: settings.modeLimit == null ? 4 : settings.modeLimit
    });
    const primary = activeModes[0] || Object.assign({}, bank[0], { coupling: 0, score: 0, order: 0 });
    const fieldFrame = createFeatureFrame(activeModes, { baseHz: baseHz, bands: BAND_COUNT });
    const complexity = Math.max(0, number(primary.order, 0)) + Math.min(1.5, activeModes.length * 0.18);
    const detail = round(clamp(0.68 + complexity * 0.18 + fieldFrame.sharpness * 0.38, 0.55, 3), 3);
    const particles = round(clamp(0.12 + fieldFrame.energy * 0.23 + complexity * 0.022, 0.08, 0.72), 3);
    const evolve = round(clamp(0.22 + (frequencyHz / Math.max(baseHz * 10, 1)) * 0.38 + fieldFrame.sharpness * 0.15, 0.16, 0.86), 3);
    const goal = round(clamp(3.3 + (primary.m - 1) * 1.38 + (primary.n - 1) * 1.21 + fieldFrame.sharpness * 1.35, 0.65, 14), 6);
    const ex = [
      round(excitation.x, 6),
      round(excitation.y, 6),
      round(clamp(0.1 + ((primary.m + primary.n - 2) / Math.max(1, maxOrder * 2 - 2)) * 0.68 + primary.coupling * 0.14, 0.05, 0.95), 6)
    ];
    const style = allowedStyle(settings.style);
    const patternSpec = {
      style: style,
      goal: goal,
      ex: ex,
      detail: detail,
      shape: settings.shape === 'random' ? 'random' : 'regular',
      polyN: Math.round(clamp(number(settings.polyN, 8), 4, 32)),
      polySeed: Math.max(1, Math.round(number(settings.polySeed, 1))),
      sym: Boolean(settings.symmetric)
    };
    const pointDescription = describePointInMode(excitation, primary);
    return {
      schema: 'signal-field/field-lab-recipe@1',
      version: VERSION,
      source: 'field-lab',
      excitation: {
        x: excitation.x,
        y: excitation.y,
        coupling: primary.coupling,
        region: pointDescription.region
      },
      scan: {
        frequencyHz: frequencyHz,
        baseHz: baseHz,
        aspect: aspect,
        bandwidthHz: Math.max(2, number(settings.bandwidthHz, baseHz * 0.32))
      },
      primaryMode: {
        id: primary.id,
        m: primary.m,
        n: primary.n,
        frequencyHz: primary.frequencyHz,
        detuneHz: primary.detuneHz,
        coupling: primary.coupling,
        score: primary.score
      },
      activeModes: activeModes.map(function serialiseMode(mode) {
        return {
          id: mode.id,
          m: mode.m,
          n: mode.n,
          frequencyHz: mode.frequencyHz,
          detuneHz: mode.detuneHz,
          coupling: mode.coupling,
          resonance: mode.resonance,
          score: mode.score,
          band: bandForFrequency(mode.frequencyHz, baseHz, BAND_COUNT)
        };
      }),
      explanation: pointDescription,
      featureFrame: fieldFrame,
      visualizer: {
        style: style,
        detail: detail,
        particles: particles,
        evolve: evolve,
        patternSpec: patternSpec
      },
      commands: [
        { type: 'call', method: 'setStyle', args: [style] },
        { type: 'call', method: 'setParam', args: ['detail', detail] },
        { type: 'call', method: 'setParam', args: ['particles', particles] },
        { type: 'call', method: 'setParam', args: ['evolve', evolve] },
        { type: 'call', method: 'applyPatternSpec', args: [patternSpec] }
      ]
    };
  }

  /** Apply a recipe to a soundMotionNative-compatible target, if one is supplied. */
  function applyVisualizerRecipe(recipe, target) {
    const receiver = target || (typeof window !== 'undefined' ? window.soundMotionNative : null);
    const commands = recipe && Array.isArray(recipe.commands) ? recipe.commands : [];
    const allowed = new Set(['setStyle', 'setParam', 'applyPatternSpec']);
    const result = { applied: [], skipped: [] };
    commands.forEach(function applyCommand(command) {
      const method = command && command.method;
      if (!allowed.has(method) || !receiver || typeof receiver[method] !== 'function') {
        result.skipped.push(method || 'unknown');
        return;
      }
      receiver[method].apply(receiver, Array.isArray(command.args) ? command.args : []);
      result.applied.push(method);
    });
    return result;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function replaceCharacter(character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function renderModeSvg(mode, excitation) {
    const safeMode = mode || { m: 1, n: 1, id: 'm1n1', frequencyHz: 0 };
    const point = normalizedPoint(excitation);
    const m = Math.max(1, Math.round(number(safeMode.m, 1)));
    const n = Math.max(1, Math.round(number(safeMode.n, 1)));
    const cells = [];
    for (let column = 0; column < m; column += 1) {
      for (let row = 0; row < n; row += 1) {
        const signedAmplitude = Math.sin(Math.PI * m * ((column + 0.5) / m)) * Math.sin(Math.PI * n * ((row + 0.5) / n));
        const amplitude = Math.abs(signedAmplitude);
        const phaseColor = signedAmplitude >= 0 ? '#f4b23c' : '#83a2ff';
        cells.push('<rect x="' + round(column * 100 / m, 4) + '" y="' + round(row * 100 / n, 4) + '" width="' + round(100 / m, 4) + '" height="' + round(100 / n, 4) + '" fill="' + phaseColor + '" opacity="' + round(0.12 + amplitude * 0.42, 3) + '"/>');
      }
    }
    const nodes = [];
    for (let column = 1; column < m; column += 1) nodes.push('<line x1="' + round(column * 100 / m, 4) + '" y1="0" x2="' + round(column * 100 / m, 4) + '" y2="100"/>');
    for (let row = 1; row < n; row += 1) nodes.push('<line x1="0" y1="' + round(row * 100 / n, 4) + '" x2="100" y2="' + round(row * 100 / n, 4) + '"/>');
    const x = round(point.x * 100, 4);
    const y = round(point.y * 100, 4);
    const label = '模态 ' + safeMode.id + '，' + m + ' × ' + n + '，激振点 ' + Math.round(point.x * 100) + '%，' + Math.round(point.y * 100) + '%';
    return '<svg viewBox="0 0 100 100" role="img" aria-label="' + escapeHtml(label) + '" preserveAspectRatio="none">' +
      '<rect width="100" height="100" fill="#070b13"/>' + cells.join('') +
      '<g class="sfl-mode-nodes" stroke="#eef1f7" stroke-width=".65" opacity=".64">' + nodes.join('') + '</g>' +
      '<rect x=".6" y=".6" width="98.8" height="98.8" fill="none" stroke="#eef1f7" stroke-opacity=".38" stroke-width=".7"/>' +
      '<g class="sfl-exciter"><circle cx="' + x + '" cy="' + y + '" r="5.2" fill="none" stroke="#f4b23c" stroke-opacity=".35" stroke-width="1"/><circle cx="' + x + '" cy="' + y + '" r="2.35" fill="#f4b23c" stroke="#0b0c10" stroke-width=".85"/></g>' +
      '</svg>';
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById('signal-field-lab-styles')) return;
    const style = documentRef.createElement('style');
    style.id = 'signal-field-lab-styles';
    style.textContent = [
      '.sfl-lab{--sfl-bg:rgba(255,255,255,.045);--sfl-line:rgba(255,255,255,.13);--sfl-ink:#eef1f7;--sfl-muted:#a8afc0;--sfl-amber:#f4b23c;--sfl-blue:#83a2ff;color:var(--sfl-ink);background:var(--sfl-bg);border:1px solid var(--sfl-line);border-radius:16px;padding:clamp(16px,3vw,24px);font:inherit;box-shadow:0 22px 50px -34px rgba(0,0,0,.8)}',
      '.sfl-lab *{box-sizing:border-box}.sfl-lab__eyebrow{margin:0 0 4px;color:var(--sfl-amber);font:600 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.sfl-lab h2{margin:0;font-size:clamp(18px,2.6vw,24px);line-height:1.2}.sfl-lab__intro,.sfl-lab__status,.sfl-lab__explain{margin:8px 0 0;color:var(--sfl-muted);font-size:13px;line-height:1.55}.sfl-lab__grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(260px,.92fr);gap:clamp(16px,3vw,28px);align-items:start;margin-top:18px}.sfl-lab__plate{display:block;position:relative;width:100%;aspect-ratio:1.36/1;min-height:200px;padding:0;overflow:hidden;background:#070b13;border:1px solid var(--sfl-line);border-radius:13px;color:inherit;cursor:crosshair;touch-action:none}.sfl-lab__plate:hover{border-color:rgba(244,178,60,.75)}.sfl-lab__plate:focus-visible,.sfl-lab button:focus-visible,.sfl-lab input:focus-visible{outline:2px solid var(--sfl-blue);outline-offset:3px}.sfl-lab__plate svg{display:block;width:100%;height:100%}.sfl-lab__legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;color:var(--sfl-muted);font-size:12px}.sfl-lab__legend b{color:var(--sfl-ink);font-weight:600}.sfl-lab__legend i{display:inline-block;width:9px;height:9px;margin-right:5px;border-radius:99px;background:var(--sfl-amber)}.sfl-lab__legend i.node{background:var(--sfl-ink)}.sfl-lab__controls{display:grid;gap:14px}.sfl-lab__control{display:grid;gap:6px}.sfl-lab__labelrow{display:flex;gap:8px;align-items:baseline;justify-content:space-between;font-size:13px}.sfl-lab__value{color:var(--sfl-amber);font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.sfl-lab input[type=range]{width:100%;accent-color:var(--sfl-amber);cursor:pointer}.sfl-lab__buttons{display:flex;gap:8px;flex-wrap:wrap}.sfl-lab button:not(.sfl-lab__plate){min-height:36px;padding:7px 12px;border:1px solid var(--sfl-line);border-radius:9px;background:rgba(255,255,255,.05);color:var(--sfl-ink);font:inherit;font-size:13px;cursor:pointer}.sfl-lab button:not(.sfl-lab__plate):hover{border-color:var(--sfl-blue);background:rgba(131,162,255,.13)}.sfl-lab button.sfl-lab__apply{border:0;background:linear-gradient(120deg,var(--sfl-amber),var(--sfl-blue));color:#08090c;font-weight:700}.sfl-lab details{border-top:1px solid var(--sfl-line);padding-top:12px}.sfl-lab summary{cursor:pointer;color:var(--sfl-ink);font-size:13px}.sfl-lab__recipe{margin:0;padding:10px 12px;overflow:auto;border-radius:10px;background:rgba(0,0,0,.22);color:var(--sfl-muted);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.sfl-lab__live{min-height:1.5em;color:var(--sfl-amber);font-size:12px}.sfl-lab__hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media (max-width:680px){.sfl-lab__grid{grid-template-columns:1fr}.sfl-lab__plate{min-height:180px}}@media (prefers-reduced-motion:reduce){.sfl-lab *{scroll-behavior:auto!important;transition:none!important}}'
    ].join('');
    documentRef.head.appendChild(style);
  }

  function mount(container, options) {
    const settings = options || {};
    const documentRef = settings.document || (container && container.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) throw new Error('SignalFieldLab.mount needs a browser document.');
    const host = typeof container === 'string' ? documentRef.querySelector(container) : container;
    if (!host || typeof host.appendChild !== 'function') throw new Error('SignalFieldLab.mount needs a valid container element.');
    injectStyles(documentRef);

    const root = documentRef.createElement('section');
    root.className = 'sfl-lab';
    root.setAttribute('aria-label', '交互物理实验室');
    root.innerHTML = '<header><p class="sfl-lab__eyebrow">Field laboratory</p><h2>交互物理实验室</h2><p class="sfl-lab__intro">拖动激振点、扫描频率，观察哪些模态被真正点亮，再把这一刻发送给粒子场。</p></header>' +
      '<div class="sfl-lab__grid"><div><div class="sfl-lab__plate" data-role="plate" tabindex="0" aria-describedby="sfl-lab-instructions"><span class="sfl-lab__hidden" id="sfl-lab-instructions">在板面上拖动激振点。也可以聚焦后用方向键移动，Shift 加速，Home 回到中心。</span><div data-role="mode-svg"></div></div><div class="sfl-lab__legend"><span><i></i><b>激振点</b>：能量输入位置</span><span><i class="node"></i><b>节点</b>：几乎不动</span></div></div>' +
      '<div class="sfl-lab__controls"><label class="sfl-lab__control"><span class="sfl-lab__labelrow"><span>驱动频率</span><output class="sfl-lab__value" data-role="frequency-output"></output></span><input data-role="frequency" type="range" min="30" max="480" step="1" aria-label="驱动频率"></label>' +
      '<div class="sfl-lab__buttons"><button type="button" data-action="scan">开始扫描</button><button type="button" class="sfl-lab__apply" data-action="apply">应用到粒子场</button></div>' +
      '<p class="sfl-lab__status" data-role="mode-status"></p><p class="sfl-lab__explain" data-role="point-status"></p><p class="sfl-lab__live" aria-live="polite" data-role="live"></p>' +
      '<details><summary>节点和腹部是什么意思？</summary><p class="sfl-lab__explain"><b>节点</b>的振幅接近零，颗粒会向这里迁移并显出纹样；<b>腹部</b>的振幅最大，把激振点放在这里会更强地耦合到相应模态。</p></details>' +
      '<details><summary>查看当前配方</summary><pre class="sfl-lab__recipe" data-role="recipe"></pre></details></div></div>';
    host.appendChild(root);

    const plate = root.querySelector('[data-role="plate"]');
    const svgSlot = root.querySelector('[data-role="mode-svg"]');
    const frequencyControl = root.querySelector('[data-role="frequency"]');
    const frequencyOutput = root.querySelector('[data-role="frequency-output"]');
    const modeStatus = root.querySelector('[data-role="mode-status"]');
    const pointStatus = root.querySelector('[data-role="point-status"]');
    const live = root.querySelector('[data-role="live"]');
    const recipeOutput = root.querySelector('[data-role="recipe"]');
    const scanButton = root.querySelector('[data-action="scan"]');
    const applyButton = root.querySelector('[data-action="apply"]');
    const reducedMotion = Boolean(documentRef.defaultView && documentRef.defaultView.matchMedia && documentRef.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let state = {
      x: clamp(number(settings.x, 0.5), 0, 1),
      y: clamp(number(settings.y, 0.5), 0, 1),
      frequencyHz: clamp(number(settings.frequencyHz, 120), 30, 480),
      baseHz: Math.max(1, number(settings.baseHz, 42)),
      aspect: clamp(number(settings.aspect, 1), 0.35, 3),
      maxOrder: Math.round(clamp(number(settings.maxOrder, 5), 1, 10)),
      style: allowedStyle(settings.style),
      scanning: false
    };
    let scanTimer = null;
    let pointerActive = false;
    let lastRecipe = null;

    function createRecipe() {
      return createVisualizerCommandRecipe({
        excitation: { x: state.x, y: state.y },
        frequencyHz: state.frequencyHz,
        baseHz: state.baseHz,
        aspect: state.aspect,
        maxOrder: state.maxOrder,
        style: state.style,
        shape: settings.shape,
        polyN: settings.polyN,
        polySeed: settings.polySeed,
        symmetric: settings.symmetric
      });
    }

    function announce(recipe) {
      live.textContent = '当前主模态 ' + recipe.primaryMode.id + '，耦合 ' + Math.round(recipe.primaryMode.coupling * 100) + '%。';
    }

    function render(shouldAnnounce) {
      lastRecipe = createRecipe();
      const primary = lastRecipe.primaryMode;
      const point = lastRecipe.explanation;
      svgSlot.innerHTML = renderModeSvg(primary, state);
      frequencyControl.value = String(Math.round(state.frequencyHz));
      frequencyOutput.textContent = Math.round(state.frequencyHz) + ' Hz';
      modeStatus.textContent = '主模态 ' + primary.id + ' · 理论 ' + round(primary.frequencyHz, 1) + ' Hz · 偏差 ' + round(primary.detuneHz, 1) + ' Hz';
      pointStatus.textContent = '激振点位于' + point.label + '（耦合 ' + Math.round(primary.coupling * 100) + '%）：' + point.explanation;
      plate.setAttribute('aria-label', '当前激振点横向 ' + Math.round(state.x * 100) + '%，纵向 ' + Math.round(state.y * 100) + '%；' + modeStatus.textContent);
      scanButton.textContent = state.scanning ? '停止扫描' : '开始扫描';
      recipeOutput.textContent = JSON.stringify({
        excitation: lastRecipe.excitation,
        scan: lastRecipe.scan,
        primaryMode: lastRecipe.primaryMode,
        commands: lastRecipe.commands
      }, null, 2);
      if (typeof settings.onStateChange === 'function') settings.onStateChange(Object.assign({}, state), lastRecipe);
      if (shouldAnnounce) announce(lastRecipe);
      return lastRecipe;
    }

    function setState(next, shouldAnnounce) {
      const update = next || {};
      state = Object.assign({}, state, {
        x: update.x == null ? state.x : clamp(update.x, 0, 1),
        y: update.y == null ? state.y : clamp(update.y, 0, 1),
        frequencyHz: update.frequencyHz == null ? state.frequencyHz : clamp(update.frequencyHz, 30, 480),
        baseHz: update.baseHz == null ? state.baseHz : Math.max(1, number(update.baseHz, state.baseHz)),
        aspect: update.aspect == null ? state.aspect : clamp(update.aspect, 0.35, 3),
        maxOrder: update.maxOrder == null ? state.maxOrder : Math.round(clamp(update.maxOrder, 1, 10)),
        style: update.style == null ? state.style : allowedStyle(update.style)
      });
      return render(Boolean(shouldAnnounce));
    }

    function moveExciterFromPointer(event) {
      const point = pointerToNormalizedPoint(event, plate.getBoundingClientRect());
      setState(point, true);
    }

    function stopScan() {
      if (scanTimer !== null) {
        (documentRef.defaultView || globalThis).clearInterval(scanTimer);
        scanTimer = null;
      }
      if (state.scanning) {
        state = Object.assign({}, state, { scanning: false });
        render(false);
      }
    }

    function startScan() {
      if (scanTimer !== null) return;
      state = Object.assign({}, state, { scanning: true });
      render(false);
      const timerHost = documentRef.defaultView || globalThis;
      scanTimer = timerHost.setInterval(function scanFrequency() {
        const next = state.frequencyHz >= 480 ? 30 : state.frequencyHz + 2;
        setState({ frequencyHz: next }, false);
      }, reducedMotion ? 240 : 85);
    }

    plate.addEventListener('pointerdown', function onPointerDown(event) {
      pointerActive = true;
      if (typeof plate.setPointerCapture === 'function') plate.setPointerCapture(event.pointerId);
      moveExciterFromPointer(event);
    });
    plate.addEventListener('pointermove', function onPointerMove(event) {
      if (pointerActive) moveExciterFromPointer(event);
    });
    plate.addEventListener('pointerup', function onPointerUp(event) {
      pointerActive = false;
      if (typeof plate.releasePointerCapture === 'function' && plate.hasPointerCapture && plate.hasPointerCapture(event.pointerId)) plate.releasePointerCapture(event.pointerId);
    });
    plate.addEventListener('pointercancel', function onPointerCancel() { pointerActive = false; });
    plate.addEventListener('keydown', function onPlateKeydown(event) {
      const step = event.shiftKey ? 0.08 : 0.025;
      const changes = {};
      if (event.key === 'ArrowLeft') changes.x = state.x - step;
      else if (event.key === 'ArrowRight') changes.x = state.x + step;
      else if (event.key === 'ArrowUp') changes.y = state.y - step;
      else if (event.key === 'ArrowDown') changes.y = state.y + step;
      else if (event.key === 'Home') { changes.x = 0.5; changes.y = 0.5; }
      else return;
      event.preventDefault();
      setState(changes, true);
    });
    frequencyControl.addEventListener('input', function onFrequencyInput() {
      setState({ frequencyHz: frequencyControl.value }, true);
    });
    scanButton.addEventListener('click', function onScanClick() {
      if (state.scanning) stopScan(); else startScan();
    });
    applyButton.addEventListener('click', function onApplyClick() {
      const recipe = createRecipe();
      const applied = settings.target ? applyVisualizerRecipe(recipe, settings.target) : { applied: [], skipped: [] };
      if (typeof settings.onRecipe === 'function') settings.onRecipe(recipe, applied);
      live.textContent = applied.applied.length
        ? '已应用 ' + applied.applied.length + ' 条粒子场指令。'
        : '配方已生成；连接渲染器后可一键应用。';
    });

    render(false);
    return {
      root: root,
      getState: function getState() { return Object.assign({}, state); },
      setState: function publicSetState(next) { return setState(next, true); },
      getRecipe: function getRecipe() { return createRecipe(); },
      apply: function apply(target) { return applyVisualizerRecipe(createRecipe(), target || settings.target); },
      startScan: startScan,
      stopScan: stopScan,
      destroy: function destroy() { stopScan(); if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  return {
    VERSION: VERSION,
    BAND_COUNT: BAND_COUNT,
    clamp: clamp,
    normalizedPoint: normalizedPoint,
    pointerToNormalizedPoint: pointerToNormalizedPoint,
    modalFrequency: modalFrequency,
    buildModalBank: buildModalBank,
    modeAmplitude: modeAmplitude,
    excitationCoupling: excitationCoupling,
    describePointInMode: describePointInMode,
    findResonantModes: findResonantModes,
    createFeatureFrame: createFeatureFrame,
    createVisualizerCommandRecipe: createVisualizerCommandRecipe,
    applyVisualizerRecipe: applyVisualizerRecipe,
    renderModeSvg: renderModeSvg,
    mount: mount
  };
});
