/* Signal Field — progressive WebGPU compute enhancement for the retained Canvas engine. */
(function mountSignalFieldWebGPU(globalScope) {
  'use strict';

  const backendApi = globalScope.SignalFieldWebGPUParticleBackend;
  const bridge = globalScope.soundMotionGpuBridge;
  const canvas = globalScope.document && globalScope.document.getElementById('hero-webgpu');
  const stage = globalScope.document && globalScope.document.getElementById('stage');
  if (!backendApi || !bridge || !canvas || !stage) return;

  const listeners = new Set();
  let backend = null;
  let backendUnsubscribe = null;
  let animationFrame = null;
  let idleMonitor = null;
  let generation = 0;
  let enabled = bridge.allowed !== false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;
  let lastShapeRevision = null;
  let lastSubmitTime = 0;
  let state = {
    schema: 'signal-field/renderer-runtime', version: 2,
    requested: enabled ? 'auto' : 'canvas', recommended: null,
    actual: 'canvas', status: enabled ? 'initializing' : 'disabled',
    simulation: enabled ? 'modal-3d-pending' : 'canvas-baseline', modePair: null, shapeKind: null,
    quality: 'canvas', particleCount: 0, framesSubmitted: 0,
    fallbackReason: enabled ? null : (bridge.disabledReason || 'canvas-locked')
  };

  function copyState() { return JSON.parse(JSON.stringify(state)); }
  function emit() {
    const snapshot = copyState();
    listeners.forEach(function notify(listener) { try { listener(snapshot); } catch (_error) {} });
    globalScope.dispatchEvent(new CustomEvent('signalfield:renderer-state', { detail: snapshot }));
  }
  function update(patch) { state = Object.assign({}, state, patch); emit(); }
  function showGpu(active) {
    stage.classList.toggle('gpu-enhanced', Boolean(active));
    canvas.setAttribute('aria-hidden', 'true');
  }
  function stopLoop() {
    if (animationFrame != null) globalScope.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (idleMonitor != null) globalScope.clearTimeout(idleMonitor);
    idleMonitor = null;
  }
  function scheduleIdleMonitor() {
    if (idleMonitor != null || !enabled || !backend || globalScope.document.hidden) return;
    idleMonitor = globalScope.setTimeout(function checkHostAnimation() {
      idleMonitor = null;
      if (bridge.snapshot().animate) poke();
      else scheduleIdleMonitor();
    }, 250);
  }
  function disposeBackend() {
    stopLoop();
    if (backendUnsubscribe) backendUnsubscribe();
    backendUnsubscribe = null;
    if (backend) backend.destroy();
    backend = null;
    lastSubmitTime = 0;
    lastShapeRevision = null;
    showGpu(false);
  }
  function bounded(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }
  function integer(value, fallback) { return Math.round(bounded(value, 1, 16, fallback)); }
  function mode(snapshotMode, fallback) {
    const source = snapshotMode && typeof snapshotMode === 'object' ? snapshotMode : fallback;
    return {
      l: integer(source.l, fallback.l),
      m: integer(source.m, fallback.m),
      n: integer(source.n, fallback.n),
      weight: bounded(source.weight, -1, 1, fallback.weight)
    };
  }
  function safeRotation(value) {
    if (!Array.isArray(value) || value.length !== 9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const rotation = value.map(Number);
    return rotation.every(Number.isFinite) ? rotation : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  function parametersFromSnapshot(snapshot) {
    const excitation = Array.isArray(snapshot.excitation) ? snapshot.excitation : [0.5, 0.5, 0.5];
    const modeA = mode(snapshot.modeA, { l: 1, m: 1, n: 2, weight: 1 });
    const modeB = mode(snapshot.modeB, { l: 1, m: 2, n: 2, weight: 0 });
    const forces = snapshot.forces && typeof snapshot.forces === 'object' ? snapshot.forces : {};
    return {
      energy: bounded(snapshot.energy, 0, 4, 0.35),
      damping: snapshot.cosmic ? 0.018 : 0.034,
      pointerX: bounded(excitation[0] * 2 - 1, -1, 1, 0),
      pointerY: bounded(excitation[1] * 2 - 1, -1, 1, 0),
      pointerZ: bounded(excitation[2] * 2 - 1, -1, 1, 0),
      modeM: modeA.l, modeN: modeA.m, modeP: modeA.n,
      modeM2: modeB.l, modeN2: modeB.m, modeP2: modeB.n,
      modeMix: bounded(snapshot.modeMix, 0, 1, Math.abs(modeB.weight)),
      modeWeightA: modeA.weight < 0 ? -1 : 1,
      modeWeightB: modeB.weight < 0 ? -1 : 1,
      aspect: bounded(snapshot.aspect, 0.25, 4, 1.3125),
      depthAspect: 1,
      pointSize: bounded(snapshot.pointSize, 0.5, 12, 1.25),
      rotationMatrix: safeRotation(snapshot.rotationMatrix),
      zoom: bounded(snapshot.zoom, 0.1, 8, 1),
      perspective: bounded(snapshot.cameraDepth, 0, 1.5, 0),
      pointerStrength: bounded(forces.pointerStrength, 0, 4, 1),
      nodeStrength: bounded(forces.nodeStrength, 0, 4, 1) * (0.65 + 0.35 * bounded(snapshot.modeCoverage, 0, 1, 1)),
      driftStrength: bounded(forces.driftStrength, 0, 4, 1),
      color: snapshot.color,
      backgroundColor: [0, 0, 0, 0]
    };
  }
  function syncSize(snapshot) {
    const width = Math.max(1, Number(snapshot.width) || stage.clientWidth || 1);
    const height = Math.max(1, Number(snapshot.height) || stage.clientHeight || 1);
    const dpr = bounded(snapshot.dpr, 0.5, 3, globalScope.devicePixelRatio || 1);
    if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
    lastWidth = width; lastHeight = height; lastDpr = dpr;
    backend.resize(width, height, dpr);
  }
  function syncShape(snapshot) {
    if (!backend || typeof backend.setShape !== 'function' || !snapshot.shape) return;
    const revision = String(snapshot.shapeRevision || JSON.stringify(snapshot.shape));
    if (revision === lastShapeRevision) return;
    backend.setShape(snapshot.shape);
    lastShapeRevision = revision;
  }
  function fallBack(reason, status) {
    showGpu(false);
    update({
      actual: 'canvas', status: status || 'fallback', quality: 'canvas',
      simulation: 'canvas-baseline', modePair: null, shapeKind: null,
      particleCount: 0, fallbackReason: reason || 'webgpu-unavailable'
    });
  }
  function render(timestamp, scheduleNext) {
    animationFrame = null;
    if (!enabled || !backend || globalScope.document.hidden) return;
    const snapshot = bridge.snapshot();
    const wallTime = globalScope.performance.now();
    if (scheduleNext && snapshot.animate && lastSubmitTime && wallTime - lastSubmitTime < 15) {
      animationFrame = globalScope.requestAnimationFrame(function throttledFrame(nextTimestamp) { render(nextTimestamp, true); });
      return;
    }
    try {
      syncSize(snapshot);
      syncShape(snapshot);
      backend.setParameters(parametersFromSnapshot(snapshot));
      const submitted = backend.renderFrame(timestamp);
      const backendState = backend.getStatus();
      if (!submitted || !backendState.hasSubmittedFrame) {
        if (backendState.state === 'lost' || backendState.state === 'error') fallBack(backendState.error && backendState.error.code, backendState.state);
        return;
      }
      lastSubmitTime = wallTime;
      showGpu(true);
      const firstActiveFrame = state.actual !== 'canvas+webgpu' || state.status !== 'ready';
      const modeA = snapshot.modeA || { l: 1, m: 1, n: 2 };
      const modeB = snapshot.modeB || { l: 1, m: 2, n: 2 };
      state = Object.assign({}, state, {
        actual: 'canvas+webgpu', status: 'ready', quality: backendState.particleTier,
        simulation: 'modal-3d',
        modePair: `(${modeA.l},${modeA.m},${modeA.n}) + (${modeB.l},${modeB.m},${modeB.n})`,
        shapeKind: backendState.shape && backendState.shape.type || snapshot.shape && snapshot.shape.type || 'cube',
        particleCount: backendState.particleCount,
        framesSubmitted: backendState.framesSubmitted,
        fallbackReason: null
      });
      if (firstActiveFrame) emit();
      if (scheduleNext && snapshot.animate && !animationFrame) animationFrame = globalScope.requestAnimationFrame(function nextFrame(nextTimestamp) { render(nextTimestamp, true); });
      else if (scheduleNext && !snapshot.animate) scheduleIdleMonitor();
    } catch (error) {
      fallBack(String(error && error.message || error || 'webgpu-frame-failed'), 'fallback');
      disposeBackend();
    }
  }
  function poke() {
    if (!enabled || !backend || animationFrame != null) return;
    if (idleMonitor != null) globalScope.clearTimeout(idleMonitor);
    idleMonitor = null;
    animationFrame = globalScope.requestAnimationFrame(function oneFrame(timestamp) { render(timestamp, true); });
  }
  async function initialize() {
    const token = ++generation;
    disposeBackend();
    if (!enabled || bridge.allowed === false) {
      fallBack(bridge.disabledReason || 'canvas-locked', 'disabled');
      return copyState();
    }
    update({ actual: 'canvas', status: 'initializing', simulation: 'modal-3d-pending', modePair: null, shapeKind: null, particleCount: 0, framesSubmitted: 0, fallbackReason: null });
    let created;
    try {
      const initialSnapshot = bridge.snapshot();
      created = await backendApi.create(canvas, {
        environment: globalScope,
        particleTier: 'adaptive',
        autoStart: false,
        alphaMode: 'premultiplied',
        seed: 20260722,
        shape: initialSnapshot.shape,
        parameters: Object.assign(parametersFromSnapshot(initialSnapshot), { backgroundColor: [0, 0, 0, 0] })
      });
    } catch (error) {
      if (token === generation) fallBack(String(error && error.message || error), 'fallback');
      return copyState();
    }
    if (token !== generation || !enabled) { created.destroy(); return copyState(); }
    backend = created;
    const createdState = backend.getStatus();
    if (createdState.state !== 'ready') {
      fallBack(createdState.error && createdState.error.code, createdState.state === 'unsupported' ? 'fallback' : createdState.state);
      backend.destroy();
      backend = null;
      return copyState();
    }
    backendUnsubscribe = backend.subscribe(function onBackendState(next) {
      if (next.state === 'lost' || next.state === 'error') fallBack(next.error && next.error.code, next.state);
    });
    render(globalScope.performance.now(), false);
    // Always schedule one post-initialisation frame. The host may finish its
    // initial prime immediately after this module mounts; that frame then
    // observes the final animation state and continues only when appropriate.
    poke();
    return copyState();
  }
  function setEnabled(next) {
    enabled = Boolean(next) && bridge.allowed !== false;
    try { globalScope.localStorage.setItem('signalFieldRendererPreference', enabled ? 'auto' : 'canvas'); } catch (_error) {}
    if (!enabled) {
      generation += 1;
      disposeBackend();
      update({ requested: 'canvas', actual: 'canvas', status: 'disabled', simulation: 'canvas-baseline', modePair: null, shapeKind: null, quality: 'canvas', particleCount: 0, framesSubmitted: 0, fallbackReason: 'user-selected-canvas' });
      return Promise.resolve(copyState());
    }
    update({ requested: 'auto' });
    return initialize();
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Renderer listener must be a function.');
    listeners.add(listener); listener(copyState());
    return function unsubscribe() { listeners.delete(listener); };
  }

  globalScope.document.addEventListener('input', poke, true);
  globalScope.document.addEventListener('change', poke, true);
  globalScope.document.addEventListener('click', poke, true);
  globalScope.document.addEventListener('visibilitychange', function visibilityChanged() { if (globalScope.document.hidden) stopLoop(); else poke(); });
  globalScope.addEventListener('resize', poke);
  globalScope.addEventListener('beforeunload', disposeBackend, { once: true });

  globalScope.signalFieldGpuController = {
    state: copyState,
    subscribe: subscribe,
    enable: function enable() { return setEnabled(true); },
    disable: function disable() { return setEnabled(false); },
    retry: initialize,
    poke: poke,
    destroy: function destroy() { generation += 1; disposeBackend(); }
  };

  let storedCanvasPreference = false;
  try { storedCanvasPreference = globalScope.localStorage.getItem('signalFieldRendererPreference') === 'canvas'; } catch (_error) {}
  if (storedCanvasPreference && bridge.allowed !== false) {
    enabled = false;
    update({ requested: 'canvas', actual: 'canvas', status: 'disabled', quality: 'canvas', particleCount: 0, framesSubmitted: 0, fallbackReason: 'user-selected-canvas' });
  } else {
    initialize();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
