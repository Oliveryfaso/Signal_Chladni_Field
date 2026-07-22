'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Overlay = require('../app/production-overlay.js');

function spec(template) {
  return {
    schema: 'signal-field-production/v1', version: 1, aspect: '9:16',
    titleCard: { template: template, mainTitle: 'Signal Field', subtitle: 'Music visual', durationMs: template === 'none' ? 0 : 2000 },
    lyrics: [
      { startMs: 500, endMs: 1000, text: 'First line' },
      { startMs: 1000, endMs: 1600, text: '第二行' }
    ],
    beatEdits: [
      { timeMs: 700, action: 'accent', intensity: 0.8, targetSceneId: null },
      { timeMs: 1200, action: 'hold', intensity: 0.5, targetSceneId: null }
    ]
  };
}

function fakeCanvas(width, height) {
  const calls = [];
  const context = {
    canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    setTransform(...args) { calls.push(['setTransform', ...args]); }, clearRect(...args) { calls.push(['clearRect', ...args]); },
    fillRect(...args) { calls.push(['fillRect', ...args]); }, strokeRect(...args) { calls.push(['strokeRect', ...args]); },
    fillText(...args) { calls.push(['fillText', ...args]); }, translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); }, measureText(text) { return { width: String(text).length * 12 }; }
  };
  const canvas = { width, height, getContext(kind) { assert.equal(kind, '2d'); return context; } };
  context.canvas = canvas;
  return { canvas, context, calls };
}

// Strict half-open display boundaries.
const cinematic = spec('cinematic');
assert.equal(Overlay.frameState(cinematic, -1).titleVisible, false);
assert.equal(Overlay.frameState(cinematic, 0).titleVisible, true);
assert.equal(Overlay.frameState(cinematic, 1999.999).titleVisible, true);
assert.equal(Overlay.frameState(cinematic, 2000).titleVisible, false);
assert.equal(Overlay.frameState(cinematic, 499).lyric, null);
assert.equal(Overlay.frameState(cinematic, 500).lyric.text, 'First line');
assert.equal(Overlay.frameState(cinematic, 999.999).lyric.text, 'First line');
assert.equal(Overlay.frameState(cinematic, 1000).lyric.text, '第二行');
assert.equal(Overlay.frameState(cinematic, 1600).lyric, null);
assert.equal(Overlay.frameState(spec('none'), 0).titleVisible, false);

// Beat actions are visibly consumed for a bounded duration and never fire early.
assert.equal(Overlay.frameState(cinematic, 699).accent, 0);
assert.equal(Overlay.frameState(cinematic, 700).accent, 0.8);
assert.ok(Overlay.frameState(cinematic, 800).accent > 0);
assert.equal(Overlay.frameState(cinematic, 981).accent, 0);
assert.equal(Overlay.frameState(cinematic, 1199).hold, 0);
assert.equal(Overlay.frameState(cinematic, 1200).hold, 0.5);
assert.ok(Overlay.frameState(cinematic, 1600).hold > 0);
assert.equal(Overlay.frameState(cinematic, 1701).hold, 0);
assert.equal(Overlay.frameState(cinematic, 0, { accentPulse: 0.6 }).accent, 0.6);
assert.equal(Overlay.frameState(cinematic, 0, { holdPulse: 0.7 }).hold, 0.7);

// Every title template draws deterministically, respects DPR, safe areas, and reduced motion.
['minimal', 'cinematic', 'kinetic', 'none'].forEach((template) => {
  const target = fakeCanvas(2160, 3840);
  const result = Overlay.drawOverlay(target.canvas, spec(template), 750, { width: 1080, height: 1920, dpr: 2, reducedMotion: true });
  assert.equal(result.template, template);
  assert.equal(result.safeArea.x, 81);
  assert.equal(result.safeArea.y, 105.6);
  assert.ok(target.calls.some((call) => call[0] === 'clearRect'));
  assert.deepEqual(target.calls.find((call) => call[0] === 'setTransform'), ['setTransform', 2, 0, 0, 2, 0, 0]);
  if (template !== 'none') assert.ok(target.calls.some((call) => call[0] === 'fillText' && call[1] === 'Signal Field'));
  if (template === 'kinetic') {
    assert.ok(target.calls.some((call) => call[0] === 'rotate' && call[1] === 0));
  }
});

const landscape = fakeCanvas(1920, 1080);
const landscapeResult = Overlay.drawOverlay(landscape.context, Object.assign(spec('minimal'), { aspect: '16:9' }), 550, { reducedMotion: false });
assert.ok(Math.abs(landscapeResult.safeArea.x - 115.2) < 1e-9);
assert.equal(landscapeResult.safeArea.y, 81);
assert.equal(landscapeResult.lyric.text, 'First line');
assert.ok(landscape.calls.some((call) => call[0] === 'fillText' && call[1] === 'First line'));

const square = fakeCanvas(1080, 1080);
assert.ok(Math.abs(Overlay.drawOverlay(square.canvas, Object.assign(spec('minimal'), { aspect: '1:1' }), 0).safeArea.x - 75.6) < 1e-9);
Overlay.clearOverlay(square.canvas);
assert.throws(() => Overlay.frameState({}, 0), /canonical/);
assert.throws(() => Overlay.frameState(cinematic, NaN), /finite/);
assert.throws(() => Overlay.drawOverlay({}, cinematic, 0), /Canvas/);

// Browser-global UMD exposes exactly the same reusable preview/export API.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'production-overlay.js'), 'utf8');
const browser = { JSON, Math, Number, String, Boolean, Object, Array, Set, TypeError, RangeError, Error };
browser.window = browser;
browser.globalThis = browser;
vm.runInNewContext(source, browser, { filename: 'production-overlay.js' });
assert.equal(typeof browser.SignalFieldProductionOverlay.drawOverlay, 'function');
assert.equal(typeof browser.SignalFieldProductionOverlay.clearOverlay, 'function');
assert.equal(browser.SignalFieldProductionOverlay.VERSION, Overlay.VERSION);

console.log('PASS overlay title templates, lyric boundaries, beat accent/hold effects, DPR, aspect safe areas, reduced motion, Canvas context, and UMD');
