'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Production = require('../app/production-spec.js');
const SceneStudio = require('../app/scene-studio.js');

function project(durationMs) {
  const snapshot = SceneStudio.defaultSnapshot();
  return SceneStudio.createProject({
    title: 'Production test',
    scenes: [
      { id: 'scene-a', name: 'Opening', snapshot },
      { id: 'scene-b', name: 'Drop', snapshot: Object.assign({}, snapshot, { style: 'sand' }) }
    ],
    timeline: {
      durationMs,
      keyframes: [
        { id: 'keyframe-a', timeMs: 0, snapshot },
        { id: 'keyframe-b', timeMs: Math.min(5000, durationMs), snapshot: Object.assign({}, snapshot, { style: 'sand' }) }
      ]
    }
  });
}

const embeddedProject = project(10000);
const input = {
  project: embeddedProject,
  aspect: '9:16',
  titleCard: { template: 'kinetic', mainTitle: 'Signal Field', subtitle: 'Local first', durationMs: 1800 },
  lyrics: [
    { startMs: 500, endMs: 1600, text: 'First line' },
    { startMs: 1600, endMs: 2800, text: 'Second\nline' },
    { startMs: 7000, endMs: 8000, text: 'Final line' }
  ],
  beatEdits: [
    { timeMs: 1000, action: 'accent', intensity: 0.7 },
    { timeMs: 5000, action: 'cut', targetSceneId: 'scene-b' },
    { timeMs: 7500, action: 'hold', intensity: 0.4, targetSceneId: null }
  ],
  output: { codec: 'h264', fileName: 'vertical-cut.mp4' }
};

const spec = Production.create(input);
assert.equal(spec.schema, 'signal-field-production/v1');
assert.equal(spec.version, 1);
assert.equal(spec.project.schema, SceneStudio.PROJECT_SCHEMA);
assert.equal(spec.aspect, '9:16');
assert.equal(spec.titleCard.template, 'kinetic');
assert.equal(spec.beatEdits[0].targetSceneId, null);
assert.equal(spec.beatEdits[1].intensity, 1);
assert.deepEqual(Production.validate(spec), { valid: true, errors: [] });

// Canonical, deterministic, defensive round-trip from both objects and JSON.
const compact = Production.export(spec, { pretty: false });
const pretty = Production.export(spec);
assert.deepEqual(Production.import(compact), spec);
assert.deepEqual(Production.import(pretty), spec);
assert.equal(Production.export(Production.import(compact), { pretty: false }), compact);
const reordered = JSON.parse(compact);
const reorderedEnvelope = {
  output: reordered.output,
  beatEdits: reordered.beatEdits,
  lyrics: reordered.lyrics,
  titleCard: reordered.titleCard,
  aspect: reordered.aspect,
  project: reordered.project,
  version: reordered.version,
  schema: reordered.schema
};
assert.deepEqual(Production.import(reorderedEnvelope), spec);
assert.deepEqual(Production.create(Object.assign({}, input, { project: JSON.stringify(embeddedProject) })).project, embeddedProject);
input.lyrics[0].text = 'mutated';
embeddedProject.title = 'mutated';
assert.equal(spec.lyrics[0].text, 'First line');
assert.equal(spec.project.title, 'Production test');

// Query boundaries are deterministic: lyric intervals are half-open and beat lookup is exact.
assert.equal(Production.activeLyricsAt(spec, 499), null);
assert.equal(Production.activeLyricsAt(spec, 500).text, 'First line');
assert.equal(Production.activeLyricsAt(spec, 1599.5).text, 'First line');
assert.equal(Production.activeLyricsAt(spec, 1600).text, 'Second\nline');
assert.equal(Production.activeLyricsAt(spec, 2800), null);
assert.equal(Production.beatEditAt(spec, 5000).action, 'cut');
assert.equal(Production.beatEditAt(spec, 5000.1), null);
assert.deepEqual(Production.nearbyBeatEdits(spec, 5100, 200).map((edit) => edit.timeMs), [5000]);
assert.deepEqual(Production.nearbyBeatEdits(spec, 6250, 1250).map((edit) => edit.timeMs), [5000, 7500]);

function failsCreate(patch, pattern) {
  assert.throws(() => Production.create(Object.assign({}, {
    project: project(10000), aspect: '16:9', titleCard: { template: 'none' }, lyrics: [], beatEdits: [], output: { codec: 'h264' }
  }, patch)), pattern);
}

