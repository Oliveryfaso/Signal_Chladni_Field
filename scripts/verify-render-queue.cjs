const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');
const ExportVideo = require('./export-video.cjs');
const { createRenderQueue, taskArguments, validateTaskInput } = require('../desktop/render-queue.cjs');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    return true;
  };
  return child;
}

function validProject(directory) {
  const snapshot = SceneStudio.createSnapshot({ style: 'cosmic' });
  const project = SceneStudio.createProject({
    title: 'Render queue test',
    timeline: {
      durationMs: 1000,
      keyframes: [
        { id: 'start', timeMs: 0, snapshot },
        { id: 'end', timeMs: 1000, snapshot }
      ]
    }
  });
  const file = path.join(directory, 'project.json');
  fs.writeFileSync(file, SceneStudio.exportProject(project));
  return file;
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-field-render-queue-'));
  try {
    const project = validProject(directory);
    const audio = path.join(directory, 'song.wav');
    const exporter = path.join(directory, 'export-video.cjs');
    fs.writeFileSync(audio, Buffer.from('RIFF-test-audio'));
    fs.writeFileSync(exporter, '// mock exporter');
    const production = path.join(directory, 'production.json');
    fs.writeFileSync(production, ProductionSpec.export(ProductionSpec.create({
      project: SceneStudio.importProject(fs.readFileSync(project, 'utf8')),
      aspect: '9:16',
      output: { codec: 'h264', fileName: 'production.mp4' }
    })));

    const normalized = validateTaskInput({
      project,
      audio,
      output: path.join(directory, 'video.mp4'),
      aspect: '9:16',
      codec: 'h264'
    });
    assert.equal(normalized.aspect, '9:16');
    assert.equal(normalized.codec, 'h264');
    assert.deepEqual(taskArguments(normalized), [
      '--project', project,
      '--output', path.join(directory, 'video.mp4'),
      '--aspect', '9:16',
      '--codec', 'h264',
      '--audio', audio
    ]);
    assert.throws(() => validateTaskInput(null), /must be an object/);
    assert.throws(() => validateTaskInput({ project, production, output: path.join(directory, 'x.mp4') }), /exactly one/);
    assert.throws(() => validateTaskInput({ output: path.join(directory, 'x.mp4') }), /exactly one/);
    assert.throws(() => validateTaskInput({ project, output: path.join(directory, 'x.mp4'), command: 'rm' }), /unknown/);
    assert.throws(() => validateTaskInput({ project, output: path.join(directory, 'x.mp4'), aspect: '4:3' }), /aspect/);
    assert.throws(() => validateTaskInput({ project, output: path.join(directory, 'x.mov'), codec: 'h264' }), /does not match/);
    assert.throws(() => validateTaskInput({ project, audio: path.join(directory, 'missing.wav'), output: path.join(directory, 'x.mp4') }), /unavailable/);

    const existingOutput = path.join(directory, 'existing.mp4');
    fs.writeFileSync(existingOutput, 'existing');
    assert.throws(() => validateTaskInput({ project, output: existingOutput }), /already exists/);
    assert.doesNotThrow(() => validateTaskInput({ project, output: existingOutput }, { allowExistingOutput: true }));
    const productionTask = validateTaskInput({ production, audio, output: path.join(directory, 'production.mp4') });
    assert.equal(productionTask.project, null);
    assert.equal(productionTask.aspect, '9:16');
    assert.equal(productionTask.codec, 'h264');
    assert.deepEqual(taskArguments(productionTask), [
      '--production', production,
      '--output', path.join(directory, 'production.mp4'),
      '--audio', audio
    ]);
    const productionExport = ExportVideo.loadOptions(taskArguments(productionTask));
    assert.equal(productionExport.production.schema, ProductionSpec.SCHEMA);
    assert.equal(productionExport.aspect, '9:16');
    assert.equal(productionExport.codec, 'h264');
    assert.throws(
      () => validateTaskInput({ production, output: path.join(directory, 'mismatch.mp4'), aspect: '1:1' }),
      /must match/
    );
    const invalidProduction = path.join(directory, 'invalid-production.json');
    fs.writeFileSync(invalidProduction, '{}');
    assert.throws(
      () => validateTaskInput({ production: invalidProduction, output: path.join(directory, 'invalid.mp4') }),
      /production is invalid/
    );

    const children = [];
    const spawnCalls = [];
    let id = 0;
    const queue = createRenderQueue({
      root: directory,
      exportScript: exporter,
      electronPath: '/mock/electron',
      makeId: () => `task-${++id}`,
      spawn: (command, args, options) => {
        const child = createChild();
        children.push(child);
        spawnCalls.push({ command, args, options });
        return child;
      }
    });
    const events = [];
    const unsubscribe = queue.onChange((task) => events.push(task));
    const first = queue.enqueue({ project, audio, output: path.join(directory, 'first.mp4'), aspect: '16:9' });
    const second = queue.enqueue({ project, output: path.join(directory, 'second.mov'), aspect: '1:1', codec: 'prores' });
    assert.equal(first.status, 'queued');
    assert.equal(second.status, 'queued');
    assert.throws(() => queue.enqueue({ project, output: path.join(directory, 'second.mov') }), /already in/);
    await flush();

    assert.equal(spawnCalls.length, 1, 'queue must execute only one child at a time');
    assert.equal(spawnCalls[0].command, '/mock/electron');
    assert.equal(spawnCalls[0].options.shell, false);
    assert.equal(spawnCalls[0].args[0], exporter);
    assert.ok(spawnCalls[0].args.includes(project));
    children[0].stdout.emit('data', Buffer.from('Rendered 25/100 frames\n'));
    assert.equal(queue.list()[0].progress, 0.25);
    assert.equal(queue.list()[0].renderedFrames, 25);
    fs.writeFileSync(path.join(directory, 'first.mp4'), 'rendered');
    children[0].emit('close', 0, null);
    await flush();
    assert.equal(queue.list()[0].status, 'completed');
    assert.equal(queue.list()[0].progress, 1);
    assert.equal(spawnCalls.length, 2, 'next task starts only after the first closes');
    assert.equal(queue.list()[1].status, 'running');

    const cancelled = queue.cancel(second.id);
    assert.equal(cancelled.status, 'running', 'running task remains running until its child closes');
    assert.equal(children[1].killedWith, 'SIGTERM');
    children[1].emit('close', null, 'SIGTERM');
    await flush();
    assert.equal(queue.list()[1].status, 'cancelled');

    const third = queue.enqueue({ project, output: path.join(directory, 'third.mp4') });
    const fourth = queue.enqueue({ project, output: path.join(directory, 'fourth.mp4') });
    await flush();
    assert.equal(queue.list().find((task) => task.id === third.id).status, 'running');
    assert.equal(queue.cancel(fourth.id).status, 'cancelled');
    assert.equal(spawnCalls.length, 3, 'cancelling a queued task must not spawn a process');
    children[2].stderr.emit('data', Buffer.from('encoder failed'));
    children[2].emit('close', 1, null);
    await flush();
    assert.equal(queue.list().find((task) => task.id === third.id).status, 'failed');
    assert.match(queue.list().find((task) => task.id === third.id).error, /encoder failed/);

    const listed = queue.list();
    listed[0].status = 'tampered';
    assert.equal(queue.list()[0].status, 'completed', 'public task snapshots must not mutate queue state');
    assert.ok(events.some((task) => task.status === 'running' && task.progress === 0.25));
    unsubscribe();
    queue.shutdown();
    console.log('PASS strict render queue validation, serial execution, progress, cancellation, failure, and shell-free spawn');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
