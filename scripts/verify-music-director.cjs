'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Director = require('../app/music-director.js');
const SceneStudio = require('../app/scene-studio.js');

const SAMPLE_RATE = 8000;

function pcm(seconds, sample) {
  const values = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < values.length; index += 1) values[index] = sample(index, index / SAMPLE_RATE);
  return values;
}

function assertFiniteAnalysis(analysis) {
  assert.equal(analysis.schema, Director.ANALYSIS_SCHEMA);
  assert.ok(analysis.frames.length > 0);
  analysis.frames.forEach((frame) => {
    ['timeMs', 'energy', 'brightness', 'roughness', 'flux', 'low', 'mid', 'high'].forEach((key) => {
      assert.equal(Number.isFinite(frame[key]), true, `${key} must be finite`);
    });
    assert.ok(frame.energy >= 0 && frame.energy <= 2);
    ['brightness', 'roughness', 'flux', 'low', 'mid', 'high'].forEach((key) => assert.ok(frame[key] >= 0 && frame[key] <= 1));
  });
  assert.ok(analysis.sections.length >= 1 && analysis.sections.length <= 12);
  assert.equal(Number.isFinite(analysis.tempo.bpm), true);
  assert.equal(Number.isFinite(analysis.tempo.confidence), true);
}

const silence = Director.analyzeMono({ samples: pcm(3, () => 0), sampleRate: SAMPLE_RATE }, { frameRate: 10 });
assertFiniteAnalysis(silence);
assert.equal(silence.summary.energy, 0);
assert.equal(silence.summary.roughness, 0);
assert.equal(silence.tempo.bpm, 0);
assert.equal(silence.tempo.confidence, 0);

const sine = Director.analyzeMono({
  samples: pcm(3, (_index, time) => Math.sin(time * Math.PI * 2 * 440) * 0.35),
  sampleRate: SAMPLE_RATE
}, { frameRate: 10 });
assertFiniteAnalysis(sine);
assert.ok(sine.summary.energy > 0.5, `sine energy is unexpectedly low: ${sine.summary.energy}`);
assert.ok(sine.summary.roughness < 0.2, `a tonal sine should have low roughness: ${sine.summary.roughness}`);

let noiseSeed = 0x12345678;
function noise() {
  noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
  return (noiseSeed / 0x100000000 * 2 - 1) * 0.25;
}
const noisy = Director.analyzeMono({ samples: pcm(3, noise), sampleRate: SAMPLE_RATE }, { frameRate: 10 });
assertFiniteAnalysis(noisy);
assert.ok(noisy.summary.roughness > sine.summary.roughness + 0.35,
  `noise should be spectrally rougher than a sine: noise=${noisy.summary.roughness}, sine=${sine.summary.roughness}`);
assert.ok(noisy.summary.brightness > sine.summary.brightness,
  `broadband noise should be brighter than 440 Hz: noise=${noisy.summary.brightness}, sine=${sine.summary.brightness}`);

const pulseSamples = pcm(14, (index) => {
  const period = SAMPLE_RATE / 2;
  const phase = index % period;
  return phase < 64 ? (1 - phase / 64) * 0.95 : 0;
});
const pulse = Director.analyzeMono({ samples: pulseSamples, sampleRate: SAMPLE_RATE }, { frameRate: 20 });
assertFiniteAnalysis(pulse);
assert.ok(Math.abs(pulse.tempo.bpm - 120) <= 2, `expected about 120 BPM, received ${pulse.tempo.bpm}`);
assert.ok(pulse.tempo.confidence >= 0.35, `pulse tempo confidence is too low: ${pulse.tempo.confidence}`);
assert.ok(pulse.summary.flux > silence.summary.flux);

// Optional duration analyzes a strict prefix without mutating the input.
const prefix = Director.analyzeMono({ samples: pulseSamples, sampleRate: SAMPLE_RATE }, { durationMs: 5000, frameRate: 10 });
assert.equal(prefix.durationMs, 5000);
assert.equal(prefix.frames.length, 50);