// Strict envelopes and numeric isolation.
failsCreate({ typo: true }, /Unknown production specification/);
failsCreate({ schema: 'signal-field-production/v2' }, /Unsupported/);
failsCreate({ aspect: '4:3' }, /aspect/);
failsCreate({ titleCard: { template: 'cinematic', mainTitle: 'x', durationMs: NaN } }, /finite/);
failsCreate({ titleCard: { template: 'none', durationMs: 1 } }, /must be 0/);
failsCreate({ titleCard: { template: 'minimal', durationMs: 0 } }, /positive/);
failsCreate({ titleCard: { template: 'minimal', mainTitle: 'x'.repeat(Production.MAX_TITLE_LENGTH + 1), durationMs: 1000 } }, /exceeds/);
failsCreate({ lyrics: [{ startMs: 0, endMs: 1000, text: 'ok', extra: true }] }, /Unknown lyrics/);
failsCreate({ lyrics: [{ startMs: 0, endMs: Infinity, text: 'bad' }] }, /finite/);
failsCreate({ lyrics: [{ startMs: 0, endMs: 2000, text: 'first' }, { startMs: 1999, endMs: 3000, text: 'overlap' }] }, /must not overlap/);
failsCreate({ lyrics: [{ startMs: 1000, endMs: 2000, text: 'later' }, { startMs: 0, endMs: 500, text: 'earlier' }] }, /ordered/);
failsCreate({ lyrics: [{ startMs: 0, endMs: 1, text: '' }] }, /cannot be empty/);
failsCreate({ beatEdits: [{ timeMs: 100, action: 'zoom' }] }, /action/);
failsCreate({ beatEdits: [{ timeMs: 100, action: 'cut' }, { timeMs: 100, action: 'hold' }] }, /strictly ordered/);
failsCreate({ beatEdits: [{ timeMs: 100, action: 'cut', intensity: 1.01 }] }, /between 0 and 1/);
failsCreate({ beatEdits: [{ timeMs: 100, action: 'cut', targetSceneId: 'missing' }] }, /does not reference/);
failsCreate({ output: { codec: 'vp9' } }, /codec/);
failsCreate({ output: { codec: 'h264', fileName: '../escape.mp4' } }, /safe base file/);
failsCreate({ output: { codec: 'prores', fileName: 'wrong.mp4' } }, /extension/);
assert.throws(() => Production.activeLyricsAt(spec, NaN), /finite/);
assert.throws(() => Production.nearbyBeatEdits(spec, 0, 60001), /between/);

// Canonical import rejects omitted normalized fields and unknown nested data.
const nonCanonical = JSON.parse(compact);
delete nonCanonical.beatEdits[0].targetSceneId;
assert.equal(Production.validate(nonCanonical).valid, false);
const unknownNested = JSON.parse(compact);
unknownNested.titleCard.shadow = true;
assert.throws(() => Production.import(unknownNested), /Unknown titleCard/);
const unknownProject = JSON.parse(compact);
unknownProject.project.timeline.loop = true;
assert.throws(() => Production.import(unknownProject), /Unknown embedded project timeline/);

// Pollution keys, accessors, sparse arrays, non-finite values, and bad JSON never cross the boundary.
const polluted = JSON.parse(compact);
polluted.__protoPollutionProbe = undefined;
delete polluted.__protoPollutionProbe;
const pollutionText = compact.replace('{', '{"__proto__":{"polluted":true},');
assert.throws(() => Production.import(pollutionText), /forbidden key/);
assert.equal({}.polluted, undefined);
const accessor = JSON.parse(compact);
let getterRan = false;
Object.defineProperty(accessor.output, 'codec', { enumerable: true, get() { getterRan = true; return 'h264'; } });
assert.throws(() => Production.import(accessor), /data property/);
assert.equal(getterRan, false);
assert.equal(Production.validate(accessor).valid, false);
assert.equal(getterRan, false);
const sparse = JSON.parse(compact);
sparse.lyrics.length += 1;
assert.throws(() => Production.import(sparse), /dense array/);
const nonFinite = JSON.parse(compact);
nonFinite.beatEdits[0].intensity = NaN;
assert.throws(() => Production.import(nonFinite), /finite/);
assert.throws(() => Production.import('{bad json'), /Invalid production specification JSON/);

// Boundary values remain accepted and output defaults match the selected codec.
const boundary = Production.create({
  project: project(Production.MAX_DURATION_MS),
  aspect: '1:1',
  titleCard: { template: 'cinematic', mainTitle: 'T'.repeat(Production.MAX_TITLE_LENGTH), subtitle: 'S'.repeat(Production.MAX_SUBTITLE_LENGTH), durationMs: 30000 },
  lyrics: [{ startMs: 0, endMs: Production.MAX_LYRIC_DURATION_MS, text: 'L'.repeat(Production.MAX_LYRIC_LENGTH) }],
  beatEdits: [{ timeMs: Production.MAX_DURATION_MS, action: 'accent', intensity: 0 }],
  output: { codec: 'prores' }
});
assert.equal(boundary.output.fileName, 'signal-field-video.mov');
assert.equal(Production.validate(boundary).valid, true);

// Browser-global UMD path exposes the same contract without CommonJS.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'production-spec.js'), 'utf8');
const browser = {
  JSON, Math, Number, String, Boolean, Object, Array, Set,
  TypeError, RangeError, SyntaxError, Error
};
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(source, browser, { filename: 'production-spec.js' });
assert.equal(typeof browser.SignalFieldProductionSpec.create, 'function');
assert.equal(typeof browser.SignalFieldProductionSpec.activeLyricsAt, 'function');
assert.equal(browser.SignalFieldProductionSpec.SCHEMA, Production.SCHEMA);

console.log('PASS strict production schema, embedded project safety, title templates, ordered lyrics, beat edits, codec naming, deterministic queries, pollution isolation, round-trip, and UMD');
