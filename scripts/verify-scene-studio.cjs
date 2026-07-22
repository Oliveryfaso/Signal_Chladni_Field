'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SceneStudio = require('../app/scene-studio.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSnapshot(overrides) {
  const base = SceneStudio.defaultSnapshot();
  const source = overrides || {};
  return SceneStudio.createSnapshot({
    style: source.style || base.style,
    sampleMode: source.sampleMode || base.sampleMode,
    rotationMode: source.rotationMode || base.rotationMode,
    solidShape: source.solidShape || base.solidShape,
    parameters: Object.assign({}, base.parameters, source.parameters || {}),
    toggles: Object.assign({}, base.toggles, source.toggles || {}),
    pattern: Object.assign({}, base.pattern, source.pattern || {})
  });
}

// A runtime-shaped state becomes a complete, canonical snapshot without aliases.
const snapshot = SceneStudio.createSnapshot({
  style: 'msand',
  sampleMode: 'time',
  rotationMode: 'tumble',
  solidShape: 'random',
  detail: 1.8,
  particles: 0.4,
  evolve: 0.6,
  zoom: 4.2,
  rotationSpeed: 1.7,
  faces: 11,
  light: 7,
  patternInterval: 3.5,
  rotation: false,
  symmetric: true,
  frame: true,
  transparent: true,
  patternSpec: { style: 'msand', goal: 8.2, ex: [0.1, 0.2, 0.3], detail: 1.8, shape: 'random', polyN: 11, polySeed: 42, sym: true }
});
assert.equal(SceneStudio.validateSnapshot(snapshot).valid, true);
assert.equal(snapshot.parameters.faces, 11);
assert.equal(snapshot.toggles.rotation, false);
assert.equal(snapshot.pattern.polySeed, 42);
assert.equal(SceneStudio.validateSnapshot(Object.assign({}, snapshot, { version: 99 })).valid, false);

// Scene CRUD and explicit order preserve complete snapshots by value.
const store = SceneStudio.createStore(SceneStudio.createProject({ title: 'Studio verification', timeline: { durationMs: 1000, keyframes: [] } }));
const alpha = store.addScene({ id: 'alpha', name: 'Alpha', snapshot: snapshot });
const beta = store.addScene({ id: 'beta', name: 'Beta', snapshot: makeSnapshot({ style: 'sand' }) });
assert.deepEqual(store.getProject().scenes.map((scene) => scene.id), ['alpha', 'beta']);
store.updateScene('alpha', { name: 'Alpha revised', snapshot: makeSnapshot({ parameters: { detail: 2.2 } }) });
store.reorderScenes(['beta', 'alpha']);
assert.deepEqual(store.getProject().scenes.map((scene) => scene.id), ['beta', 'alpha']);
const restored = store.restoreScene('alpha');
assert.equal(restored.scene.name, 'Alpha revised');
restored.snapshot.parameters.detail = 0.55;
assert.equal(store.restoreScene('alpha').snapshot.parameters.detail, 2.2, 'restored snapshots must not alias store state');
assert.equal(store.removeScene('beta').id, 'beta');
assert.equal(store.removeScene('missing'), null);
assert.throws(() => store.reorderScenes(['alpha', 'alpha']), /every scene exactly once/);

// Export/import is canonical and deterministic. Invalid data must not mutate the store.
const exported = store.exportJSON({ pretty: false });
const imported = SceneStudio.importProject(exported);
assert.equal(SceneStudio.exportProject(imported, { pretty: false }), exported);
const beforeInvalidImport = store.exportJSON({ pretty: false });
const invalidAttempt = store.tryImportJSON('{"schema":"signal-field/scene-project","version":999}');
assert.equal(invalidAttempt.ok, false);
assert.equal(store.exportJSON({ pretty: false }), beforeInvalidImport);
assert.throws(() => SceneStudio.importProject('{not json}'), SyntaxError);
assert.throws(() => SceneStudio.importProject(JSON.stringify(Object.assign({}, imported, { schema: 'other/project' }))), /Unexpected project schema/);

