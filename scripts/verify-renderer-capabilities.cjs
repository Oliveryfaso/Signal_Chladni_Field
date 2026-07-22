'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RendererCapabilities = require('../app/renderer-capabilities.js');

function webGl2(options) {
  const settings = options || {};
  const limits = {
    MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS: settings.interleaved == null ? 32 : settings.interleaved,
    MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS: settings.separate == null ? 4 : settings.separate,
    MAX_VARYING_COMPONENTS: settings.varyings == null ? 64 : settings.varyings
  };
  const gl = {
    MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS: 'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
    MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS: 'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
    MAX_VARYING_COMPONENTS: 'MAX_VARYING_COMPONENTS',
    getParameter: (constant) => limits[constant]
  };
  if (settings.transformFeedback !== false) {
    gl.createTransformFeedback = () => ({});
    gl.bindTransformFeedback = () => {};
    gl.beginTransformFeedback = () => {};
    gl.endTransformFeedback = () => {};
  }
  return gl;
}

function canvas(gl, has2d) {
  return {
    getContext(type) {
      if (type === 'webgl2') return gl || null;
      if (type === '2d') return has2d === false ? null : {};
      return null;
    }
  };
}

function environment(options) {
  const settings = options || {};
  return {
    isSecureContext: settings.secure !== false,
    navigator: { gpu: settings.gpu || null },
    document: { createElement: () => canvas(settings.gl, settings.has2d) }
  };
}

function adapter(options) {
  const settings = options || {};
  return {
    features: new Set(settings.features || ['shader-f16', 'timestamp-query']),
    limits: Object.assign({
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 128 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 512,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupStorageSize: 16384,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxBindGroups: 4
    }, settings.limits || {}),
    requestDevice: () => { throw new Error('Capability detection must not create a device.'); }
  };
}

