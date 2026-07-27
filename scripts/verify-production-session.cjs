'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SceneStudio = require('../app/scene-studio.js');
const Production = require('../app/production-spec.js');
const Session = require('../app/production-session.js');

function project(durationMs) {
  const snapshot = SceneStudio.defaultSnapshot();
  return SceneStudio.createProject({
    title: 'Persistent production',
    scenes: [{ id: 'scene-a', name: 'Opening', snapshot }],
    timeline: { durationMs, keyframes: [{ id: 'keyframe-a', timeMs: 0, snapshot }] }
  });
}

function production() {
  return Production.create({
    project: project(12000),
    aspect: '9:16',
    titleCard: { template: 'minimal', mainTitle: 'Local session', subtitle: 'No media bytes', durationMs: 1800 },
    lyrics: [
      { startMs: 500, endMs: 1800, text: 'First line' },
      { startMs: 2200, endMs: 3600, text: 'Second line' }
    ],
    beatEdits: [
      { timeMs: 1000, action: 'accent', intensity: 0.8 },
      { timeMs: 5000, action: 'cut', targetSceneId: 'scene-a' }
    ],
    output: { codec: 'h264', fileName: 'local-session.mp4' }
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); }
  };
}

const spec = production();
const audio = Session.createAudioMetadata({
  name: 'single.wav', size: 2048000, type: 'Audio/WAV', lastModified: 1710000000000,
  path: '/private/audio/single.wav', arrayBuffer() { throw new Error('must not read bytes'); }
}, 12000.4);
assert.deepEqual(Object.keys(audio), ['name', 'size', 'type', 'lastModified', 'durationMs', 'fingerprint']);
assert.equal(audio.type, 'audio/wav');
assert.equal(audio.durationMs, 12000);
assert.match(audio.fingerprint, /^sf1-[0-9a-f]{16}$/);
assert.equal(JSON.stringify(audio).includes('private'), false);

const session = Session.create({
  productionSpec: spec,
  selectedTemplate: 'pulse-cut',
  selectedAspect: '9:16',
  editor: { lyrics: spec.lyrics, manualBeatEdits: spec.beatEdits },
  audio
});
assert.equal(session.schema, 'signal-field-production-session/v1');
assert.equal(session.version, 1);
assert.equal(session.productionSpec.schema, Production.SCHEMA);
assert.equal(session.selectedTemplate, 'pulse-cut');
assert.equal(session.editor.lyrics.length, 2);
assert.equal(session.editor.manualBeatEdits.length, 2);
assert.equal(Session.matchesAudio(session.audio, {
  name: 'single.wav', size: 2048000, type: 'audio/wav', lastModified: 1710000000000
}, 12000.49), true);
assert.equal(Session.matchesAudio(session.audio, {
  name: 'single.wav', size: 2048001, type: 'audio/wav', lastModified: 1710000000000
}, 12000), false);
assert.equal(Session.matchesAudio(null, {}, 0), false);

// Canonical, defensive and deterministic session round-trip.
const compact = Session.serialize(session);
const pretty = Session.serialize(session, { pretty: true });
assert.deepEqual(Session.parse(compact), session);
assert.deepEqual(Session.parse(pretty), session);
assert.equal(Session.serialize(Session.parse(compact)), compact);
spec.lyrics[0].text = 'mutated';
audio.name = 'mutated.wav';
assert.equal(session.productionSpec.lyrics[0].text, 'First line');
assert.equal(session.audio.name, 'single.wav');
assert.equal(/"path"|"file"|"samples"|"pcm"|"peaks"|"blob"/i.test(compact), false);

// A pre-production draft may retain choices and audio identity without media.
const draft = Session.create({ selectedTemplate: 'sand-study', selectedAspect: '1:1', audio: session.audio });
assert.equal(draft.productionSpec, null);
assert.deepEqual(draft.editor, { lyrics: [], manualBeatEdits: null });
const automaticBeats = Session.create({
  productionSpec: session.productionSpec,
  selectedTemplate: 'ambient-orbit',
  selectedAspect: '9:16',
  editor: { lyrics: session.productionSpec.lyrics, manualBeatEdits: null }
});
assert.equal(automaticBeats.editor.manualBeatEdits, null);