// Numeric fields interpolate, while booleans and enums step until the next keyframe.
const start = makeSnapshot({
  style: 'cosmic',
  parameters: { detail: 1, particles: 0.2, faces: 8 },
  toggles: { rotation: true, frame: true },
  pattern: { style: 'cosmic', goal: 6, ex: [0, 0.5, 1], detail: 1, shape: 'regular', polyN: 8, polySeed: 1, sym: false }
});
const end = makeSnapshot({
  style: 'dcosmic',
  parameters: { detail: 3, particles: 0.8, faces: 16 },
  toggles: { rotation: false, frame: false },
  pattern: { style: 'dcosmic', goal: 14, ex: [1, 0.5, 0], detail: 3, shape: 'random', polyN: 16, polySeed: 9, sym: true }
});
store.upsertKeyframe({ id: 'end', timeMs: 1000, snapshot: end });
store.upsertKeyframe({ id: 'start', timeMs: 0, snapshot: start });
const middle = store.seek(500);
assert.equal(middle.fromId, 'start');
assert.equal(middle.toId, 'end');
assert.equal(middle.progress, 0.5);
assert.equal(middle.snapshot.parameters.detail, 2);
assert.equal(middle.snapshot.parameters.faces, 12);
assert.equal(middle.snapshot.pattern.goal, 10);
assert.deepEqual(middle.snapshot.pattern.ex, [0.5, 0.5, 0.5]);
assert.equal(middle.snapshot.style, 'cosmic');
assert.equal(middle.snapshot.toggles.rotation, true);
const atEnd = store.seek(1000);
assert.equal(atEnd.snapshot.style, 'dcosmic');
assert.equal(atEnd.snapshot.toggles.rotation, false);
assert.throws(() => store.upsertKeyframe({ id: 'bad-time', timeMs: 1001, snapshot: start }), /outside the timeline duration/);

// Recipes are exact allowlisted mappings; tampered commands are never dispatched.
const recipe = SceneStudio.createSoundMotionRecipe(start);
assert.equal(SceneStudio.validateSoundMotionRecipe(recipe).valid, true);
assert.ok(recipe.commands.every((command) => SceneStudio.PUBLIC_METHODS.includes(command.method)));
const calls = [];
const target = {};
SceneStudio.PUBLIC_METHODS.forEach((method) => { target[method] = (...args) => calls.push([method, args]); });
const application = SceneStudio.applySoundMotionRecipe(recipe, target);
assert.equal(application.error, null);
assert.equal(application.applied.length, recipe.commands.length);
assert.deepEqual(calls[calls.length - 1][0], 'applyPatternSpec');
const tampered = clone(recipe);
tampered.commands[0] = { type: 'call', method: 'play', args: [] };
const callCountBeforeTamper = calls.length;
assert.equal(SceneStudio.validateSoundMotionRecipe(tampered).valid, false);
assert.notEqual(SceneStudio.applySoundMotionRecipe(tampered, target).error, null);
assert.equal(calls.length, callCountBeforeTamper);

// The same source exposes a browser global without CommonJS.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'scene-studio.js'), 'utf8');
const browser = { console: console, JSON: JSON, Math: Math, Number: Number, String: String, Object: Object, Array: Array, Set: Set, Map: Map, TypeError: TypeError, RangeError: RangeError, SyntaxError: SyntaxError };
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(source, browser, { filename: 'scene-studio.js' });
assert.equal(typeof browser.SignalFieldSceneStudio.createStore, 'function');
assert.equal(browser.SignalFieldSceneStudio.VERSION, SceneStudio.VERSION);

console.log('PASS scene studio snapshots, CRUD, deterministic projects, timeline interpolation, safe recipes, UMD, and invalid-input isolation');
