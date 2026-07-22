/*
 * Signal Field — progressive renderer capability shell
 *
 * This module selects a feasible rendering backend but deliberately does not
 * create a WebGPU device or any particle renderer. It is safe to load before
 * the visual engine and can be shared by Web and Electron UI surfaces.
 */
(function attachRendererCapabilities(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.SignalFieldRendererCapabilities = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRendererCapabilities() {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA = 'signal-field/renderer-capabilities';
  const SCHEMA_VERSION = 1;
  const PREFERENCES = ['auto', 'webgpu', 'webgl2', 'canvas'];
  const WEBGPU_LIMIT_NAMES = [
    'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupsPerDimension',
    'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize',
    'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ', 'maxBindGroups'
  ];
  const WEBGPU_MIN_STORAGE = 1024 * 1024;
  const WEBGPU_MIN_WORKGROUPS = 16;

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function finite(value, fallback) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function unique(values) {
    return values.filter(function onlyFirst(value, index) { return values.indexOf(value) === index; });
  }

  function normalizePreference(value) {
    return PREFERENCES.indexOf(value) >= 0 ? value : 'auto';
  }

  function looksLikeEnvironment(value) {
    return isPlainObject(value) && (
      Object.prototype.hasOwnProperty.call(value, 'navigator') ||
      Object.prototype.hasOwnProperty.call(value, 'document') ||
      Object.prototype.hasOwnProperty.call(value, 'isSecureContext') ||
      Object.prototype.hasOwnProperty.call(value, 'OffscreenCanvas')
    );
  }

  function resolveArguments(environmentOrOptions, maybeOptions) {
    if (looksLikeEnvironment(environmentOrOptions) || maybeOptions != null) {
      return { environment: environmentOrOptions || (typeof globalThis !== 'undefined' ? globalThis : {}), options: maybeOptions || {} };
    }
    return { environment: typeof globalThis !== 'undefined' ? globalThis : {}, options: environmentOrOptions || {} };
  }

  function selectedLimits(limits) {
    const source = limits && typeof limits === 'object' ? limits : {};
    const result = {};
    WEBGPU_LIMIT_NAMES.forEach(function readLimit(name) {
      const value = finite(source[name], NaN);
      result[name] = Number.isFinite(value) ? value : null;
    });
    return result;
  }

  function adapterFeatures(adapter) {
    if (!adapter || !adapter.features || typeof adapter.features[Symbol.iterator] !== 'function') return [];
    return Array.from(adapter.features).map(String).sort();
  }

  function emptyWebGpu(runtime) {
    return {
      available: false,
      adapter: null,
      features: [],
      limits: selectedLimits(null),
      deviceLoss: { supported: false, status: runtime && runtime.webgpuDeviceLost ? 'lost' : 'not-observed', reason: runtime && runtime.webgpuDeviceLost ? String(runtime.webgpuDeviceLost) : null },
      reasons: []
    };
  }

  async function inspectWebGpu(environment, options) {
    const settings = options || {};
    const runtime = settings.runtime || {};
    const secureContext = environment && environment.isSecureContext === true;
    const result = emptyWebGpu(runtime);
    const navigatorObject = environment && environment.navigator;
    const gpu = navigatorObject && navigatorObject.gpu;
    if (!secureContext) {
      result.reasons.push('webgpu-requires-secure-context');
      return result;
    }
    if (runtime.webgpuDeviceLost) {
      result.reasons.push('webgpu-device-lost');
      return result;
    }
    if (!gpu || typeof gpu.requestAdapter !== 'function') {
      result.reasons.push('webgpu-api-unavailable');
      return result;
    }
    let adapter;
    try {
      adapter = await gpu.requestAdapter(settings.webgpuAdapterOptions || undefined);
    } catch (_error) {
      result.reasons.push('webgpu-request-adapter-failed');
      return result;
    }
    if (!adapter) {
      result.reasons.push('webgpu-adapter-unavailable');
      return result;
    }
    result.adapter = { present: true };
    result.features = adapterFeatures(adapter);
    result.limits = selectedLimits(adapter.limits);
    result.deviceLoss.supported = typeof adapter.requestDevice === 'function';
    const storageLimit = result.limits.maxStorageBufferBindingSize;
    const workgroupLimit = result.limits.maxComputeWorkgroupsPerDimension;
    if (storageLimit != null && storageLimit < WEBGPU_MIN_STORAGE) result.reasons.push('webgpu-limit-storage-buffer-too-small');
    if (workgroupLimit != null && workgroupLimit < WEBGPU_MIN_WORKGROUPS) result.reasons.push('webgpu-limit-workgroups-too-small');
    result.available = result.reasons.length === 0;
    return result;
  }

  function createCanvas(environment, options) {
    const settings = options || {};
    if (typeof settings.createCanvas === 'function') {
      try { return settings.createCanvas(); } catch (_error) { return null; }
    }
    if (environment && typeof environment.OffscreenCanvas === 'function') {
      try { return new environment.OffscreenCanvas(1, 1); } catch (_error) {}
    }
    if (environment && environment.document && typeof environment.document.createElement === 'function') {
      try { return environment.document.createElement('canvas'); } catch (_error) {}
    }
    return null;
  }

  function emptyWebGl2() {
    return {
      available: false,
      transformFeedback: false,
      limits: { maxTransformFeedbackInterleavedComponents: null, maxTransformFeedbackSeparateAttribs: null, maxVaryingComponents: null },
      reasons: []
    };
  }

  function contextFor(canvas, type) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try { return canvas.getContext(type); } catch (_error) { return null; }
  }

  function queryGlLimit(gl, constantName) {
    if (!gl || typeof gl.getParameter !== 'function' || gl[constantName] == null) return null;
    try {
      const value = finite(gl.getParameter(gl[constantName]), NaN);
      return Number.isFinite(value) ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function inspectWebGl2(environment, options) {
    const result = emptyWebGl2();
    const canvas = createCanvas(environment, options);
    if (!canvas) {
      result.reasons.push('canvas-element-unavailable');
      return result;
    }
    const gl = contextFor(canvas, 'webgl2');
    if (!gl) {
      result.reasons.push('webgl2-context-unavailable');
      return result;
    }
    result.limits = {
      maxTransformFeedbackInterleavedComponents: queryGlLimit(gl, 'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS'),
      maxTransformFeedbackSeparateAttribs: queryGlLimit(gl, 'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS'),
      maxVaryingComponents: queryGlLimit(gl, 'MAX_VARYING_COMPONENTS')
    };
    result.transformFeedback = ['createTransformFeedback', 'bindTransformFeedback', 'beginTransformFeedback', 'endTransformFeedback'].every(function hasMethod(name) {
      return typeof gl[name] === 'function';
    });
    if (!result.transformFeedback) result.reasons.push('webgl2-transform-feedback-unavailable');
    if (result.limits.maxTransformFeedbackInterleavedComponents != null && result.limits.maxTransformFeedbackInterleavedComponents < 4) {
      result.reasons.push('webgl2-transform-feedback-limit-too-small');
    }
    result.available = result.reasons.length === 0;
    return result;
  }

  function inspectCanvas(environment, options) {
    const canvas = createCanvas(environment, options);
    const context = contextFor(canvas, '2d');
    return {
      available: Boolean(context),
      reasons: context ? [] : ['canvas2d-context-unavailable']
    };
  }

  function qualityFor(backend, backends) {
    if (backend === 'webgpu') {
      const limits = backends.webgpu.limits;
      const storage = limits.maxStorageBufferBindingSize || 0;
      const workgroups = limits.maxComputeWorkgroupsPerDimension || 0;
      if (storage >= 64 * 1024 * 1024 && workgroups >= 256) return { tier: 'ultra', particleBudget: 1000000, resolutionScale: 1, targetFps: 60 };
      if (storage >= 16 * 1024 * 1024 || workgroups >= 128) return { tier: 'high', particleBudget: 450000, resolutionScale: 1, targetFps: 60 };
      return { tier: 'standard', particleBudget: 180000, resolutionScale: 0.9, targetFps: 60 };
    }
    if (backend === 'webgl2') {
      const interleaved = backends.webgl2.limits.maxTransformFeedbackInterleavedComponents || 0;
      if (interleaved >= 32) return { tier: 'high', particleBudget: 220000, resolutionScale: 1, targetFps: 60 };
      return { tier: 'standard', particleBudget: 90000, resolutionScale: 0.85, targetFps: 60 };
    }
    if (backend === 'canvas') return { tier: 'fallback', particleBudget: 24000, resolutionScale: 0.75, targetFps: 45 };
    return { tier: 'none', particleBudget: 0, resolutionScale: 0, targetFps: 0 };
  }

  function chooseBackend(backends, preference) {
    const available = {
      webgpu: Boolean(backends.webgpu.available),
      webgl2: Boolean(backends.webgl2.available),
      canvas: Boolean(backends.canvas.available)
    };
    const order = preference === 'auto' ? ['webgpu', 'webgl2', 'canvas'] : [preference, 'webgpu', 'webgl2', 'canvas'];
    const candidates = unique(order);
    const selected = candidates.find(function usable(name) { return available[name]; }) || 'unsupported';
    return { backend: selected, preferenceSatisfied: preference === 'auto' || selected === preference };
  }

  /**
   * Return a stable, serialisable capability snapshot. `env` can be a browser
   * global-like object; if omitted, the real global environment is used.
   */
  async function detectRendererCapabilities(environmentOrOptions, maybeOptions) {
    const resolved = resolveArguments(environmentOrOptions, maybeOptions);
    const environment = resolved.environment || {};
    const options = isPlainObject(resolved.options) ? resolved.options : {};
    const originalPreference = options.preference == null ? 'auto' : options.preference;
    const preference = normalizePreference(originalPreference);
    const webgpu = await inspectWebGpu(environment, options);
    const webgl2 = inspectWebGl2(environment, options);
    const canvas = inspectCanvas(environment, options);
    const backends = { webgpu: webgpu, webgl2: webgl2, canvas: canvas };
    const choice = chooseBackend(backends, preference);
    const reasons = [];
    if (preference !== originalPreference) reasons.push('invalid-renderer-preference');
    if (preference !== 'auto' && !choice.preferenceSatisfied) reasons.push('preferred-backend-unavailable:' + preference);
    if (choice.backend === 'unsupported') reasons.push('no-supported-renderer-backend');
    if (choice.backend !== 'webgpu' && !webgpu.available) reasons.push.apply(reasons, webgpu.reasons);
    if (choice.backend !== 'webgl2' && !webgl2.available) reasons.push.apply(reasons, webgl2.reasons);
    if (choice.backend !== 'canvas' && !canvas.available) reasons.push.apply(reasons, canvas.reasons);
    return {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      secureContext: environment.isSecureContext === true,
      preference: preference,
      preferenceSatisfied: choice.preferenceSatisfied,
      backend: choice.backend,
      quality: qualityFor(choice.backend, backends),
      reasons: unique(reasons),
      backends: backends
    };
  }

  function RendererCapabilityStore(environment, options) {
    this._environment = environment || (typeof globalThis !== 'undefined' ? globalThis : {});
    this._options = isPlainObject(options) ? Object.assign({}, options) : {};
    this._runtime = { webgpuDeviceLost: null };
    this._snapshot = null;
    this._listeners = new Set();
    this._lossToken = 0;
  }

  RendererCapabilityStore.prototype.getSnapshot = function getSnapshot() {
    return this._snapshot ? clone(this._snapshot) : null;
  };

  RendererCapabilityStore.prototype.subscribe = function subscribe(listener, options) {
    if (typeof listener !== 'function') throw new TypeError('Capability listener must be a function.');
    this._listeners.add(listener);
    if (!options || options.emitCurrent !== false) listener(this.getSnapshot());
    const store = this;
    return function unsubscribe() { store._listeners.delete(listener); };
  };

  RendererCapabilityStore.prototype._emit = function emit() {
    const snapshot = this.getSnapshot();
    this._listeners.forEach(function notify(listener) { listener(snapshot); });
  };

  RendererCapabilityStore.prototype.setPreference = function setPreference(preference) {
    this._options.preference = preference;
    return this.refresh();
  };

  RendererCapabilityStore.prototype.refresh = async function refresh(options) {
    if (isPlainObject(options)) this._options = Object.assign({}, this._options, options);
    const settings = Object.assign({}, this._options, { runtime: clone(this._runtime) });
    this._snapshot = await detectRendererCapabilities(this._environment, settings);
    this._emit();
    return this.getSnapshot();
  };

  /**
   * Observe an already-created device. This module never calls requestDevice;
   * the host may attach a device later so a loss can trigger a normal refresh.
   */
  RendererCapabilityStore.prototype.observeDeviceLoss = function observeDeviceLoss(device) {
    if (!device || !device.lost || typeof device.lost.then !== 'function') return false;
    const token = ++this._lossToken;
    const store = this;
    Promise.resolve(device.lost).then(function deviceLost(info) {
      if (token !== store._lossToken) return;
      store.reportDeviceLost(info && (info.message || info.reason || info.toString && info.toString()));
    }, function deviceLossRejected(error) {
      if (token !== store._lossToken) return;
      store.reportDeviceLost(error && error.message ? error.message : 'device-loss-observer-rejected');
    });
    return true;
  };

  RendererCapabilityStore.prototype.reportDeviceLost = function reportDeviceLost(reason) {
    this._runtime.webgpuDeviceLost = String(reason || 'device-lost').slice(0, 160);
    return this.refresh();
  };

  RendererCapabilityStore.prototype.clearDeviceLost = function clearDeviceLost() {
    this._runtime.webgpuDeviceLost = null;
    return this.refresh();
  };

  return {
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    PREFERENCES: PREFERENCES.slice(),
    detectRendererCapabilities: detectRendererCapabilities,
    RendererCapabilityStore: RendererCapabilityStore,
    createRendererCapabilityStore: function createRendererCapabilityStore(environment, options) {
      return new RendererCapabilityStore(environment, options);
    }
  };
}));