// Strict PCM and option validation, including sparse overlong input without a large allocation.
assert.throws(() => Director.analyzeMono(null), /PCM input/);
assert.throws(() => Director.analyzeMono({ samples: [], sampleRate: SAMPLE_RATE }), /non-empty/);
const nonFinitePcm = new Float32Array(8); nonFinitePcm[3] = NaN;
const outOfRangePcm = new Float32Array(8); outOfRangePcm[3] = 5;
assert.throws(() => Director.analyzeMono({ samples: nonFinitePcm, sampleRate: SAMPLE_RATE }), /must be finite/);
assert.throws(() => Director.analyzeMono({ samples: outOfRangePcm, sampleRate: SAMPLE_RATE }), /PCM range/);
assert.throws(() => Director.analyzeMono({ samples: new Float32Array(100), sampleRate: 1000 }), /sampleRate/);
assert.throws(() => Director.analyzeMono({ samples: new Float32Array(100), sampleRate: SAMPLE_RATE }, { frameRate: Infinity }), /finite/);
assert.throws(() => Director.analyzeMono({ samples: new Float32Array(100), sampleRate: SAMPLE_RATE }, { typo: true }), /Unknown analysis option/);
const overlong = [];
overlong.length = SAMPLE_RATE * (Director.MAX_DURATION_MS / 1000) + 1;
assert.throws(() => Director.analyzeMono({ samples: overlong, sampleRate: SAMPLE_RATE }), /maximum analysis duration/);

const templates = ['ambient-orbit', 'pulse-cut', 'sand-study'];
const aspects = ['16:9', '1:1', '9:16'];
const plans = [];
templates.forEach((template) => {
  aspects.forEach((aspect) => {
    const plan = Director.createPlan(pulse, {
      template,
      aspect,
      title: `${template} ${aspect}`,
      seed: 20260722,
      maxScenes: 12,
      baseSnapshot: SceneStudio.defaultSnapshot()
    });
    plans.push(plan);
    assert.equal(plan.schema, Director.PLAN_SCHEMA);
    assert.equal(plan.template, template);
    assert.equal(plan.aspect, aspect);
    assert.ok(plan.project.scenes.length >= 1 && plan.project.scenes.length <= 12);
    assert.equal(plan.project.scenes.length, plan.project.timeline.keyframes.length);
    assert.equal(plan.cues.length, plan.project.scenes.length);
    assert.equal(plan.project.timeline.durationMs, Math.round(pulse.durationMs));
    const validation = SceneStudio.validateProject(plan.project);
    assert.equal(validation.valid, true, `${template}/${aspect} must be a valid Scene Studio project: ${validation.errors.join(' ')}`);
    const canonical = SceneStudio.createProject(plan.project);
    assert.equal(SceneStudio.validateProject(canonical).valid, true);
    plan.project.scenes.forEach((scene) => {
      const snapshot = scene.snapshot;
      assert.ok(['sand', 'msand', 'cosmic', 'dcosmic'].includes(snapshot.style));
      assert.ok(['regular', 'random', 'sphere'].includes(snapshot.solidShape));
      assert.ok(['single', 'tumble', 'precess'].includes(snapshot.rotationMode));
      assert.equal(Number.isInteger(snapshot.parameters.faces), true);
      ['detail', 'particles', 'evolve', 'zoom', 'rotationSpeed', 'light', 'patternInterval'].forEach((key) => {
        assert.equal(Number.isFinite(snapshot.parameters[key]), true, `${template} ${key}`);
      });
      assert.equal(snapshot.pattern.style, snapshot.style);
      assert.equal(snapshot.pattern.shape, snapshot.solidShape);
      assert.equal(snapshot.pattern.polyN, snapshot.parameters.faces);
    });
    assert.equal(new Set(plan.project.scenes.map((scene) => scene.snapshot.pattern.polySeed)).size, 1,
      `${template} must not interpolate geometry seeds during playback`);
  });
});

