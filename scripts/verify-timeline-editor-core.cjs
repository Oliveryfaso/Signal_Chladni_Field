'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Timeline = require('../app/timeline-editor-core.js');

// Bounded min/max buckets from normalized mono PCM.
const mono = new Float32Array([-1, -0.5, 0.25, 0.75, -0.25, 0.5, -0.75, 1]);
const waveform = Timeline.buildWaveform({ samples: mono, sampleRate: 8000 }, { bucketCount: 4 });
assert.equal(waveform.schema, Timeline.WAVEFORM_SCHEMA);
assert.equal(waveform.sampleRate, 8000);
assert.equal(waveform.channelCount, 1);
assert.equal(waveform.bucketCount, 4);
assert.deepEqual(waveform.buckets.map((bucket) => [bucket.min, bucket.max]), [
  [-1, -0.5], [0.25, 0.75], [-0.25, 0.5], [-0.75, 1]
]);
assert.ok(waveform.buckets.every((bucket) => bucket.min >= -1 && bucket.max <= 1 && bucket.startMs < bucket.endMs));

// Multiple Float32 channels retain extrema rather than averaging peaks away.
const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
const right = new Float32Array([-0.9, -0.8, 0.8, 0.9]);
const stereo = Timeline.buildWaveform({ channels: [left, right], sampleRate: 8000 }, { bucketCount: 2 });
assert.deepEqual(stereo.buckets.map((bucket) => [bucket.min, bucket.max]), [[-0.9, 0.2], [0.3, 0.9]]);

// AudioBuffer-like objects and duration prefixes use the same pure result contract.
const bufferLike = {
  numberOfChannels: 2,
  length: 4,
  sampleRate: 8000,
  getChannelData(index) { return index === 0 ? left : right; }
};
assert.deepEqual(Timeline.buildWaveform(bufferLike, { bucketCount: 2 }).buckets, stereo.buckets);
const prefix = Timeline.buildWaveform({ samples: mono, sampleRate: 8000 }, { bucketCount: 2, durationMs: 0.5 });
assert.equal(prefix.sampleCount, 4);
assert.equal(prefix.durationMs, 0.5);

assert.throws(() => Timeline.buildWaveform({ samples: new Float32Array([0, NaN]), sampleRate: 8000 }), /finite/);
assert.throws(() => Timeline.buildWaveform({ samples: new Float32Array([0, 1.1]), sampleRate: 8000 }), /normalized/);
assert.throws(() => Timeline.buildWaveform({ channels: [new Float32Array(2), new Float32Array(3)], sampleRate: 8000 }), /matching lengths/);
assert.throws(() => Timeline.buildWaveform({ samples: mono, channels: [mono], sampleRate: 8000 }), /exactly one/);
assert.throws(() => Timeline.buildWaveform({ samples: mono, sampleRate: 8000 }, { bucketCount: 0 }), /bucketCount/);
assert.throws(() => Timeline.buildWaveform({ samples: mono, sampleRate: 8000 }, { smooth: true }), /Unknown waveform option/);

// Time/x mapping clamps pointer overflow and remains endpoint-stable.
assert.equal(Timeline.timeToX(0, 10000, 1000), 0);
assert.equal(Timeline.timeToX(5000, 10000, 1000), 500);
assert.equal(Timeline.timeToX(11000, 10000, 1000), 1000);
assert.equal(Timeline.xToTime(-50, 10000, 1000), 0);
assert.equal(Timeline.xToTime(333.3, 10000, 1000), 3333);
assert.equal(Timeline.xToTime(1200, 10000, 1000), 10000);
assert.throws(() => Timeline.xToTime(NaN, 10000, 1000), /finite/);

const lyrics = [
  { startMs: 100, endMs: 500, text: 'A' },
  { startMs: 700, endMs: 1100, text: 'B' },
  { startMs: 1500, endMs: 2000, text: 'C' }
];
const edits = [
  { timeMs: 250, action: 'accent', intensity: 0.8, targetSceneId: null },
  { timeMs: 1000, action: 'cut', intensity: 1, targetSceneId: 'scene-2' },
  { timeMs: 1800, action: 'hold', intensity: 0.5, targetSceneId: null }
];
const mappedLyrics = Timeline.mapLyrics(lyrics, 2000, 1000);
assert.deepEqual(mappedLyrics.map((cue) => [cue.xStart, cue.xEnd, cue.width]), [[50, 250, 200], [350, 550, 200], [750, 1000, 250]]);
assert.deepEqual(Timeline.mapBeatEdits(edits, 2000, 1000).map((edit) => edit.x), [125, 500, 900]);
const productionMap = Timeline.mapProduction({
  schema: 'signal-field-production/v1', version: 1,
  project: { timeline: { durationMs: 2000 } }, lyrics, beatEdits: edits
}, 1000);
assert.equal(productionMap.durationMs, 2000);
assert.deepEqual(productionMap.lyrics, mappedLyrics);

