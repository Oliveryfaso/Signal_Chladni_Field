'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Events = require('../app/data-field-events.js');

function expectThrows(run, message) {
  assert.throws(run, message);
}

const readings = [
  10, 10.1, 9.9, 10.05, 10.02, 9.98, 10.04, 10.08, 10.01, 10.03,
  10.06, 10.02, 10.1, 42, 10.03, 9.97, 10.05, 10.02
];

const detection = Events.detectAnomalies(readings, {
  metric: 'requests_per_minute',
  windowSize: 8,
  minHistory: 6,
  sensitivity: 3
});

assert.equal(detection.metric, 'requests_per_minute');
assert.ok(detection.events.length >= 1, 'the deliberate spike should be detected');
const spike = detection.events.find((event) => event.index === 13);
assert.ok(spike, 'the spike index should remain tied to the input row');
assert.equal(spike.direction, 'rise');
assert.ok(spike.score > 3);

const bookmark = Events.createEvent(spike, {
  id: 'load-spike',
  title: '午间负载峰值',
  note: '检查批处理任务。',
  tags: ['ops', 'spike', 'ops'],
  dataset: 'optional-safe-label',
  createdAt: '2026-07-20T10:00:00.000Z'
});

assert.deepEqual(bookmark.tags, ['ops', 'spike']);
assert.equal(bookmark.id, 'load-spike');
assert.equal(bookmark.metric, 'requests_per_minute');

const exported = Events.serializeBookmarks([bookmark], {
  dataset: 'optional-safe-label',
  exportedAt: '2026-07-20T10:01:00.000Z'
});
const imported = Events.deserializeBookmarks(exported);
assert.equal(imported.bookmarks.length, 1);
assert.equal(imported.bookmarks[0].title, '午间负载峰值');
assert.equal(imported.bookmarks[0].value, 42);
assert.ok(!exported.includes(readings.join(',')), 'exports must not contain the raw series');

const recipe = Events.sceneRecipeForEvent(imported.bookmarks[0], {
  mode: 'ensemble',
  participatingColumns: ['requests_per_minute', 'latency_ms']
});
assert.equal(recipe.eventId, 'load-spike');
assert.equal(recipe.driver.mode, 'ensemble');
assert.deepEqual(recipe.driver.participatingColumns, ['requests_per_minute', 'latency_ms']);
assert.equal(recipe.pattern.ex.length, 3);
assert.equal(recipe.modal.modes.length, 3);
assert.ok(recipe.pattern.goal >= 1 && recipe.pattern.goal <= 9);
assert.ok(recipe.timeline.replayRange.start <= 13 && recipe.timeline.replayRange.end >= 13);
recipe.modal.modes.forEach((mode) => {
  assert.ok(mode.l >= 1 && mode.l <= mode.m && mode.m <= mode.n && mode.n <= 10);
});

const rows = [
  { at: '2026-07-20T00:00:00Z', cpu: 0.2 },
  { at: '2026-07-20T00:01:00Z', cpu: 0.24 },
  { at: '2026-07-20T00:02:00Z', cpu: 0.22 }
];
const normalized = Events.normalizeSeries(rows, { column: 'cpu', timeColumn: 'at' });
assert.equal(normalized.samples[0].timestamp, '2026-07-20T00:00:00.000Z');
assert.equal(normalized.samples[2].value, 0.22);

expectThrows(() => Events.deserializeBookmarks('{not json}'), /parsed/);
expectThrows(() => Events.deserializeBookmarks('{"schemaVersion":1,"kind":"wrong","bookmarks":[]}'), /not a Signal Field/);

const browserContext = { window: {}, Date: Date, Math: Math, Set: Set, Object: Object, Array: Array, Number: Number, String: String, JSON: JSON, TypeError: TypeError, RangeError: RangeError };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/data-field-events.js'), 'utf8'), browserContext);
assert.equal(typeof browserContext.window.DataFieldEvents.detectAnomalies, 'function');

console.log('data-field-events: all checks passed');