// Templates and aspect profiles must materially change complete compositions.
const landscapeAmbient = plans.find((plan) => plan.template === 'ambient-orbit' && plan.aspect === '16:9');
const portraitAmbient = plans.find((plan) => plan.template === 'ambient-orbit' && plan.aspect === '9:16');
const pulseCut = plans.find((plan) => plan.template === 'pulse-cut' && plan.aspect === '16:9');
const sandStudy = plans.find((plan) => plan.template === 'sand-study' && plan.aspect === '16:9');
assert.equal(landscapeAmbient.project.scenes[0].snapshot.solidShape, 'sphere');
assert.notEqual(landscapeAmbient.project.scenes[0].snapshot.parameters.zoom, portraitAmbient.project.scenes[0].snapshot.parameters.zoom);
assert.notEqual(landscapeAmbient.project.scenes[0].snapshot.rotationMode, pulseCut.project.scenes[0].snapshot.rotationMode);
assert.notEqual(pulseCut.project.scenes[0].snapshot.solidShape, sandStudy.project.scenes[0].snapshot.solidShape);
assert.notEqual(pulseCut.project.scenes[0].snapshot.parameters.light, sandStudy.project.scenes[0].snapshot.parameters.light);

// Same analysis/options/seed is byte-for-byte deterministic and defensive by value.
const deterministicOptions = {
  template: 'pulse-cut', aspect: '9:16', title: 'Deterministic', seed: 77,
  maxScenes: 7, baseSnapshot: SceneStudio.defaultSnapshot()
};
const first = Director.createPlan(pulse, deterministicOptions);
const second = Director.createPlan(pulse, deterministicOptions);
assert.deepEqual(first, second);
first.project.scenes[0].snapshot.parameters.detail = 99;
assert.notEqual(second.project.scenes[0].snapshot.parameters.detail, 99);
const anotherSeed = Director.createPlan(pulse, Object.assign({}, deterministicOptions, { seed: 78 }));
assert.notDeepEqual(second.project.scenes[0].snapshot.pattern.ex, anotherSeed.project.scenes[0].snapshot.pattern.ex);

assert.throws(() => Director.createPlan(pulse, { template: 'music-video', aspect: '16:9', title: 'Bad', seed: 1 }), /template/);
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '4:3', title: 'Bad', seed: 1 }), /aspect/);
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '16:9', title: '', seed: 1 }), /title/);
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '16:9', title: 'Bad', seed: -1 }), /seed/);
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '16:9', title: 'Bad', seed: 1, maxScenes: 13 }), /maxScenes/);
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '16:9', title: 42, seed: 1 }), /title must be a string/);
const invalidBase = SceneStudio.defaultSnapshot();
invalidBase.toggles.transparent = 'yes';
assert.throws(() => Director.createPlan(pulse, { template: 'pulse-cut', aspect: '16:9', title: 'Bad', seed: 1, baseSnapshot: invalidBase }), /must be a boolean/);
const corrupted = JSON.parse(JSON.stringify(pulse));
corrupted.frames[0].energy = NaN;
assert.throws(() => Director.createPlan(corrupted, { template: 'pulse-cut', aspect: '16:9', title: 'Bad', seed: 1 }), /finite/);
const corruptedSummary = JSON.parse(JSON.stringify(pulse));
corruptedSummary.summary.flux = Infinity;
assert.throws(() => Director.createPlan(corruptedSummary, { template: 'pulse-cut', aspect: '16:9', title: 'Bad', seed: 1 }), /finite/);

// Explicit sphere must survive Scene Studio canonicalization and validation.
const sphereProbe = SceneStudio.createSnapshot(Object.assign(SceneStudio.defaultSnapshot(), {
  solidShape: 'sphere',
  pattern: Object.assign({}, SceneStudio.defaultSnapshot().pattern, { shape: 'sphere' })
}));
assert.equal(sphereProbe.solidShape, 'sphere');
assert.equal(SceneStudio.validateSnapshot(sphereProbe).valid, true);

// Browser-global UMD path exposes the same API without CommonJS.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'music-director.js'), 'utf8');
const browser = {
  console, JSON, Math, Number, String, Boolean, Object, Array, ArrayBuffer,
  Float32Array, Float64Array, Uint16Array, Promise, Set, Map,
  TypeError, RangeError, Error
};
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(source, browser, { filename: 'music-director.js' });
assert.equal(typeof browser.SignalFieldMusicDirector.analyzeMono, 'function');
assert.equal(typeof browser.SignalFieldMusicDirector.createPlan, 'function');
assert.equal(browser.SignalFieldMusicDirector.VERSION, Director.VERSION);

console.log('PASS local PCM analysis, finite features, 120 BPM tempo, sections, strict validation, three templates, three aspects, deterministic Scene Studio projects, explicit sphere, and UMD');