async function run() {
  const capableAdapter = adapter();
  const fullEnvironment = environment({
    gpu: { requestAdapter: async () => capableAdapter },
    gl: webGl2()
  });
  const full = await RendererCapabilities.detectRendererCapabilities(fullEnvironment);
  const fullAgain = await RendererCapabilities.detectRendererCapabilities(fullEnvironment);
  assert.equal(full.schema, 'signal-field/renderer-capabilities');
  assert.equal(full.backend, 'webgpu');
  assert.equal(full.quality.tier, 'ultra');
  assert.equal(full.backends.webgpu.available, true);
  assert.deepEqual(full.backends.webgpu.features, ['shader-f16', 'timestamp-query']);
  assert.equal(full.backends.webgpu.deviceLoss.supported, true);
  assert.equal(JSON.stringify(full), JSON.stringify(fullAgain), 'capability snapshots should be deterministic');

  // Insecure contexts do not call WebGPU and fall back to usable WebGL2.
  let insecureCalls = 0;
  const insecure = await RendererCapabilities.detectRendererCapabilities(environment({
    secure: false,
    gpu: { requestAdapter: async () => { insecureCalls += 1; return capableAdapter; } },
    gl: webGl2()
  }));
  assert.equal(insecure.backend, 'webgl2');
  assert.equal(insecure.backends.webgpu.available, false);
  assert.ok(insecure.reasons.includes('webgpu-requires-secure-context'));
  assert.equal(insecureCalls, 0);

  // Null adapters, thrown adapters, and low limits all degrade rather than pretending WebGPU works.
  const nullAdapter = await RendererCapabilities.detectRendererCapabilities(environment({ gpu: { requestAdapter: async () => null }, gl: webGl2() }));
  assert.equal(nullAdapter.backend, 'webgl2');
  assert.ok(nullAdapter.reasons.includes('webgpu-adapter-unavailable'));
  const thrownAdapter = await RendererCapabilities.detectRendererCapabilities(environment({ gpu: { requestAdapter: async () => { throw new Error('denied'); } }, gl: null }));
  assert.equal(thrownAdapter.backend, 'canvas');
  assert.ok(thrownAdapter.reasons.includes('webgpu-request-adapter-failed'));
  const lowLimit = await RendererCapabilities.detectRendererCapabilities(environment({
    gpu: { requestAdapter: async () => adapter({ limits: { maxStorageBufferBindingSize: 512, maxComputeWorkgroupsPerDimension: 2 } }) },
    gl: webGl2()
  }));
  assert.equal(lowLimit.backends.webgpu.available, false);
  assert.equal(lowLimit.backend, 'webgl2');
  assert.ok(lowLimit.reasons.includes('webgpu-limit-storage-buffer-too-small'));
  assert.ok(lowLimit.reasons.includes('webgpu-limit-workgroups-too-small'));

  // A WebGL2 context without transform feedback is not usable for this particle path.
  const noTransformFeedback = await RendererCapabilities.detectRendererCapabilities(environment({ gpu: null, gl: webGl2({ transformFeedback: false }) }));
  assert.equal(noTransformFeedback.backends.webgl2.available, false);
  assert.equal(noTransformFeedback.backend, 'canvas');
  assert.ok(noTransformFeedback.reasons.includes('webgl2-transform-feedback-unavailable'));
  const unsupported = await RendererCapabilities.detectRendererCapabilities(environment({ gpu: null, gl: null, has2d: false }));
  assert.equal(unsupported.backend, 'unsupported');
  assert.equal(unsupported.quality.tier, 'none');
  assert.ok(unsupported.reasons.includes('no-supported-renderer-backend'));

  // Preferences guide selection, but never claim an unavailable requested backend is active.
  const canvasPreferred = await RendererCapabilities.detectRendererCapabilities(fullEnvironment, { preference: 'canvas' });
  assert.equal(canvasPreferred.backend, 'canvas');
  assert.equal(canvasPreferred.preferenceSatisfied, true);
  const unavailablePreferred = await RendererCapabilities.detectRendererCapabilities(environment({ gpu: null, gl: webGl2() }), { preference: 'webgpu' });
  assert.equal(unavailablePreferred.backend, 'webgl2');
  assert.equal(unavailablePreferred.preferenceSatisfied, false);
  assert.ok(unavailablePreferred.reasons.includes('preferred-backend-unavailable:webgpu'));
  const invalidPreference = await RendererCapabilities.detectRendererCapabilities(fullEnvironment, { preference: 'metal' });
  assert.equal(invalidPreference.preference, 'auto');
  assert.ok(invalidPreference.reasons.includes('invalid-renderer-preference'));

  // A store supports initial/null subscription, refresh, preference change, and device-loss observation without creating devices.
  const store = RendererCapabilities.createRendererCapabilityStore(fullEnvironment);
  const notifications = [];
  const unsubscribe = store.subscribe((snapshot) => notifications.push(snapshot));
  await store.refresh();
  assert.equal(store.getSnapshot().backend, 'webgpu');
  await store.setPreference('canvas');
  assert.equal(store.getSnapshot().backend, 'canvas');
  await store.setPreference('auto');
  await store.reportDeviceLost('mock-lost');
  assert.equal(store.getSnapshot().backends.webgpu.deviceLoss.status, 'lost');
  assert.equal(store.getSnapshot().backend, 'webgl2');
  assert.ok(store.getSnapshot().reasons.includes('webgpu-device-lost'));
  await store.clearDeviceLost();
  assert.equal(store.getSnapshot().backend, 'webgpu');
  let resolveLost;
  const observed = store.observeDeviceLoss({ lost: new Promise((resolve) => { resolveLost = resolve; }) });
  assert.equal(observed, true);
  resolveLost({ message: 'observed-loss' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.getSnapshot().backends.webgpu.deviceLoss.status, 'lost');
  assert.ok(notifications.length >= 6);
  unsubscribe();

  // Browser-global UMD path works independently of CommonJS.
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer-capabilities.js'), 'utf8');
  const browser = { console: console, JSON: JSON, Math: Math, Number: Number, String: String, Object: Object, Array: Array, Set: Set, Promise: Promise, Symbol: Symbol, TypeError: TypeError, RangeError: RangeError };
  browser.window = browser;
  browser.globalThis = browser;
  vm.runInNewContext(source, browser, { filename: 'renderer-capabilities.js' });
  assert.equal(typeof browser.SignalFieldRendererCapabilities.detectRendererCapabilities, 'function');
  assert.equal(browser.SignalFieldRendererCapabilities.VERSION, RendererCapabilities.VERSION);

  console.log('PASS renderer capability detection, deterministic fallback, limits, preferences, device-loss state, store, and UMD');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
