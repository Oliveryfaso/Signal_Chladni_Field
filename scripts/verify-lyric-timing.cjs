'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Director = require('../app/music-director.js');
const LyricTiming = require('../app/lyric-timing.js');

const sampleRate = 8000;
const samples = new Float32Array(sampleRate * 12);
for (let index = 0; index < samples.length; index += 1) {
  const time = index / sampleRate;
  const pulse = index % (sampleRate / 2);
  samples[index] = time < 1 || time > 11 ? 0 : (pulse < 80 ? (1 - pulse / 80) * 0.85 : Math.sin(time * Math.PI * 2 * 220) * 0.08);
}
const analysis = Director.analyzeMono({ samples, sampleRate }, { frameRate: 20 });
const source = 'First short line\nA considerably longer second lyric line\n第三行歌词\n最后一句';
const first = LyricTiming.createDraft(source, analysis);
const second = LyricTiming.createDraft(source, analysis);
assert.deepEqual(first, second, 'timing drafts must be deterministic');
assert.equal(first.lyrics.length, 4);
assert.equal(first.diagnostics.speechAligned, false);
assert.equal(first.diagnostics.requiresReview, true);
assert.ok(first.diagnostics.confidence <= 0.6);
assert.ok(first.diagnostics.startMs >= 0);
assert.ok(first.diagnostics.endMs <= analysis.durationMs);
first.lyrics.forEach((cue, index) => {
  assert.ok(cue.startMs >= 0 && cue.endMs <= analysis.durationMs);
  assert.ok(cue.endMs - cue.startMs >= 100);
  if (index) assert.ok(cue.startMs >= first.lyrics[index - 1].endMs, 'cues must not overlap');
});
assert.ok(
  first.lyrics[1].endMs - first.lyrics[1].startMs > first.lyrics[0].endMs - first.lyrics[0].startMs,
  'longer lines should receive more time'
);

const manualWindow = LyricTiming.createDraft('One\nTwo', analysis, { introMs: 2000, outroMs: 1500, snapToBeat: false });
assert.equal(manualWindow.lyrics[0].startMs, 2000);
assert.equal(manualWindow.lyrics[1].endMs, analysis.durationMs - 1500);
assert.equal(manualWindow.diagnostics.beatSnapped, false);

assert.throws(() => LyricTiming.createDraft('', analysis), /at least one/);
assert.throws(() => LyricTiming.createDraft('[00:01.00] already timed', analysis), /Timed LRC/);
assert.throws(() => LyricTiming.createDraft('line', analysis, { typo: true }), /Unknown lyric timing option/);
assert.throws(() => LyricTiming.createDraft('line', {}, {}), /music-analysis/);
assert.throws(() => LyricTiming.createDraft('x'.repeat(501), analysis), /exceeds 500/);

const browserSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'lyric-timing.js'), 'utf8');
const browser = {
  JSON, Math, Number, String, Boolean, Object, Array,
  TypeError, RangeError, Error
};
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(browserSource, browser, { filename: 'lyric-timing.js' });
assert.equal(typeof browser.SignalFieldLyricTiming.createDraft, 'function');
assert.equal(browser.SignalFieldLyricTiming.VERSION, LyricTiming.VERSION);

console.log('PASS deterministic local line timing, bounded cue allocation, optional beat snapping, explicit review diagnostics, strict invalid-input handling, and UMD');
