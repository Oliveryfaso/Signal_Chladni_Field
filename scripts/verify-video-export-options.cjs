const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');
const ExportVideo = require('./export-video.cjs');

function expectError(action, pattern) {
  assert.throws(action, pattern);
}

function output(directory, name) {
  return path.join(directory, name || 'video.mp4');
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-field-video-options-'));

try {
  assert.deepEqual(ExportVideo.aspectDimensions('16:9'), { width: 1920, height: 1080 });
  assert.deepEqual(ExportVideo.aspectDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(ExportVideo.aspectDimensions('1:1'), { width: 1080, height: 1080 });
  expectError(() => ExportVideo.aspectDimensions('4:3'), /Unknown aspect/);

  const parsed = ExportVideo.parseArgs(['--aspect', '9:16', '--fps', '30', '--alpha']);
  assert.deepEqual(parsed, { aspect: '9:16', fps: '30', alpha: true });
  expectError(() => ExportVideo.parseArgs(['--template', 'unknown']), /Unknown option/);

  const landscape = ExportVideo.loadOptions(['--output', output(directory), '--aspect', '16:9']);
  assert.equal(landscape.width, 1920);
  assert.equal(landscape.height, 1080);
  assert.equal(landscape.aspect, '16:9');
  assert.equal(landscape.secondsExplicit, false);

  const portrait = ExportVideo.loadOptions(['--output', output(directory), '--aspect', '9:16']);
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.height, 1920);

  const square = ExportVideo.loadOptions(['--output', output(directory), '--aspect', '1:1']);
  assert.equal(square.width, 1080);
  assert.equal(square.height, 1080);

  const legacy = ExportVideo.loadOptions(['--output', output(directory), '--width', '1280', '--height', '720']);
  assert.equal(legacy.width, 1280);
  assert.equal(legacy.height, 720);
  assert.equal(legacy.aspect, null);
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--aspect', '16:9', '--width', '1280']),
    /cannot be combined/
  );

  const first = SceneStudio.createSnapshot({
    style: 'cosmic',
    parameters: { zoom: 1, particles: 0.12, light: 8, rotationSpeed: 0.5 }
  });
  const last = SceneStudio.createSnapshot({
    style: 'dcosmic',
    parameters: { zoom: 5, particles: 0.3, light: 9, rotationSpeed: 1.5 }
  });
  const project = SceneStudio.createProject({
    title: 'Video export test',
    scenes: [
      { id: 'scene-first', name: 'First', snapshot: first },
      { id: 'scene-cut', name: 'Hard cut', snapshot: SceneStudio.createSnapshot({ style: 'sand', parameters: { zoom: 2 } }) }
    ],
    timeline: {
      durationMs: 4000,
      keyframes: [
        { id: 'intro', timeMs: 0, snapshot: first },
        { id: 'outro', timeMs: 4000, snapshot: last }
      ]
    }
  });
  const projectFile = path.join(directory, 'project.json');
  fs.writeFileSync(projectFile, JSON.stringify(project));

  const projectOptions = ExportVideo.loadOptions([
    '--output', output(directory), '--aspect', '1:1', '--project', projectFile
  ]);
  assert.equal(projectOptions.seconds, 4);
  assert.equal(projectOptions.frameCount, 240);
  assert.equal(projectOptions.style, first.style);
  assert.equal(projectOptions.project.timeline.durationMs, 4000);
  assert.equal(projectOptions.pattern.goal, first.pattern.goal);

  const truncated = ExportVideo.loadOptions([
    '--output', output(directory), '--project', projectFile, '--seconds', '2', '--fps', '30'
  ]);
  assert.equal(truncated.seconds, 2);
  assert.equal(truncated.frameCount, 60);
  assert.equal(truncated.secondsExplicit, true);
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--project', projectFile, '--seconds', '4.01']),
    /must not exceed/
  );
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--project', projectFile, '--style', 'sand']),
    /cannot be combined/
  );

  const middle = ExportVideo.timelineSnapshotAt(projectOptions.project, 2000);
  assert.equal(middle.timeMs, 2000);
  assert.equal(middle.progress, 0.5);
  assert.equal(middle.snapshot.parameters.zoom, 3);
  assert.equal(middle.snapshot.style, 'cosmic');
  assert.equal(ExportVideo.timelineSnapshotAt(projectOptions.project, 4000).snapshot.style, 'dcosmic');

  const production = ProductionSpec.create({
    project,
    aspect: '9:16',
    titleCard: { template: 'cinematic', mainTitle: 'Production export', subtitle: 'Verified', durationMs: 1200 },
    lyrics: [{ startMs: 250, endMs: 1000, text: 'Visible in final PNG' }],
    beatEdits: [
      { timeMs: 700, action: 'accent', intensity: 0.8 },
      { timeMs: 1010, action: 'cut', targetSceneId: 'scene-cut' },
      { timeMs: 1800, action: 'hold', intensity: 0.5 }
    ],
    output: { codec: 'prores', fileName: 'production-default.mov' }
  });
  const productionFile = path.join(directory, 'production.json');
  fs.writeFileSync(productionFile, ProductionSpec.export(production));
  const productionOptions = ExportVideo.loadOptions(['--production', productionFile, '--fps', '30']);
  assert.equal(productionOptions.width, 1080);
  assert.equal(productionOptions.height, 1920);
  assert.equal(productionOptions.aspect, '9:16');
  assert.equal(productionOptions.codec, 'prores');
  assert.equal(productionOptions.output, path.join(directory, 'production-default.mov'));
  assert.equal(productionOptions.seconds, 4);
  assert.equal(productionOptions.production.titleCard.template, 'cinematic');
  assert.deepEqual(ExportVideo.loadProductionSpec(productionFile).production, production);

  // A cut between frame boundaries is consumed on the first following frame and
  // remains a hard scene until the next authored timeline keyframe.
  assert.equal(ExportVideo.productionSnapshotAt(production, 1000).beatCut, undefined);
  const crossedCut = ExportVideo.productionSnapshotAt(production, 1033.333);
  assert.equal(crossedCut.snapshot.style, 'sand');
  assert.deepEqual(crossedCut.beatCut, { timeMs: 1010, targetSceneId: 'scene-cut' });
  assert.equal(ExportVideo.productionSnapshotAt(production, 3999).snapshot.style, 'sand');
  assert.equal(ExportVideo.productionSnapshotAt(production, 4000).snapshot.style, 'dcosmic');
  assert.equal(ExportVideo.productionSnapshotAt(production, 4000, 1000).snapshot.style, 'sand');
  const resetCutProduction = ProductionSpec.create({
    ...production,
    beatEdits: production.beatEdits.concat([{ timeMs: 3000, action: 'cut' }])
  });
  assert.equal(ExportVideo.productionSnapshotAt(resetCutProduction, 3500).snapshot.style, 'cosmic');
  const lowFpsEffects = ExportVideo.productionFrameEffects(production, 0, 2000);
  assert.equal(lowFpsEffects.accentPulse, 0.8);
  assert.equal(lowFpsEffects.holdPulse, 0.5);
  assert.deepEqual(lowFpsEffects.crossed.map((edit) => edit.action), ['accent', 'cut', 'hold']);

  const productionOverride = ExportVideo.loadOptions([
    '--production', productionFile, '--output', output(directory, 'override.mp4'), '--codec', 'h264', '--aspect', '1:1'
  ]);
  assert.equal(productionOverride.codec, 'h264');
  assert.equal(productionOverride.width, 1080);
  assert.equal(productionOverride.height, 1080);
  assert.equal(productionOverride.production.aspect, '1:1');
  expectError(
    () => ExportVideo.loadOptions(['--production', productionFile, '--project', projectFile, '--output', output(directory)]),
    /cannot be combined with --project/
  );
  expectError(
    () => ExportVideo.loadOptions(['--production', productionFile, '--style', 'sand']),
    /--production cannot be combined/
  );
  expectError(
    () => ExportVideo.loadOptions(['--production', productionFile, '--width', '720']),
    /production aspect cannot be combined/
  );
  expectError(
    () => ExportVideo.loadOptions(['--production', productionFile, '--output', output(directory)]),
    /ProRes output must use a .mov extension/
  );

  const invalidJson = path.join(directory, 'invalid-json.json');
  fs.writeFileSync(invalidJson, '{');
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--project', invalidJson]),
    /Invalid project JSON/
  );

  const emptyProject = path.join(directory, 'empty-project.json');
  fs.writeFileSync(emptyProject, SceneStudio.exportProject(SceneStudio.createProject({ title: 'Empty' })));
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--project', emptyProject]),
    /non-empty timeline/
  );

  const wrongSchema = path.join(directory, 'wrong-schema.json');
  fs.writeFileSync(wrongSchema, JSON.stringify({ ...project, schema: 'not-signal-field' }));
  expectError(
    () => ExportVideo.loadOptions(['--output', output(directory), '--project', wrongSchema]),
    /Unexpected project schema/
  );

  const wrongProduction = path.join(directory, 'wrong-production.json');
  fs.writeFileSync(wrongProduction, JSON.stringify({ ...production, schema: 'not-production' }));
  expectError(
    () => ExportVideo.loadOptions(['--production', wrongProduction]),
    /Unsupported production specification schema/
  );

  console.log('PASS video export arguments, production defaults, title/lyric spec loading, aspect presets, strict scene projects, cross-frame beat cuts, conflicts, duration bounds, and timeline seek');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