// Dragging lyric edges and ranges clamps against duration and neighboring cues.
const startClamped = Timeline.moveLyric(lyrics, 1, { type: 'drag', handle: 'start', deltaMs: -500 }, { durationMs: 2200, minimumDurationMs: 100 });
assert.equal(startClamped[1].startMs, 500);
const endClamped = Timeline.moveLyric(lyrics, 1, { type: 'drag', handle: 'end', deltaMs: 800 }, { durationMs: 2200, minimumDurationMs: 100 });
assert.equal(endClamped[1].endMs, 1500);
const rangeClamped = Timeline.moveLyric(lyrics, 1, { type: 'drag', handle: 'range', deltaMs: 1000 }, { durationMs: 2200, minimumDurationMs: 100 });
assert.deepEqual([rangeClamped[1].startMs, rangeClamped[1].endMs], [1100, 1500]);
const keyboard = Timeline.moveLyric(lyrics, 0, { type: 'keyboard', handle: 'end', direction: -1, stepMs: 50 }, { durationMs: 2200, minimumDurationMs: 100 });
assert.equal(keyboard[0].endMs, 450);
assert.deepEqual(lyrics[1], { startMs: 700, endMs: 1100, text: 'B' });
assert.throws(() => Timeline.moveLyric([
  { startMs: 100, endMs: 500, text: 'A' }, { startMs: 499, endMs: 700, text: 'B' }
], 0, { type: 'drag', handle: 'end', deltaMs: 1 }, { durationMs: 1000, minimumDurationMs: 100 }), /must not overlap/);
assert.throws(() => Timeline.moveLyric([{ startMs: 0, endMs: 50, text: 'short' }], 0,
  { type: 'keyboard', handle: 'range', direction: 1 }, { durationMs: 1000, minimumDurationMs: 100 }), /at least 100/);
assert.throws(() => Timeline.moveLyric(lyrics, 1, { type: 'keyboard', handle: 'range', direction: 0 }, { durationMs: 2200 }), /-1 or 1/);

// Beat edits snap to an explicit grid or generated tempo grid without crossing neighbors.
assert.deepEqual(Timeline.buildBeatGrid({ durationMs: 2000, beatMs: 500 }), [0, 500, 1000, 1500, 2000]);
assert.deepEqual(Timeline.buildBeatGrid({ durationMs: 2000, beatMs: 500, beatOffsetMs: 250 }), [250, 750, 1250, 1750]);
const snapped = Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 480 }, {
  durationMs: 2000, snap: true, beatGridMs: [0, 500, 1000, 1500, 2000], snapToleranceMs: 50
});
assert.equal(snapped[0].timeMs, 500);
const unsnapped = Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 350 }, {
  durationMs: 2000, snap: true, beatGridMs: [0, 500, 1000, 1500, 2000], snapToleranceMs: 50
});
assert.equal(unsnapped[0].timeMs, 350);
const tempoSnapped = Timeline.moveBeatEdit(edits, 2, { type: 'keyboard', direction: -1, stepMs: 270 }, {
  durationMs: 2000, snap: true, beatMs: 500, snapToleranceMs: 50
});
assert.equal(tempoSnapped[2].timeMs, 1500);
const neighborClamped = Timeline.moveBeatEdit(edits, 1, { type: 'drag', timeMs: 200 }, { durationMs: 2000, minimumGapMs: 10 });
assert.equal(neighborClamped[1].timeMs, 260);
assert.deepEqual(edits[1], { timeMs: 1000, action: 'cut', intensity: 1, targetSceneId: 'scene-2' });
assert.throws(() => Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 500 }, { durationMs: 2000, snap: true }), /exactly one/);
assert.throws(() => Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 500 }, { durationMs: 2000, snap: true, beatGridMs: [] }), /cannot be empty/);
assert.throws(() => Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 500 }, {
  durationMs: 2000, snap: true, beatGridMs: [0, 500], beatOffsetMs: 10
}), /only be used with beatMs/);
assert.throws(() => Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: 500 }, { durationMs: 2000, beatMs: 500 }), /snap: true/);
assert.throws(() => Timeline.moveBeatEdit(edits, 0, { type: 'drag', timeMs: Infinity }, { durationMs: 2000 }), /finite/);

// Browser-global UMD path exposes the same dependency-free API.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'timeline-editor-core.js'), 'utf8');
const browser = {
  JSON, Math, Number, String, Boolean, Object, Array, Set,
  Float32Array, Float64Array, TypeError, RangeError, Error
};
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(source, browser, { filename: 'timeline-editor-core.js' });
assert.equal(typeof browser.SignalFieldTimelineEditorCore.buildWaveform, 'function');
assert.equal(typeof browser.SignalFieldTimelineEditorCore.moveLyric, 'function');
assert.equal(typeof browser.SignalFieldTimelineEditorCore.moveBeatEdit, 'function');
assert.equal(browser.SignalFieldTimelineEditorCore.VERSION, Timeline.VERSION);

console.log('PASS bounded waveform buckets, PCM/AudioBuffer inputs, time/x mapping, production mapping, constrained lyric drag/keyboard edits, beat snapping, invalid-input isolation, immutability, and UMD');
