'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createClassList() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
      return values.has(name);
    },
    contains(name) { return values.has(name); }
  };
}

function baseSnapshot(style, forces, coverage, shapeRevision, shape) {
  return {
    version: 2,
    simulation: 'modal-3d',
    engine: style === 'sand' || style === 'dcosmic' ? 'dynamic' : 'classic',
    style,
    cosmic: style === 'cosmic' || style === 'dcosmic',
    energy: 0.7,
    excitation: [0.25, 0.5, 0.75],
    modeA: { l: 3, m: 2, n: 1, weight: 0.7 },
    modeB: { l: 2, m: 4, n: 3, weight: -0.3 },
    modeMix: 0.3,
    modeCoverage: coverage,
    forces: clone(forces),
    shapeRevision,
    shape: clone(shape),
    rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    zoom: 1.1,
    cameraDepth: 0.2,
    width: 640,
    height: 360,
    dpr: 1.5,
    aspect: 16 / 9,
    pointSize: 1.2,
    color: [0.5, 0.75, 1, 0.4],
    animate: false
  };
}

async function run() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'webgpu-integration.js'), 'utf8');
  const stage = { clientWidth: 640, clientHeight: 360, classList: createClassList() };
  const canvas = {
    clientWidth: 640,
    clientHeight: 360,
    width: 0,
    height: 0,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); }
  };
  const calls = {
    create: [],
    setShape: [],
    setParameters: [],
    renderFrame: [],
    resize: [],
    destroy: 0,
    subscribe: 0
  };
  let appliedShape = null;
  let framesSubmitted = 0;
  let currentSnapshot = baseSnapshot(
    'sand',
    { pointerStrength: 1, nodeStrength: 1, driftStrength: 0.25 },
    1,
    'regular:8:1',
    { type: 'convex', restitution: 0.58, planes: [
      [1, 0, 0, 0.58], [-1, 0, 0, 0.58],
      [0, 1, 0, 0.58], [0, -1, 0, 0.58]
    ] }
  );

  const backend = {
    getStatus() {
      return {
        state: 'ready',
        particleTier: '64k',
        particleCount: 65536,
        framesSubmitted,
        hasSubmittedFrame: framesSubmitted > 0,
        shape: appliedShape ? clone(appliedShape) : null,
        error: null
      };
    },
    subscribe(listener) {
      calls.subscribe += 1;
      listener(this.getStatus());
      return function unsubscribe() {};
    },
    resize(width, height, dpr) {
      calls.resize.push([width, height, dpr]);
      return true;
    },
    setShape(shape) {
      calls.setShape.push(clone(shape));
      appliedShape = clone(shape);
      return true;
    },
    setParameters(parameters) {
      calls.setParameters.push(clone(parameters));
      return true;
    },
    renderFrame(timestamp) {
      calls.renderFrame.push(timestamp);
      framesSubmitted += 1;
      return true;
    },
    destroy() { calls.destroy += 1; return true; }
  };
  const backendApi = {
    async create(target, options) {
      calls.create.push({ target, options: clone(Object.assign({}, options, { environment: undefined })) });
      return backend;
    }
  };

  let now = 1000;
  let nextAnimationId = 1;
  const animationFrames = new Map();
  let nextTimerId = 1;
  const timers = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const storage = new Map();
  const document = {
    hidden: false,
    getElementById(id) { return id === 'hero-webgpu' ? canvas : id === 'stage' ? stage : null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); }
  };
  const context = {
    console,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    RangeError,
    Date,
    document,
    performance: { now: () => now },
    devicePixelRatio: 2,
    SignalFieldWebGPUParticleBackend: backendApi,
    soundMotionGpuBridge: {
      allowed: true,
      disabledReason: null,
      snapshot() { return clone(currentSnapshot); }
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    dispatchEvent() { return true; },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    requestAnimationFrame(callback) {
      const id = nextAnimationId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  context.window = context;
  context.globalThis = context;

  function runNextAnimationFrame() {
    const entry = animationFrames.entries().next();
    assert.equal(entry.done, false, 'integration should schedule a frame after poke');
    const [id, callback] = entry.value;
    animationFrames.delete(id);
    now += 20;
    callback(now);
  }

  function pokeAndRender() {
    context.signalFieldGpuController.poke();
    runNextAnimationFrame();
  }

  vm.runInNewContext(source, context, { filename: 'webgpu-integration.js' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.create.length, 1);
  assert.equal(calls.subscribe, 1);
  assert.equal(calls.setShape.length, 1, 'the initial bridge shape must reach the backend');
  assert.deepEqual(calls.setShape[0], currentSnapshot.shape);
  assert.equal(calls.setParameters.length, 1);
  assert.equal(calls.renderFrame.length, 1);
  assert.equal(stage.classList.contains('gpu-enhanced'), true);
  assert.equal(canvas.attributes['aria-hidden'], 'true');
  assert.equal(context.signalFieldGpuController.state().shapeKind, appliedShape.type);

  const expectedProfiles = [
    { style: 'sand', pointerStrength: 1, nodeStrength: 1, driftStrength: 0.25 },
    { style: 'msand', pointerStrength: 0, nodeStrength: 0.72 * (0.65 + 0.35 * 0.5), driftStrength: 0.08 },
    { style: 'cosmic', pointerStrength: 0, nodeStrength: 0.68 * 0.65, driftStrength: 0.2 },
    { style: 'dcosmic', pointerStrength: 0.45, nodeStrength: 0.88 * (0.65 + 0.35 * 0.8), driftStrength: 1 }
  ];
  function assertForces(actual, expected) {
    assert.equal(actual.pointerStrength, expected.pointerStrength, expected.style + ' pointerStrength');
    assert.ok(Math.abs(actual.nodeStrength - expected.nodeStrength) < 1e-12, expected.style + ' nodeStrength');
    assert.equal(actual.driftStrength, expected.driftStrength, expected.style + ' driftStrength');
  }
  assertForces(calls.setParameters[0], expectedProfiles[0]);

  // A repeated revision is deliberately ignored even though another frame is submitted.
  runNextAnimationFrame();
  assert.equal(calls.setShape.length, 1, 'an unchanged shapeRevision must not upload again');
  assert.equal(calls.setParameters.length, 2);

  currentSnapshot = baseSnapshot(
    'msand',
    { pointerStrength: 0, nodeStrength: 0.72, driftStrength: 0.08 },
    0.5,
    'regular:20:1',
    { type: 'sphere', radius: 0.96, restitution: 0.52 }
  );
  pokeAndRender();
  assert.equal(calls.setShape.length, 2, 'a changed shapeRevision must upload the new shape');
  assert.deepEqual(calls.setShape[1], currentSnapshot.shape);
  assertForces(calls.setParameters.at(-1), expectedProfiles[1]);
  assert.equal(context.signalFieldGpuController.state().shapeKind, appliedShape.type, 'runtime shapeKind must match the backend-applied shape');

  currentSnapshot = baseSnapshot(
    'cosmic',
    { pointerStrength: 0, nodeStrength: 0.68, driftStrength: 0.2 },
    0,
    'regular:20:1',
    { type: 'sphere', radius: 0.96, restitution: 0.52 }
  );
  pokeAndRender();
  assert.equal(calls.setShape.length, 2, 'style updates with an unchanged revision must not upload shape data');
  assertForces(calls.setParameters.at(-1), expectedProfiles[2]);
  assert.equal(context.signalFieldGpuController.state().shapeKind, appliedShape.type);

  currentSnapshot = baseSnapshot(
    'dcosmic',
    { pointerStrength: 0.45, nodeStrength: 0.88, driftStrength: 1 },
    0.8,
    'fallback:cube',
    { type: 'cube', halfExtent: 0.8, restitution: 0.88 }
  );
  pokeAndRender();
  assert.equal(calls.setShape.length, 3);
  assert.deepEqual(calls.setShape[2], currentSnapshot.shape);
  assertForces(calls.setParameters.at(-1), expectedProfiles[3]);
  const runtime = context.signalFieldGpuController.state();
  assert.equal(runtime.actual, 'canvas+webgpu');
  assert.equal(runtime.status, 'ready');
  assert.equal(runtime.shapeKind, appliedShape.type);
  assert.equal(runtime.framesSubmitted, framesSubmitted);

  context.signalFieldGpuController.destroy();
  assert.equal(calls.destroy, 1);
  assert.equal(stage.classList.contains('gpu-enhanced'), false);

  console.log('PASS WebGPU integration shape revision dedupe, backend shape application, four-style force mapping, submitted runtime state, and cleanup');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
