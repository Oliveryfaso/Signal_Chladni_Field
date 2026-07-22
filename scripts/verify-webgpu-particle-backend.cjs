'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Backend = require('../app/webgpu-particle-backend.js');

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function createMockRuntime(options) {
  const settings = options || {};
  const calls = {
    buffers: [], shaders: [], bindGroups: [], writes: [], submissions: [],
    computeFrames: [], renderFrames: [], configure: [], unconfigure: 0,
    requestAdapter: 0, requestDevice: 0, deviceDestroy: 0, scheduledFrames: [], cancelledFrames: []
  };
  const lost = deferred();
  const limits = Object.assign({
    maxStorageBufferBindingSize: 32 * 1024 * 1024,
    maxBufferSize: 32 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: 65535,
    maxComputeInvocationsPerWorkgroup: 256
  }, settings.limits || {});
  let bufferSequence = 0;

  const device = {
    limits,
    lost: lost.promise,
    queue: {
      writeBuffer(buffer, offset, data) {
        calls.writes.push({ buffer, offset, data: data instanceof Float32Array ? new Float32Array(data) : data });
      },
      submit(commands) { calls.submissions.push(commands); }
    },
    createBuffer(descriptor) {
      const buffer = {
        id: 'buffer-' + (++bufferSequence),
        descriptor,
        destroyed: false,
        destroy() { this.destroyed = true; }
      };
      calls.buffers.push(buffer);
      return buffer;
    },
    createShaderModule(descriptor) {
      calls.shaders.push(descriptor);
      return { descriptor };
    },
    createComputePipeline(descriptor) {
      calls.computePipeline = descriptor;
      return { descriptor, getBindGroupLayout: () => ({ type: 'compute-layout' }) };
    },
    createRenderPipeline(descriptor) {
      calls.renderPipeline = descriptor;
      return { descriptor, getBindGroupLayout: () => ({ type: 'render-layout' }) };
    },
    createBindGroup(descriptor) {
      const bindGroup = { id: 'bind-group-' + calls.bindGroups.length, descriptor };
      calls.bindGroups.push(bindGroup);
      return bindGroup;
    },
    createCommandEncoder() {
      const frame = { compute: {}, render: {} };
      return {
        beginComputePass() {
          return {
            setPipeline(pipeline) { frame.compute.pipeline = pipeline; },
            setBindGroup(index, bindGroup) { frame.compute.bindGroup = bindGroup; frame.compute.bindGroupIndex = index; },
            dispatchWorkgroups(count) { frame.compute.workgroups = count; },
            end() { calls.computeFrames.push(frame.compute); }
          };
        },
        beginRenderPass(descriptor) {
          frame.render.descriptor = descriptor;
          return {
            setPipeline(pipeline) { frame.render.pipeline = pipeline; },
            setBindGroup(index, bindGroup) { frame.render.bindGroup = bindGroup; frame.render.bindGroupIndex = index; },
            draw(vertices, instances, firstVertex, firstInstance) {
              frame.render.draw = [vertices, instances, firstVertex, firstInstance];
            },
            end() { calls.renderFrames.push(frame.render); }
          };
        },
        finish() { return { frame }; }
      };
    },
    destroy() { calls.deviceDestroy += 1; }
  };
  const adapter = {
    limits,
    async requestDevice() { calls.requestDevice += 1; return device; }
  };
  const gpu = {
    async requestAdapter() { calls.requestAdapter += 1; return settings.nullAdapter ? null : adapter; },
    getPreferredCanvasFormat() { return 'bgra8unorm'; }
  };
  const context = {
    configure(descriptor) { calls.configure.push(descriptor); },
    unconfigure() { calls.unconfigure += 1; },
    getCurrentTexture() { return { createView: () => ({ type: 'texture-view' }) }; }
  };
  const canvas = {
    clientWidth: 640,
    clientHeight: 360,
    width: 0,
    height: 0,
    getContext(type) { return type === 'webgpu' && settings.hasContext !== false ? context : null; }
  };
  const environment = {
    navigator: { gpu },
    devicePixelRatio: 2,
    performance: { now: () => 1000 },
    requestAnimationFrame(callback) {
      const handle = calls.scheduledFrames.length + 1;
      calls.scheduledFrames.push({ handle, callback });
      return handle;
    },
    cancelAnimationFrame(handle) { calls.cancelledFrames.push(handle); },
    GPUBufferUsage: { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
  };
  return { calls, lost, limits, device, adapter, gpu, context, canvas, environment };
}

function bufferEntry(bindGroup, binding) {
  return bindGroup.descriptor.entries.find((entry) => entry.binding === binding).resource.buffer;
}

async function run() {
  assert.equal(Backend.SCHEMA, 'signal-field/webgpu-particle-backend');
  assert.equal(Backend.WORKGROUP_SIZE, 256);
  assert.equal(Backend.PARTICLE_STRIDE, 32);
  assert.equal(Backend.UNIFORM_BYTES, 160);
  assert.equal(Backend.MAX_SHAPE_PLANES, 32);
  assert.equal(Backend.SHAPE_BYTES, 528);
  assert.match(Backend.COMPUTE_WGSL, /@compute @workgroup_size\(256\)/);
  assert.match(Backend.COMPUTE_WGSL, /var<storage, read_write> targetParticles/);
  assert.match(Backend.COMPUTE_WGSL, /particle\.position\.xyz/);
  assert.match(Backend.COMPUTE_WGSL, /particle\.velocity\.xyz/);
  assert.match(Backend.COMPUTE_WGSL, /fn phi3\(mode: vec3f, uv: vec3f\)/);
  assert.match(Backend.COMPUTE_WGSL, /sin\(PI \* mode\.y \* uv\.x\).*sin\(PI \* mode\.z \* uv\.y\).*sin\(PI \* mode\.x \* uv\.z\)/s);
  assert.match(Backend.COMPUTE_WGSL, /fieldA = phi3\(modeA, uv\)/);
  assert.match(Backend.COMPUTE_WGSL, /fieldB = phi3\(modeB, uv\)/);
  assert.match(Backend.COMPUTE_WGSL, /weightA = \(1\.0 - modeMix\) \* uniforms\.modeA\.w/);
  assert.match(Backend.COMPUTE_WGSL, /weightB = modeMix \* uniforms\.modeB\.w/);
  assert.match(Backend.COMPUTE_WGSL, /fieldValue = weightA \* fieldA \+ weightB \* fieldB/);
  assert.match(Backend.COMPUTE_WGSL, /nodeForce = -2\.0 \* fieldValue \* fieldGradient/);
  assert.match(Backend.COMPUTE_WGSL, /pointer = uniforms\.excitation\.xyz/);
  assert.match(Backend.COMPUTE_WGSL, /struct ShapeData/);
  assert.match(Backend.COMPUTE_WGSL, /planes: array<vec4f, 32>/);
  assert.match(Backend.COMPUTE_WGSL, /@binding\(3\) var<storage, read> shape: ShapeData/);
  assert.match(Backend.COMPUTE_WGSL, /fn confineToShape/);
  assert.match(Backend.COMPUTE_WGSL, /kind == 1u/);
  assert.match(Backend.COMPUTE_WGSL, /kind == 2u/);
  assert.match(Backend.COMPUTE_WGSL, /dot\(plane\.xyz, position\) - plane\.w/);
  assert.match(Backend.COMPUTE_WGSL, /finitePosition/);
  assert.match(Backend.COMPUTE_WGSL, /stillOutside/);
  assert.match(Backend.COMPUTE_WGSL, /pointerForce.*uniforms\.viewport\.w/);
  assert.match(Backend.COMPUTE_WGSL, /nodeForce.*uniforms\.cameraRow0\.w/);
  assert.match(Backend.COMPUTE_WGSL, /drift.*uniforms\.cameraRow1\.w/);
  assert.match(Backend.RENDER_WGSL, /@vertex/);
  assert.match(Backend.RENDER_WGSL, /@fragment/);
  assert.match(Backend.RENDER_WGSL, /cameraRow0\.xyz/);
  assert.match(Backend.RENDER_WGSL, /2\.4 - cameraDepth \+ cameraPosition\.z \* 0\.5/);
  assert.match(Backend.RENDER_WGSL, /cameraPosition\.x \* focal \/ \(viewport\.x \* denominator\)/);
  assert.match(Backend.RENDER_WGSL, /-cameraPosition\.y \* focal \/ \(viewport\.y \* denominator\)/);
  assert.match(Backend.RENDER_WGSL, /cameraPosition\.z/);
  assert.match(Backend.RENDER_WGSL, /clipDepth = clamp\(0\.5 \+ cameraPosition\.z \* 0\.18, 0\.02, 0\.98\)/);

  const rotation = Backend.rotationMatrixFromEuler(-0.2, 0.45, 0.1);
  assert.equal(rotation.length, 9);
  const determinant =
    rotation[0] * (rotation[4] * rotation[8] - rotation[5] * rotation[7]) -
    rotation[1] * (rotation[3] * rotation[8] - rotation[5] * rotation[6]) +
    rotation[2] * (rotation[3] * rotation[7] - rotation[4] * rotation[6]);
  assert.ok(Math.abs(determinant - 1) < 1e-10);

  assert.equal(Backend.resolveParticleCount('64k', {}), 65536);
  assert.equal(Backend.resolveParticleCount('128k', {}), 131072);
  assert.equal(Backend.resolveParticleCount('adaptive', {
    maxStorageBufferBindingSize: 3 * 1024 * 1024,
    maxBufferSize: 3 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: 65535,
    maxComputeInvocationsPerWorkgroup: 256
  }), 65536);
  assert.throws(() => Backend.resolveParticleCount('128k', {
    maxStorageBufferBindingSize: 2 * 1024 * 1024,
    maxBufferSize: 2 * 1024 * 1024,
    maxComputeWorkgroupsPerDimension: 65535,
    maxComputeInvocationsPerWorkgroup: 256
  }), /exceeds/);
  assert.throws(() => Backend.resolveParticleCount('huge', {}), /particleTier/);

  // Missing WebGPU degrades to a no-op controller and never asks for a canvas context.
  let fallbackContextCalls = 0;
  const fallbackCanvas = { getContext() { fallbackContextCalls += 1; return null; }, width: 9, height: 7 };
  const fallback = await Backend.create(fallbackCanvas, { environment: {} });
  assert.equal(fallback.getStatus().state, 'unsupported');
  assert.equal(fallback.getStatus().available, false);
  assert.equal(fallback.getStatus().error.code, 'webgpu-unavailable');
  assert.equal(fallback.start(), false);
  assert.equal(fallback.renderFrame(0), false);
  assert.equal(fallbackContextCalls, 0);
  assert.equal(fallbackCanvas.width, 9);
  assert.equal(fallbackCanvas.height, 7);

  const runtime = createMockRuntime();
  const controller = await Backend.create(runtime.canvas, {
    environment: runtime.environment,
    particleTier: '64k',
    autoStart: false,
    seed: 42,
    parameters: { modeM: 5, modeN: 2, energy: 1.1 }
  });
  assert.equal(controller.getStatus().state, 'ready');
  assert.equal(controller.getStatus().initialized, true);
  assert.equal(controller.getStatus().active, false, 'pipeline readiness must not be presented as an active renderer');
  assert.equal(controller.getStatus().hasSubmittedFrame, false);
  assert.equal(controller.getStatus().framesSubmitted, 0);
  assert.equal(controller.getStatus().particleCount, 65536);
  assert.deepEqual(controller.getStatus().dimensions, { width: 1280, height: 720, dpr: 2 });
  assert.equal(runtime.canvas.width, 1280);
  assert.equal(runtime.canvas.height, 720);
  assert.equal(runtime.calls.requestAdapter, 1);
  assert.equal(runtime.calls.requestDevice, 1);
  assert.equal(runtime.calls.buffers.length, 4, 'two particle buffers plus uniform and shape buffers');
  assert.equal(runtime.calls.buffers[0].descriptor.size, 65536 * 32);
  assert.equal(runtime.calls.buffers[1].descriptor.size, 65536 * 32);
  assert.equal(runtime.calls.buffers[2].descriptor.size, 160);
  assert.equal(runtime.calls.buffers[3].descriptor.size, 528);
  assert.equal(runtime.calls.buffers[3].descriptor.usage, 128 | 8);
  const initialParticles = runtime.calls.writes[0].data;
  assert.equal(initialParticles.length, 65536 * 8);
  assert.ok(Array.from({ length: 32 }, (_, index) => initialParticles[index * 8 + 2]).some((z) => Math.abs(z) > 1e-5), 'initial positions must have non-zero z');
  assert.ok(Array.from({ length: 32 }, (_, index) => initialParticles[index * 8 + 6]).some((z) => Math.abs(z) > 1e-7), 'initial velocities must have non-zero z');
  assert.equal(runtime.calls.shaders.length, 2);
  assert.match(runtime.calls.shaders[0].code, /targetParticles\[index\] = particle/);
  assert.equal(runtime.calls.computePipeline.compute.entryPoint, 'updateParticles');
  assert.equal(runtime.calls.renderPipeline.vertex.entryPoint, 'vertexMain');
  assert.equal(runtime.calls.renderPipeline.fragment.entryPoint, 'fragmentMain');
  assert.equal(runtime.calls.bindGroups.length, 4, 'two compute and two render bind groups');
  assert.equal(bufferEntry(runtime.calls.bindGroups[0], 3), runtime.calls.buffers[3]);
  assert.equal(bufferEntry(runtime.calls.bindGroups[1], 3), runtime.calls.buffers[3]);
  assert.deepEqual(controller.getStatus().shape, { type: 'cube', halfExtent: 1, restitution: 0.82 });

  const shapeWrites = () => runtime.calls.writes.filter((write) => write.buffer === runtime.calls.buffers[3]);
  assert.equal(shapeWrites().length, 1, 'default shape uploads exactly once during initialization');
  assert.equal(shapeWrites()[0].data.length, 132, 'shape storage is 33 aligned vec4 values');
  assert.deepEqual(Array.from(shapeWrites()[0].data.slice(0, 4)), [0, 0, 1, 0.82].map(Math.fround));
  assert.equal(controller.setShape({ type: 'cube' }), false, 'an identical canonical shape does not upload');
  assert.equal(shapeWrites().length, 1);
  assert.equal(controller.setShape({ type: 'sphere', radius: 0.84, restitution: 0.7 }), true);
  assert.equal(shapeWrites().length, 2);
  assert.deepEqual(Array.from(shapeWrites()[1].data.slice(0, 4)), [1, 0, 0.84, 0.7].map(Math.fround));
  assert.equal(controller.setShape({ type: 'sphere', radius: 0.84, restitution: 0.7 }), false);
  assert.equal(shapeWrites().length, 2, 'an unchanged sphere does not upload again');
  const tetrahedron = {
    type: 'convex',
    restitution: 0.6,
    planes: [[1, 1, 1, 0.9], [-1, -1, 1, 0.9], [-1, 1, -1, 0.9], [1, -1, -1, 0.9]]
  };
  assert.equal(controller.setShape(tetrahedron), true);
  assert.equal(shapeWrites().length, 3);
  const convexPacked = shapeWrites()[2].data;
  assert.deepEqual(Array.from(convexPacked.slice(0, 4)), [2, 4, 1, 0.6].map(Math.fround));
  assert.ok(Math.abs(convexPacked[4] - 1 / Math.sqrt(3)) < 1e-6, 'plane normals are normalized before upload');
  assert.ok(Math.abs(convexPacked[7] - 0.9 / Math.sqrt(3)) < 1e-6, 'plane offsets use the same normalization');
  const statusShape = controller.getStatus().shape;
  statusShape.planes[0][0] = 99;
  assert.notEqual(controller.getStatus().shape.planes[0][0], 99, 'shape snapshots are defensive copies');

  assert.equal(controller.start(), true);
  assert.equal(controller.getStatus().state, 'running');
  assert.equal(runtime.calls.scheduledFrames.length, 1);
  assert.equal(controller.stop(), true);
  assert.equal(controller.getStatus().state, 'stopped');
  assert.deepEqual(runtime.calls.cancelledFrames, [1]);

  controller.setParameters({
    pointerX: -0.4, pointerY: 0.25, pointerZ: 0.35,
    modeM: 5, modeN: 2, modeP: 4,
    modeM2: 2, modeN2: 6, modeP2: 3, modeMix: 0.4, modeWeightA: 1.25, modeWeightB: -0.65,
    aspect: 1.3, depthAspect: 0.7, pointSize: 2.5,
    rotationMatrix: rotation, zoom: 1.12, perspective: 0.58,
    pointerStrength: 1.4, nodeStrength: 0.65, driftStrength: 2.2,
    color: [1, 0.5, 0.2, 0.9]
  });

  // Frame 1 reads A, computes B, and renders B. Frame 2 reverses the pair.
  assert.equal(controller.renderFrame(1000), true);
  assert.equal(controller.renderFrame(1016), true);
  assert.equal(runtime.calls.computeFrames.length, 2);
  assert.equal(runtime.calls.renderFrames.length, 2);
  assert.equal(runtime.calls.computeFrames[0].workgroups, 256);
  assert.deepEqual(runtime.calls.renderFrames[0].draw, [6, 65536, 0, 0]);
  const compute0 = runtime.calls.computeFrames[0].bindGroup;
  const compute1 = runtime.calls.computeFrames[1].bindGroup;
  const render0 = runtime.calls.renderFrames[0].bindGroup;
  const render1 = runtime.calls.renderFrames[1].bindGroup;
  assert.equal(bufferEntry(compute0, 1), runtime.calls.buffers[0]);
  assert.equal(bufferEntry(compute0, 2), runtime.calls.buffers[1]);
  assert.equal(bufferEntry(compute0, 3), runtime.calls.buffers[3]);
  assert.equal(bufferEntry(render0, 1), runtime.calls.buffers[1]);
  assert.equal(bufferEntry(compute1, 1), runtime.calls.buffers[1]);
  assert.equal(bufferEntry(compute1, 2), runtime.calls.buffers[0]);
  assert.equal(bufferEntry(compute1, 3), runtime.calls.buffers[3]);
  assert.equal(bufferEntry(render1, 1), runtime.calls.buffers[0]);
  assert.equal(controller.getStatus().frame, 2);
  assert.equal(controller.getStatus().framesSubmitted, 2);
  assert.equal(controller.getStatus().hasSubmittedFrame, true);
  assert.equal(controller.getStatus().active, true, 'integration may announce activation only after a successful submit');

  const uniformWrites = runtime.calls.writes.filter((write) => write.buffer === runtime.calls.buffers[2]);
  assert.equal(uniformWrites.length, 2);
  const packed = uniformWrites[0].data;
  assert.equal(packed.length, 40, 'ten vec4 uniforms must occupy exactly 160 bytes');
  assert.deepEqual(Array.from(packed.slice(4, 8)), [-0.4, 0.25, 0.35, 0.4].map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(8, 12)), [5, 2, 4, 1.25].map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(12, 16)), [2, 6, 3, -0.65].map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(16, 20)), [1.3, 0.7, 5, 1.12].map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(20, 23)), [1280, 720, 0.58].map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(24, 27)), rotation.slice(0, 3).map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(28, 31)), rotation.slice(3, 6).map(Math.fround));
  assert.deepEqual(Array.from(packed.slice(32, 35)), rotation.slice(6, 9).map(Math.fround));
  assert.equal(packed[23], Math.fround(1.4));
  assert.equal(packed[27], Math.fround(0.65));
  assert.equal(packed[31], Math.fround(2.2));

  // Legacy 2D parameter patches remain valid and leave new dimensions at their current values.
  assert.equal(controller.setParameters({ pointerX: 0.1, pointerY: -0.2, modeM: 3, modeN: 4, energy: 0.8 }), true);
  assert.throws(() => controller.setParameters({ energy: 1, typo: 2 }), /Unknown particle parameter/);
  assert.throws(() => controller.setParameters({ damping: 2 }), /between/);
  assert.throws(() => controller.setParameters({ pointerZ: 2 }), /between/);
  assert.throws(() => controller.setParameters({ modeP: 0 }), /integer/);
  assert.throws(() => controller.setParameters({ modeMix: 1.1 }), /between/);
  assert.throws(() => controller.setParameters({ modeWeightB: -2.1 }), /between/);
  assert.throws(() => controller.setParameters({ perspective: -0.1 }), /between/);
  assert.throws(() => controller.setParameters({ pointerStrength: -0.1 }), /between/);
  assert.throws(() => controller.setParameters({ nodeStrength: Infinity }), /finite/);
  assert.throws(() => controller.setParameters({ driftStrength: 4.1 }), /between/);
  assert.equal(controller.setParameters({ pointerStrength: 0, nodeStrength: 4, driftStrength: 0.25 }), true);
  assert.equal(controller.setParameters({ zoom: 8 }), true, 'camera integration supports the UI zoom ceiling');
  assert.throws(() => controller.setParameters({ rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, -1] }), /determinant/);
  assert.throws(() => controller.setParameters({ rotationMatrix: [1, 0, 0] }), /nine/);
  assert.throws(() => controller.setShape({ type: 'capsule' }), /cube.*sphere.*convex/);
  assert.throws(() => controller.setShape({ type: 'cube', halfExtent: Infinity }), /finite/);
  assert.throws(() => controller.setShape({ type: 'sphere', radius: 0 }), /between/);
  assert.throws(() => controller.setShape({ type: 'convex', planes: [[1, 0, 0, 1]] }), /between 4 and 32/);
  assert.throws(() => controller.setShape({ type: 'convex', planes: Array.from({ length: 33 }, () => [1, 0, 0, 1]) }), /between 4 and 32/);
  assert.throws(() => controller.setShape({ type: 'convex', planes: [[0, 0, 0, 1], [1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] }), /non-zero/);
  assert.throws(() => controller.setShape({ type: 'convex', planes: [[1, 0, 0, -1], [-1, 0, 0, 1], [0, 1, 0, 1], [0, -1, 0, 1]] }), /origin inside/);
  assert.throws(() => controller.setShape({ type: 'cube', halfExtent: 1, extra: 1 }), /Unknown cube shape property/);
  assert.throws(() => controller.resize(0, 100, 1), /greater than zero/);
  controller.resize(320, 200, 1.5);
  assert.deepEqual(controller.getStatus().dimensions, { width: 480, height: 300, dpr: 1.5 });
  assert.equal(runtime.calls.configure.length, 2);

  const states = [];
  const unsubscribe = controller.subscribe((status) => states.push(status.state));
  assert.equal(states[0], 'stopped');
  runtime.lost.resolve({ reason: 'destroyed', message: 'mock device lost' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getStatus().state, 'lost');
  assert.equal(controller.getStatus().error.code, 'webgpu-device-lost');
  assert.equal(controller.start(), false);
  const writesBeforeLostShape = runtime.calls.writes.length;
  assert.equal(controller.setShape({ type: 'cube', halfExtent: 0.7 }), false, 'lost devices reject shape uploads');
  assert.equal(runtime.calls.writes.length, writesBeforeLostShape);
  unsubscribe();
  assert.equal(controller.destroy(), true);
  assert.equal(controller.getStatus().state, 'destroyed');
  assert.ok(runtime.calls.buffers.every((buffer) => buffer.destroyed));
  assert.equal(runtime.calls.unconfigure, 1);
  assert.equal(runtime.calls.deviceDestroy, 1);
  assert.equal(controller.destroy(), false);

  // A missing WebGPU canvas context is isolated and does not resize the canvas.
  const noContextRuntime = createMockRuntime({ hasContext: false });
  noContextRuntime.canvas.width = 11;
  noContextRuntime.canvas.height = 13;
  const noContext = await Backend.create(noContextRuntime.canvas, { environment: noContextRuntime.environment });
  assert.equal(noContext.getStatus().state, 'unsupported');
  assert.equal(noContext.getStatus().error.code, 'webgpu-canvas-context-unavailable');
  assert.equal(noContextRuntime.canvas.width, 11);
  assert.equal(noContextRuntime.canvas.height, 13);
  noContext.destroy();

  // Strict public boundary validation.
  await assert.rejects(() => Backend.create(null), /canvas/);
  await assert.rejects(() => Backend.create(fallbackCanvas, []), /plain object/);
  await assert.rejects(() => Backend.create(fallbackCanvas, { autoStart: 'yes' }), /boolean/);
  await assert.rejects(() => Backend.create(fallbackCanvas, { particleTier: '1m' }), /particleTier/);
  await assert.rejects(() => Backend.create(fallbackCanvas, { parameters: { color: [1, 1, 1] } }), /RGBA/);
  await assert.rejects(() => Backend.create(fallbackCanvas, { shape: { type: 'sphere', radius: NaN } }), /finite/);

  // Browser-global UMD path works without CommonJS or WebGPU globals.
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'webgpu-particle-backend.js'), 'utf8');
  const browser = {
    console, JSON, Math, Number, String, Object, Array, Set, Promise, Symbol,
    TypeError, RangeError, Error, Float32Array, Date, setTimeout, clearTimeout
  };
  browser.window = browser;
  browser.globalThis = browser;
  vm.runInNewContext(source, browser, { filename: 'webgpu-particle-backend.js' });
  assert.equal(typeof browser.SignalFieldWebGPUParticleBackend.create, 'function');
  assert.equal(browser.SignalFieldWebGPUParticleBackend.VERSION, Backend.VERSION);
  assert.equal(browser.SignalFieldWebGPUParticleBackend.isWebGPUSupported({ navigator: {} }), false);

  console.log('PASS 3D WebGPU modes, projection, aligned uniforms, cube/sphere/convex confinement, sparse shape uploads, lifecycle, fallback, validation, and UMD');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
