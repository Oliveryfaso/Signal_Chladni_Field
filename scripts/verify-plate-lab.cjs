'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PlateLabCore = require('../app/plate-lab-core.js');

function closeTo(actual, expected, relativeTolerance, message) {
  const relativeError = Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.EPSILON);
  assert.ok(relativeError <= relativeTolerance, (message || 'values are not close') + ': expected ' + expected + ', got ' + actual);
}

const steelSquare = {
  material: 'steel',
  boundary: 'simply-supported',
  width: 0.3,
  height: 0.3,
  thickness: 0.001,
  dampingRatio: 0.012,
  excitationPoint: { x: 0.5, y: 0.5 },
  modeCount: 12
};
const sourceSnapshot = JSON.stringify(steelSquare);
const plate = PlateLabCore.createPlateLab(steelSquare);
assert.equal(JSON.stringify(steelSquare), sourceSnapshot, 'input must not be mutated');
assert.equal(plate.mechanics.governingModel, 'Kirchhoff–Love thin plate');

// Analytic simply-supported (1,1) steel plate: approximately 53.15 Hz.
const fundamental = PlateLabCore.resolveMode(plate, { m: 1, n: 1 });
assert.ok(fundamental.frequencyHz > 50 && fundamental.frequencyHz < 56, 'known rectangular-plate frequency should have the right magnitude');
assert.equal(fundamental.coupling, 1);

// Kirchhoff–Love scaling: f ∝ thickness and f ∝ 1 / length².
const doubleThickness = PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { thickness: 0.002 }));
closeTo(doubleThickness.modes[0].frequencyHz / plate.modes[0].frequencyHz, 2, 1e-12, 'doubling thickness should double frequency');
const doubleSpan = PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { width: 0.6, height: 0.6 }));
closeTo(doubleSpan.modes[0].frequencyHz / plate.modes[0].frequencyHz, 0.25, 1e-12, 'doubling both spans should quarter frequency');

// A centered driver cannot couple to the (2,1) sine mode because x=0.5 is a node.
const nodeMode = PlateLabCore.resolveMode(plate, { m: 2, n: 1 });
assert.ok(Math.abs(nodeMode.coupling) < 1e-12, 'node coupling should be near zero');
assert.ok(Math.abs(PlateLabCore.modeShape(plate, { m: 2, n: 1 }, { x: 0.5, y: 0.5 })) < 1e-12);

const atResonance = PlateLabCore.frequencyResponse(plate, fundamental.frequencyHz);
const awayFromResonance = PlateLabCore.frequencyResponse(plate, fundamental.frequencyHz * 0.82);
assert.ok(atResonance.magnitude > awayFromResonance.magnitude * 3, 'damped modal compliance should peak near resonance');
assert.equal(atResonance.units, 'm/N (linear modal compliance approximation)');

const grid = PlateLabCore.sampleModeGrid(plate, { m: 2, n: 1 }, { columns: 33, rows: 17, nodeWidth: 0.08 });
assert.equal(grid.values.length, 33 * 17);
assert.ok(grid.nodeIntensity[8 * 33 + 16] > 0.99, 'center node should have high node intensity');
assert.ok(grid.nodeIntensity[8 * 33 + 8] < 0.1, 'anti-node should have low node intensity');

const clamped = PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { boundary: 'clamped-approx' }));
assert.ok(clamped.modes[0].frequencyHz > plate.modes[0].frequencyHz, 'clamped approximation should be stiffer than simply-supported');
assert.match(clamped.mechanics.boundaryNote, /Approximate/);
assert.equal(PlateLabCore.modeShape(clamped, 0, { x: 0, y: 0.5 }), 0, 'clamped approximation enforces displacement at the boundary');

const recipeA = PlateLabCore.createSoundMotionNativeRecipe(plate, { mode: { m: 1, n: 1 } });
const recipeB = PlateLabCore.createSoundMotionNativeRecipe(plate, { mode: { m: 1, n: 1 } });
assert.deepEqual(recipeA, recipeB, 'particle recipes must be deterministic');
assert.deepEqual(recipeA.allowedMethods, ['setStyle', 'setSampleMode', 'setRotationMode', 'setParam', 'applyPatternSpec']);
assert.match(recipeA.limitations.join(' '), /does not simulate grain-to-grain contact/);
assert.equal(recipeA.commands.every((command) => recipeA.allowedMethods.includes(command.method)), true);

assert.throws(() => PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { width: Number.NaN })), /width/);
assert.throws(() => PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { material: 'unknown' })), /material/);
assert.throws(() => PlateLabCore.createPlateLab(Object.assign({}, steelSquare, { material: 'steel', density: 1 })), /custom/);
assert.equal(plate.modes[0].frequencyHz, fundamental.frequencyHz, 'bad inputs must not contaminate an existing plate');

const browserContext = {
  window: {},
  ArrayBuffer,
  Array,
  Object,
  Number,
  String,
  Math,
  JSON,
  TypeError,
  RangeError
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/plate-lab-core.js'), 'utf8'), browserContext);
assert.equal(typeof browserContext.window.PlateLabCore.createPlateLab, 'function', 'UMD browser exposure should attach to window');
assert.equal(browserContext.window.PlateLabCore.createPlateLab(steelSquare).modes[0].m, 1);

console.log('plate-lab-core: all checks passed');
