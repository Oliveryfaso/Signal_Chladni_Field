(function () {
  'use strict';

  const api = window.soundMotionDesktop;
  const NBANDS = 16;
  const audioPromptEl = document.getElementById('system-audio-prompt');
  const statusEl = document.getElementById('capture-status');
  const state = {
    source: 'system',
    style: 'sand',
    detailByStyle: { sand: 1.5, msand: 1, cosmic: 1, dcosmic: 1.5 },
    view: '3d',   // fixed: the 2D view was removed
    sampleMode: 'beat',
    patternInterval: 2,
    overlayShape: 'circle',   // fixed: square overlay removed
    overlaySize: 240,
    alwaysOnTop: true,
    fullScreen: false,
    transparent: true,
    zoom3d: 3,
    solidShape: 'regular',
    faces: 8,
    captureActive: false,
    systemAudioPromptSeen: false
  };

  let capture = null;
  let lowSignalFrames = 0;

  const I18N = {
    zh: {
      window: '窗口', visual: '视觉', pin: '置顶', dice: '随机图形', savePat: '收藏当前', recallPat: '载入收藏', size: '尺寸',
      fullscreen: '全屏', transparent: '透明', cosmic: '宇宙网', sand: '动态声沙', msand: '模态声沙', dcosmic: '动态宇宙网', beat: '按拍', timed: '定时',
      interval: '定时更新', sec1: '1 秒', sec2: '2 秒', secUnit: '秒', symmetry: '中心对称', frame: '边框',
      detail: '细节', particles: '粒子', zoom: '缩放', evolve: '演化', spin: '自转', axis: '绕轴',
      tumble: '翻滚', precess: '进动', regular: '正 N 面体', random: '不规则', speed: '转速',
      lightDepth: '景深', lightDim: '弱光', lightTop: '顶光', lightPoint: '点光源', lightRim: '轮廓光',
      lightCore: '核心光', lightSweep: '旋转扫光', lightBottom: '底光', lightLeft: '左侧光', lightRight: '右侧光', light: '打光', systemAudio: '系统音频', connectSystem: '接入系统音频',
      permissions: '权限设置', promptCopy: '首次接入后,这里不再显示音频控制。',
      followTip: '跟随系统音频', play: '播放', pause: '暂停', showViz: '显示可视化窗口',
      follow: '跟随系统音频', unfollow: '取消跟随',
      audioName: '系统音频', notConnected: '未接入', unavailable: '当前环境不可用', requesting: '请求权限',
      noTrack: '未获得音频轨道，检查权限', capturing: '正在捕获', waiting: '已接入，等待系统声音', stopped: '已停止'
    },
    en: {
      window: 'Window', visual: 'Visual', pin: 'Pin', dice: 'Random pattern', savePat: 'Save pattern', recallPat: 'Recall saved', size: 'Size',
      fullscreen: 'Fullscreen', transparent: 'Transparent', cosmic: 'Cosmic', sand: 'Dynamic Sand', msand: 'Modal Sand', dcosmic: 'Dynamic Cosmic', beat: 'Beat', timed: 'Timed',
      interval: 'Interval', sec1: '1s', sec2: '2s', secUnit: 's', symmetry: 'Symmetry', frame: 'Frame',
      detail: 'Detail', particles: 'Particles', zoom: 'Zoom', evolve: 'Evolve', spin: 'Spin', axis: 'Orbit',
      tumble: 'Tumble', precess: 'Precession', regular: 'Regular', random: 'Random', speed: 'Speed',
      lightDepth: 'Depth', lightDim: 'Dim', lightTop: 'Top', lightPoint: 'Point', lightRim: 'Rim',
      lightCore: 'Core', lightSweep: 'Sweep', lightBottom: 'Bottom', lightLeft: 'Left', lightRight: 'Right', light: 'Light', systemAudio: 'System Audio', connectSystem: 'Connect Audio',
      permissions: 'Permissions', promptCopy: 'Hidden after the first connect.',
      followTip: 'Follow system audio', play: 'Play', pause: 'Pause', showViz: 'Show Visualizer',
      follow: 'Follow Audio', unfollow: 'Unfollow',
      audioName: 'System Audio', notConnected: 'Not connected', unavailable: 'Unavailable here', requesting: 'Requesting permission',
      noTrack: 'No audio track, check permission', capturing: 'Capturing', waiting: 'Connected, waiting for sound', stopped: 'Stopped'
    }
  };

  let lang = 'zh';
  function t(key) {
    return (I18N[lang] && I18N[lang][key] != null) ? I18N[lang][key] : (I18N.zh[key] != null ? I18N.zh[key] : key);
  }

  let statusState = { key: 'idle', label: '' };
  function renderStatus() {
    if (!statusEl) return;
    if (statusState.key === 'raw') { statusEl.textContent = statusState.label; return; }
    let tail;
    switch (statusState.key) {
      case 'unavailable': tail = t('unavailable'); break;
      case 'requesting': tail = t('requesting'); break;
      case 'noTrack': tail = t('noTrack'); break;
      case 'capturing': tail = statusState.label ? `${t('capturing')} (${statusState.label})` : t('capturing'); break;
      case 'waiting': tail = t('waiting'); break;
      case 'stopped': tail = t('stopped'); break;
      default: tail = t('notConnected');
    }
    statusEl.textContent = `${t('audioName')} · ${tail}`;
  }
  function setStatus(key, label) {
    statusState = { key, label: label || '' };
    renderStatus();
  }

  function syncFollowButton() {
    const button = document.getElementById('follow-toggle');
    if (!button) return;
    const on = Boolean(state.captureActive);
    button.textContent = on ? t('unfollow') : t('follow');
    button.setAttribute('aria-pressed', String(on));
  }

  function applyLanguage(next) {
    lang = next === 'en' ? 'en' : 'zh';
    try { localStorage.setItem('sm-lang', lang); } catch (_error) {}
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const value = I18N[lang][el.dataset.i18n];
      if (value != null) el.textContent = value;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const value = I18N[lang][el.dataset.i18nTitle];
      if (value != null) el.title = value;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const value = I18N[lang][el.dataset.i18nAria];
      if (value != null) el.setAttribute('aria-label', value);
    });
    const toggle = document.getElementById('lang-toggle');
    if (toggle) toggle.textContent = lang === 'zh' ? 'EN' : '中';
    syncFollowButton();
    renderStatus();
  }

  function visualizerCall(method, args) {
    api.sendVisualizerCommand({ type: 'call', method, args: args || [] });
  }

  function setActiveButton(group, value) {
    group.querySelectorAll('button[data-value]').forEach((button) => {
      button.classList.toggle('active', button.dataset.value === String(value));
    });
  }

  function setToggleButton(button, active) {
    button.classList.toggle('active', Boolean(active));
    button.setAttribute('aria-pressed', String(Boolean(active)));
  }

  function setRangeFill(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
  }

  function clampPatternInterval(value) {
    const numeric = Number(value);
    return Math.max(0.25, Math.min(30, Number.isFinite(numeric) ? numeric : 2));
  }

  function formatPatternInterval(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatZoom(value) {
    return value.toFixed(value < 1 ? 2 : 1);
  }

  function currentZoom() {
    return state.zoom3d;
  }

  function syncZoomControl() {
    const input = document.getElementById('zoom');
    const output = document.getElementById('zoom-value');
    if (!input || !output) return;
    const value = currentZoom();
    input.value = String(value);
    output.value = formatZoom(value);
    output.textContent = formatZoom(value);
    setRangeFill(input);
  }

  function syncDetailControl() {
    const input = document.getElementById('detail');
    const output = document.getElementById('detail-value');
    if (!input || !output) return;
    const value = state.detailByStyle[state.style];
    input.value = String(value);
    output.value = value.toFixed(2);
    output.textContent = value.toFixed(2);
    setRangeFill(input);
  }

  function bytesToFrame(freq) {
    const bands = new Array(NBANDS).fill(0);
    const per = freq.length / NBANDS;
    let sum = 0;
    let centroid = 0;
    let total = 0;

    for (let i = 0; i < freq.length; i += 1) {
      const v = freq[i] / 255;
      sum += v * v;
      centroid += i * v;
      total += v;
      bands[Math.min(NBANDS - 1, Math.floor(i / per))] += v;
    }

    let max = 1e-6;
    for (const value of bands) max = Math.max(max, value);
    for (let i = 0; i < bands.length; i += 1) bands[i] /= max;

    const energy = Math.min(2, Math.sqrt(sum / freq.length) * 4.5);
    const sharpness = total > 1e-6 ? Math.min(1, (centroid / total / freq.length) * 1.6) : 0.3;
    return {
      bands,
      energy: Math.max(0.12, energy),
      sharpness: Math.max(0.2, sharpness)
    };
  }

  async function finishSystemAudioPrompt() {
    state.systemAudioPromptSeen = true;
    if (audioPromptEl) audioPromptEl.hidden = true;
    try {
      await api.markSystemAudioPromptSeen();
    } catch (_error) {}
  }

  async function startSystemAudio() {
    if (capture && capture.active) {
      await finishSystemAudioPrompt();
      return;
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      setStatus('unavailable');
      return;
    }

    setStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: {
          width: { ideal: 16 },
          height: { ideal: 16 },
          frameRate: { ideal: 1, max: 1 }
        }
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus('noTrack');
        api.sendSystemAudioState({ active: false, label: '系统音频 · 未获得音频轨道' });
        return;
      }

      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextImpl();
      if (context.state !== 'running') await context.resume();

      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.32;

      const source = context.createMediaStreamSource(stream);
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink);
      sink.connect(context.destination);

      const freq = new Uint8Array(analyser.frequencyBinCount);
      capture = {
        active: true,
        stream,
        context,
        source,
        sink,
        analyser,
        freq,
        timer: 0
      };

      const stopOnEnd = () => stopSystemAudio(false);
      stream.getTracks().forEach((track) => track.addEventListener('ended', stopOnEnd, { once: true }));

      state.captureActive = true;
      syncFollowButton();
      lowSignalFrames = 0;
      setStatus('capturing', audioTracks[0].label || 'loopback');
      api.sendSystemAudioState({ active: true, label: '系统音频 · 正在捕获' });
      visualizerCall('selectSource', ['system']);
      visualizerCall('play');
      pumpSystemAudio();
      capture.timer = setInterval(pumpSystemAudio, 1000 / 60);
      await finishSystemAudioPrompt();
    } catch (error) {
      const reason = error && error.name ? error.name : 'capture-failed';
      setStatus('raw', `${t('audioName')} · ${reason}`);
      api.sendSystemAudioState({ active: false, label: `系统音频 · ${reason}` });
    }
  }

  function pumpSystemAudio() {
    if (!capture || !capture.active) return;
    capture.analyser.getByteFrequencyData(capture.freq);
    const frame = bytesToFrame(capture.freq);
    if (frame.energy <= 0.13) lowSignalFrames += 1;
    else lowSignalFrames = 0;
    if (lowSignalFrames === 120) setStatus('waiting');
    api.sendSystemAudioFrame(frame);
  }

  function stopSystemAudio(stopVisualizer) {
    if (!capture) {
      api.sendSystemAudioState({ active: false, label: '系统音频 · 已停止' });
      setStatus('stopped');
      return;
    }

    capture.active = false;
    clearInterval(capture.timer);
    try {
      capture.source.disconnect();
      capture.sink.disconnect();
    } catch (_error) {}
    capture.stream.getTracks().forEach((track) => track.stop());
    capture.context.close().catch(() => {});
    capture = null;
    state.captureActive = false;
    syncFollowButton();
    setStatus('stopped');
    api.sendSystemAudioState({ active: false, label: '系统音频 · 已停止' });
    if (stopVisualizer !== false && state.source === 'system') visualizerCall('stop');
  }

  async function setVisualizerBounds(next) {
    const merged = await api.setVisualizerBounds(next);
    if (!merged) return;
    state.overlayShape = 'circle';
    state.overlaySize = merged.size;
    state.alwaysOnTop = merged.alwaysOnTop;
    state.fullScreen = Boolean(merged.fullScreen);
    state.transparent = Boolean(merged.transparent);
    syncWindowControls();
  }

  function bindSegmentedControls() {
    document.querySelectorAll('.segmented[data-control]').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (!button) return;
        const value = button.dataset.value;
        setActiveButton(group, value);

        switch (group.dataset.control) {
          case 'style':
            state.style = value;
            syncDetailControl();
            visualizerCall('setStyle', [value]);
            break;
          case 'sample-mode':
            api.setSampleMode(value).then(applyRemoteControlState).catch(() => {});
            break;
          case 'pattern-interval-preset':
            setPatternInterval(value, true);
            break;
          case 'light':
            visualizerCall('setParam', ['light', Number(value)]);
            break;
          case 'rotation-mode':
            visualizerCall('setRotationMode', [value]);
            break;
          case 'solid-shape':
            state.solidShape = value;
            visualizerCall('setSolidShape', [state.solidShape, state.faces, false]);
            break;
          default:
            break;
        }
      });
    });
  }

  function bindRange(id, formatter, onInput) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    const update = () => {
      const value = Number(input.value);
      output.value = formatter(value);
      output.textContent = formatter(value);
      setRangeFill(input);
      onInput(value);
    };
    input.addEventListener('input', update);
    update();
  }

  function bindToggle(id, name, initial) {
    const button = document.getElementById(id);
    let active = Boolean(initial);
    const render = () => setToggleButton(button, active);
    button.addEventListener('click', () => {
      active = !active;
      render();
      visualizerCall('setBoolean', [name, active]);
    });
    render();
  }

  function syncPatternIntervalControls() {
    const row = document.getElementById('pattern-interval-row');
    const presetGroup = document.querySelector('[data-control="pattern-interval-preset"]');
    if (row) row.hidden = state.sampleMode !== 'time';
    if (presetGroup) {
      presetGroup.querySelectorAll('button[data-value]').forEach((button) => {
        button.classList.toggle('active', Math.abs(Number(button.dataset.value) - state.patternInterval) < 1e-6);
      });
    }
  }

  function applyRemoteControlState(remoteState) {
    if (!remoteState) return;
    if (remoteState.sampleMode === 'beat' || remoteState.sampleMode === 'time') state.sampleMode = remoteState.sampleMode;
    if (remoteState.patternInterval != null) state.patternInterval = clampPatternInterval(remoteState.patternInterval);
    const sampleGroup = document.querySelector('[data-control="sample-mode"]');
    if (sampleGroup) setActiveButton(sampleGroup, state.sampleMode);
    document.getElementById('pattern-interval').value = formatPatternInterval(state.patternInterval);
    syncPatternIntervalControls();
  }

  function setPatternInterval(value, normalizeInput) {
    state.patternInterval = clampPatternInterval(value);
    if (normalizeInput) {
      document.getElementById('pattern-interval').value = formatPatternInterval(state.patternInterval);
    }
    syncPatternIntervalControls();
    api.setPatternInterval(state.patternInterval).then(applyRemoteControlState).catch(() => {});
  }

  function bindPatternIntervalInput() {
    const input = document.getElementById('pattern-interval');
    input.addEventListener('input', () => {
      if (input.value === '') return;
      setPatternInterval(input.value, false);
    });
    input.addEventListener('change', () => setPatternInterval(input.value, true));
    syncPatternIntervalControls();
  }

  function syncWindowControls() {
    document.getElementById('overlay-size').value = String(state.overlaySize);
    document.getElementById('overlay-size-value').textContent = String(state.overlaySize);
    setRangeFill(document.getElementById('overlay-size'));
    document.getElementById('always-on-top').checked = state.alwaysOnTop;
    setToggleButton(document.getElementById('toggle-fullscreen'), state.fullScreen);
    setToggleButton(document.getElementById('toggle-transparent'), state.transparent);
  }

  function applyRemoteState(remoteState) {
    if (!remoteState) return;
    state.overlayShape = 'circle';
    state.overlaySize = remoteState.size || state.overlaySize;
    state.alwaysOnTop = remoteState.alwaysOnTop !== false;
    state.fullScreen = Boolean(remoteState.fullScreen);
    state.transparent = Boolean(remoteState.transparent);

    syncWindowControls();
  }

  async function hydrateState() {
    const [remoteState, controlState, preferences] = await Promise.all([api.getState(), api.getControlState(), api.getPreferences()]);
    applyRemoteState(remoteState);
    applyRemoteControlState(controlState);
    state.systemAudioPromptSeen = Boolean(preferences && preferences.systemAudioPromptSeen);
    if (audioPromptEl) audioPromptEl.hidden = state.systemAudioPromptSeen;
  }

  function init() {
    hydrateState().catch(() => {});

    document.getElementById('show-visualizer').addEventListener('click', () => api.showVisualizer());
    document.getElementById('btn-dice').addEventListener('click', () => visualizerCall('randomizePattern'));
    document.getElementById('btn-save').addEventListener('click', () => visualizerCall('savePattern'));
    document.getElementById('btn-recall').addEventListener('click', () => visualizerCall('cyclePattern', [1]));
    document.getElementById('lang-toggle').addEventListener('click', () => applyLanguage(lang === 'zh' ? 'en' : 'zh'));
    document.getElementById('follow-toggle').addEventListener('click', () => {
      if (state.captureActive) stopSystemAudio(true);
      else startSystemAudio();
    });
    document.getElementById('btn-play').addEventListener('click', () => visualizerCall('play'));
    document.getElementById('btn-pause').addEventListener('click', () => visualizerCall('stop'));
    document.getElementById('start-system').addEventListener('click', startSystemAudio);
    document.getElementById('open-audio-settings').addEventListener('click', () => api.openSystemAudioSettings());

    document.getElementById('always-on-top').addEventListener('change', (event) => {
      setVisualizerBounds({ alwaysOnTop: event.target.checked });
    });
    document.getElementById('toggle-fullscreen').addEventListener('click', async () => {
      const merged = await api.setVisualizerFullScreen(!state.fullScreen);
      applyRemoteState(merged);
    });
    document.getElementById('toggle-transparent').addEventListener('click', () => {
      setVisualizerBounds({ transparent: !state.transparent });
    });

    bindSegmentedControls();
    bindPatternIntervalInput();
    bindToggle('toggle-symmetry', 'symmetry', false);
    bindToggle('toggle-frame', 'frame', false);
    bindToggle('toggle-rotation', 'rotation', true);

    bindRange('overlay-size', (value) => String(value), (value) => setVisualizerBounds({ size: value }));
    bindRange('detail', (value) => value.toFixed(2), (value) => {
      state.detailByStyle[state.style] = value;
      visualizerCall('setParam', ['detail', value]);
    });
    bindRange('particles', (value) => `${Math.round(value * 100)}%`, (value) => visualizerCall('setParam', ['particles', value]));
    syncZoomControl();   // seat the slider at the current view's zoom (3D→3) before binding, so the initial push doesn't reset it to the HTML default
    bindRange('zoom', formatZoom, (value) => {
      state.zoom3d = value;
      visualizerCall('setParam', ['zoom', value]);
    });
    bindRange('evolve', (value) => value.toFixed(2), (value) => visualizerCall('setParam', ['evolve', value]));
    bindRange('rotation-speed', (value) => value.toFixed(2), (value) => visualizerCall('setParam', ['rotationSpeed', value]));
    bindRange('faces', (value) => String(value), (value) => {
      state.faces = value;
      visualizerCall('setSolidShape', [state.solidShape, value, false]);
    });

    api.onCaptureRequest((payload) => {
      if (payload && payload.action === 'start') startSystemAudio();
      else if (payload && payload.action === 'stop') stopSystemAudio(true);
    });
    api.onVisualizerState(applyRemoteState);
    api.onControlState(applyRemoteControlState);

    try { lang = localStorage.getItem('sm-lang') || 'zh'; } catch (_error) { lang = 'zh'; }
    applyLanguage(lang);
  }

  init();
})();
