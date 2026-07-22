'use strict';

const assert = require('node:assert/strict');
const FieldLab = require('../app/field-lab.js');

function closeTo(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label || 'value'}: expected ${expected}, received ${actual}`);
}

// Coordinates are safely clamped and a DOM rectangle maps to a usable 0..1 plate space.
assert.deepEqual(FieldLab.normalizedPoint({ x: -1, y: 2 }), { x: 0, y: 1 });
assert.deepEqual(
  FieldLab.pointerToNormalizedPoint({ clientX: 150, clientY: 75 }, { left: 50, top: 25, width: 200, height: 100 }),
  { x: 0.5, y: 0.5 }
);

// The (1,1) mode defines baseHz, while higher-order modes are physically higher in frequency.
closeTo(FieldLab.modalFrequency(1, 1, { baseHz: 48 }), 48, 1e-10, 'base mode');
assert.ok(FieldLab.modalFrequency(3, 2, { baseHz: 48 }) > FieldLab.modalFrequency(1, 1, { baseHz: 48 }));
const modes = FieldLab.buildModalBank({ baseHz: 48, maxOrder: 4 });
assert.equal(modes.length, 16);
assert.equal(modes[0].id, 'm1n1');

// A centre driver cannot excite m2n1 because that mode has a central node.
const nodeMode = { id: 'm2n1', m: 2, n: 1, frequencyHz: 80, order: 1 };
closeTo(FieldLab.excitationCoupling({ x: 0.5, y: 0.5 }, nodeMode), 0, 1e-10, 'node coupling');
assert.equal(FieldLab.describePointInMode({ x: 0.5, y: 0.5 }, nodeMode).region, 'node');
assert.equal(FieldLab.describePointInMode({ x: 0.25, y: 0.5 }, nodeMode).region, 'antinode');

// The recipe always uses only the public visualizer command API and has a full 16-band frame.
const recipe = FieldLab.createVisualizerCommandRecipe({
  excitation: { x: 0.25, y: 0.5 },
  frequencyHz: 80,
  baseHz: 48,
  maxOrder: 4,
  style: 'msand'
});
assert.equal(recipe.schema, 'signal-field/field-lab-recipe@1');
assert.equal(recipe.featureFrame.bands.length, FieldLab.BAND_COUNT);
assert.ok(recipe.featureFrame.bands.some((value) => value > 0));
assert.ok(recipe.primaryMode.coupling > 0.7, `unexpected coupling ${recipe.primaryMode.coupling}`);
assert.deepEqual(recipe.commands.map((command) => command.method), ['setStyle', 'setParam', 'setParam', 'setParam', 'applyPatternSpec']);
assert.equal(recipe.visualizer.patternSpec.style, 'msand');
assert.ok(recipe.visualizer.detail >= 0.55 && recipe.visualizer.detail <= 3);
assert.ok(recipe.visualizer.particles >= 0.08 && recipe.visualizer.particles <= 0.72);

// Application is deliberately constrained to the exposed renderer methods.
const calls = [];
const result = FieldLab.applyVisualizerRecipe(recipe, {
  setStyle: (...args) => calls.push(['setStyle', args]),
  setParam: (...args) => calls.push(['setParam', args]),
  applyPatternSpec: (...args) => calls.push(['applyPatternSpec', args])
});
assert.equal(result.applied.length, 5);
assert.equal(result.skipped.length, 0);
assert.equal(calls[4][1][0].goal, recipe.visualizer.patternSpec.goal);

console.log('PASS field lab pure physics, pointer mapping, recipe contract, and safe renderer application');
