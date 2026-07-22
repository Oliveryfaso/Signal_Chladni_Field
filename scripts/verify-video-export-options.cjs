const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SceneStudio = require('../app/scene-studio.js');
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

  console.log('PASS video export arguments, aspect presets, strict scene projects, duration bounds, and timeline seek');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