// Strict schema, consistency, allowlists and size bounds reject unsafe state.
assert.throws(() => Session.create({ typo: true }), /Unknown production session/);
assert.throws(() => Session.create({ schema: 'signal-field-production-session/v2' }), /Unsupported/);
assert.throws(() => Session.create({ version: 2 }), /Unsupported/);
assert.throws(() => Session.create({ selectedTemplate: 'unknown' }), /selectedTemplate/);
assert.throws(() => Session.create({ selectedAspect: '4:3' }), /selectedAspect/);
assert.throws(() => Session.create({ productionSpec: session.productionSpec, selectedAspect: '16:9' }), /must match/);
assert.throws(() => Session.create({ editor: { lyrics: [{ startMs: 0, endMs: 1, text: 'orphan' }] } }), /require a Production Spec/);
assert.throws(() => Session.create({ productionSpec: session.productionSpec, editor: { lyrics: [] } }), /must match/);
assert.throws(() => Session.create({ productionSpec: session.productionSpec, editor: {
  lyrics: session.productionSpec.lyrics, manualBeatEdits: []
} }), /must match/);
assert.throws(() => Session.create({ audio: Object.assign({}, session.audio, { path: '/tmp/private.wav' }) }), /Unknown audio/);
assert.throws(() => Session.create({ audio: Object.assign({}, session.audio, { fingerprint: 'sf1-0000000000000000' }) }), /does not match/);
assert.throws(() => Session.createAudioMetadata({ name: '', size: 0, type: '', lastModified: 0 }, 1), /cannot be empty/);
assert.throws(() => Session.createAudioMetadata({ name: 'x', size: NaN, type: '', lastModified: 0 }, 1), /finite/);
assert.throws(() => Session.parse('x'.repeat(Session.MAX_SESSION_BYTES + 1)), /4 MB/);
assert.throws(() => Session.parse('{bad json'), /Invalid production session JSON/);
assert.throws(() => Session.parse(JSON.stringify({ schema: Session.SCHEMA, version: 1 })), /not in canonical form/);

const pollution = compact.replace('{', '{"__proto__":{"polluted":true},');
assert.throws(() => Session.parse(pollution), /forbidden key/);
assert.equal({}.polluted, undefined);
const accessor = Session.parse(compact);
let getterRan = false;
Object.defineProperty(accessor.audio, 'name', { enumerable: true, get() { getterRan = true; return 'trap.wav'; } });
assert.throws(() => Session.create(accessor), /data property/);
assert.equal(getterRan, false);
const sparse = Session.parse(compact);
sparse.editor.lyrics.length += 1;
assert.throws(() => Session.create(sparse), /dense array/);

// Storage helpers are non-throwing, retain an old value on failed save, and do
// not silently delete an invalid value during recovery.
const storage = memoryStorage();
assert.deepEqual(Session.load(storage), { ok: true, status: 'empty', session: null, error: null });
const saved = Session.save(storage, session);
assert.equal(saved.ok, true);
assert.deepEqual(Session.load(storage).session, session);
const previousValue = storage.value(Session.STORAGE_KEY);
const failedSave = Session.save(storage, Object.assign({}, session, { selectedTemplate: 'bad' }));
assert.equal(failedSave.ok, false);
assert.equal(storage.value(Session.STORAGE_KEY), previousValue);
storage.setItem(Session.STORAGE_KEY, '{broken');
assert.equal(Session.load(storage).status, 'invalid');
assert.equal(storage.value(Session.STORAGE_KEY), '{broken');
assert.equal(Session.clear(storage).ok, true);
assert.equal(Session.load(storage).status, 'empty');
const denied = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
  removeItem() { throw new Error('denied'); }
};
assert.equal(Session.load(denied).ok, false);
assert.equal(Session.save(denied, session).ok, false);
assert.equal(Session.clear(denied).ok, false);

// Browser-global UMD path shares the same dependency-free contract.
const productionSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'production-spec.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'production-session.js'), 'utf8');
const browser = {
  JSON, Math, Number, String, Boolean, Object, Array, Set, Map,
  TypeError, RangeError, SyntaxError, Error
};
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(productionSource, browser, { filename: 'production-spec.js' });
vm.runInNewContext(sessionSource, browser, { filename: 'production-session.js' });
assert.equal(typeof browser.SignalFieldProductionSession.create, 'function');
assert.equal(typeof browser.SignalFieldProductionSession.matchesAudio, 'function');
assert.equal(browser.SignalFieldProductionSession.SCHEMA, Session.SCHEMA);

console.log('PASS bounded production-session schema, canonical editor recovery, audio identity without media bytes, strict pollution/size rejection, resilient storage, and UMD');
