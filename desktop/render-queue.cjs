// Signal Field modification notice (2026-07-22). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');

const ASPECTS = new Set(['16:9', '9:16', '1:1']);
const CODECS = new Set(['h264', 'prores']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.aif', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav']);
const INPUT_KEYS = new Set(['project', 'production', 'audio', 'output', 'aspect', 'codec']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_PATH_LENGTH = 4096;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTION_BYTES = 6 * 1024 * 1024;
const RENDER_WORKER_FLAG = '--signal-field-render-worker';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  if (value.includes('\0') || value.length > MAX_PATH_LENGTH) throw new Error(`${label} is invalid`);
  return path.resolve(value);
}

function optionalPath(value, label) {
  if (value == null || value === '') return null;
  return requiredPath(value, label);
}

function regularFile(file, label, maxBytes) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_error) {
    throw new Error(`${label} is unavailable`);
  }
  if (!stat.isFile()) throw new Error(`${label} must be a file`);
  if (stat.size <= 0 || stat.size > maxBytes) throw new Error(`${label} has an invalid size`);
}

function validateProject(projectFile) {
  regularFile(projectFile, 'project', MAX_PROJECT_BYTES);
  let project;
  try {
    project = SceneStudio.importProject(fs.readFileSync(projectFile, 'utf8'));
  } catch (error) {
    throw new Error(`project is invalid: ${error.message || error}`);
  }
  if (!project.timeline || project.timeline.durationMs <= 0 || !project.timeline.keyframes.length) {
    throw new Error('project requires a non-empty timeline with a positive duration');
  }
}

function validateProduction(productionFile) {
  regularFile(productionFile, 'production', MAX_PRODUCTION_BYTES);
  let production;
  try {
    production = ProductionSpec.import(fs.readFileSync(productionFile, 'utf8'));
  } catch (error) {
    throw new Error(`production is invalid: ${error.message || error}`);
  }
  return production;
}

function validateTaskInput(input, options = {}) {
  if (!isPlainObject(input)) throw new Error('render task must be an object');
  const unknown = Object.keys(input).find((key) => !INPUT_KEYS.has(key));
  if (unknown) throw new Error(`unknown render task field: ${unknown}`);

  const project = optionalPath(input.project, 'project');
  const production = optionalPath(input.production, 'production');
  if (Boolean(project) === Boolean(production)) throw new Error('render task requires exactly one of project or production');
  const audio = optionalPath(input.audio, 'audio');
  const output = requiredPath(input.output, 'output');
  const productionSpec = production ? validateProduction(production) : null;
  const aspect = input.aspect == null || input.aspect === ''
    ? (productionSpec ? productionSpec.aspect : '16:9')
    : input.aspect;
  if (typeof aspect !== 'string' || !ASPECTS.has(aspect)) throw new Error('aspect must be 16:9, 9:16, or 1:1');

  if (project) validateProject(project);
  if (productionSpec && aspect !== productionSpec.aspect) throw new Error('aspect must match the production specification');
  if (audio) {
    regularFile(audio, 'audio', MAX_AUDIO_BYTES);
    if (!AUDIO_EXTENSIONS.has(path.extname(audio).toLowerCase())) throw new Error('audio format is unsupported');
  }

  const extension = path.extname(output).toLowerCase();
  if (extension !== '.mp4' && extension !== '.mov') throw new Error('output must use a .mp4 or .mov extension');
  const inferredCodec = extension === '.mp4' ? 'h264' : 'prores';
  const codec = input.codec == null || input.codec === '' ? inferredCodec : input.codec;
  if (typeof codec !== 'string' || !CODECS.has(codec)) throw new Error('codec must be h264 or prores');
  if ((codec === 'h264' && extension !== '.mp4') || (codec === 'prores' && extension !== '.mov')) {
    throw new Error('codec does not match the output extension');
  }
  if (productionSpec && codec !== productionSpec.output.codec) throw new Error('codec must match the production specification');
  if (output === project || output === production || (audio && output === audio)) {
    throw new Error('output must not overwrite an input file');
  }
  if (fs.existsSync(output) && !options.allowExistingOutput) throw new Error('output already exists');

  const outputDirectory = path.dirname(output);
  let outputDirectoryStat;
  try {
    outputDirectoryStat = fs.statSync(outputDirectory);
    fs.accessSync(outputDirectory, fs.constants.W_OK);
  } catch (_error) {
    throw new Error('output directory is unavailable or not writable');
  }
  if (!outputDirectoryStat.isDirectory()) throw new Error('output directory must be a directory');

  return { project, production, audio, output, aspect, codec };
}

function taskArguments(task) {
  const args = task.production
    ? ['--production', task.production, '--output', task.output]
    : [
        '--project', task.project,
        '--output', task.output,
        '--aspect', task.aspect,
        '--codec', task.codec
      ];
  if (task.audio) args.push('--audio', task.audio);
  return args;
}

function extractRenderWorkerArguments(argv) {
  if (!Array.isArray(argv)) throw new Error('worker arguments must be an array');
  const markerIndex = argv.indexOf(RENDER_WORKER_FLAG);
  return markerIndex < 0 ? null : argv.slice(markerIndex + 1);
}

function renderWorkerLaunch(options, task) {
  if (!isPlainObject(options)) throw new Error('worker launch options must be an object');
  if (typeof options.electronPath !== 'string' || !options.electronPath) {
    throw new Error('worker electron path is required');
  }
  if (!options.isPackaged && (typeof options.bootstrapScript !== 'string' || !options.bootstrapScript)) {
    throw new Error('worker bootstrap script is required in development');
  }
  const args = options.isPackaged ? [] : [options.bootstrapScript];
  args.push(RENDER_WORKER_FLAG, ...taskArguments(task));
  return { command: options.electronPath, args };
}

function publicTask(task) {
  return {
    id: task.id,
    project: task.project,
    production: task.production,
    audio: task.audio,
    output: task.output,
    aspect: task.aspect,
    codec: task.codec,
    status: task.status,
    progress: task.progress,
    renderedFrames: task.renderedFrames,
    totalFrames: task.totalFrames,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  };
}

function boundedError(value) {
  const text = String(value || '').trim();
  return text ? text.slice(-2000) : null;
}

function createRenderQueue(options = {}) {
  const emitter = new EventEmitter();
  const root = options.root || path.join(__dirname, '..');
  const exportScript = options.exportScript || path.join(root, 'scripts', 'export-video.cjs');
  const bootstrapScript = options.bootstrapScript || path.join(root, 'desktop', 'bootstrap.cjs');
  const electronPath = options.electronPath || process.execPath;
  const isPackaged = options.isPackaged === true;
  const spawnProcess = options.spawn || spawn;
  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || (() => crypto.randomUUID());
  const tasks = [];
  let runningTask = null;
  let shuttingDown = false;

  function emitChange(task) {
    emitter.emit('change', publicTask(task));
  }

  function pruneHistory() {
    while (tasks.length >= 100) {
      const index = tasks.findIndex((task) => TERMINAL_STATUSES.has(task.status));
      if (index < 0) throw new Error('render queue is full');
      tasks.splice(index, 1);
    }
  }

  function finish(task, status, error) {
    if (TERMINAL_STATUSES.has(task.status)) return;
    if (task.cancelTimer) clearTimeout(task.cancelTimer);
    task.cancelTimer = null;
    task.status = status;
    task.error = boundedError(error);
    task.finishedAt = now();
    if (status === 'completed') task.progress = 1;
    task.child = null;
    if (runningTask === task) runningTask = null;
    emitChange(task);
    queueMicrotask(startNext);
  }

  function consumeOutput(task, chunk, isError) {
    const text = chunk.toString();
    if (isError) {
      task.stderr = `${task.stderr}${text}`.slice(-8000);
      return;
    }
    const combined = `${task.stdoutPartial}${text}`;
    const lines = combined.split(/\r?\n/);
    task.stdoutPartial = lines.pop() || '';
    for (const line of lines) {
      const match = line.match(/Rendered\s+(\d+)\/(\d+)\s+frames/i);
      if (!match) continue;
      const renderedFrames = Number(match[1]);
      const totalFrames = Number(match[2]);
      if (!Number.isSafeInteger(renderedFrames) || !Number.isSafeInteger(totalFrames) || totalFrames <= 0) continue;
      task.renderedFrames = Math.min(renderedFrames, totalFrames);
      task.totalFrames = totalFrames;
      task.progress = Math.max(0, Math.min(1, task.renderedFrames / totalFrames));
      emitChange(task);
    }
  }

  function startNext() {
    if (shuttingDown || runningTask) return;
    const task = tasks.find((candidate) => candidate.status === 'queued');
    if (!task) return;
    try {
      if (!fs.statSync(exportScript).isFile()) throw new Error('not a file');
      if (!isPackaged && !fs.statSync(bootstrapScript).isFile()) throw new Error('not a file');
    } catch (_error) {
      finish(task, 'failed', 'video exporter is unavailable');
      return;
    }
    try {
      validateTaskInput({
        project: task.project,
        production: task.production,
        audio: task.audio,
        output: task.output,
        aspect: task.aspect,
        codec: task.codec
      }, { allowExistingOutput: task.allowExistingOutput });
    } catch (error) {
      const detail = error && error.message ? `: ${error.message}` : '';
      finish(task, 'failed', `render task is no longer valid${detail}`);
      return;
    }

    task.status = 'running';
    task.startedAt = now();
    runningTask = task;
    emitChange(task);

    let child;
    try {
      const launch = renderWorkerLaunch({ electronPath, bootstrapScript, isPackaged }, task);
      child = spawnProcess(launch.command, launch.args, {
        // app.asar is not a real working directory in packaged applications.
        // All validated task paths are absolute, so use the writable output
        // directory as the worker's stable cwd in both modes.
        cwd: path.dirname(task.output),
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish(task, 'failed', error.message || error);
      return;
    }
    task.child = child;
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => consumeOutput(task, chunk, false));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => consumeOutput(task, chunk, true));
    }
    child.once('error', (error) => finish(task, task.cancelRequested ? 'cancelled' : 'failed', error.message || error));
    child.once('close', (code, signal) => {
      if (TERMINAL_STATUSES.has(task.status)) return;
      if (task.cancelRequested) {
        finish(task, 'cancelled', null);
      } else if (code === 0) {
        try {
          regularFile(task.output, 'rendered output', Number.MAX_SAFE_INTEGER);
          finish(task, 'completed', null);
        } catch (error) {
          finish(task, 'failed', error.message || error);
        }
      } else {
        finish(task, 'failed', task.stderr || `video exporter exited with code ${code}${signal ? ` (${signal})` : ''}`);
      }
    });
  }

  function enqueue(input, internalOptions = {}) {
    if (shuttingDown) throw new Error('render queue is shutting down');
    const allowExistingOutput = internalOptions.allowExistingOutput === true;
    const normalized = validateTaskInput(input, { allowExistingOutput });
    if (tasks.some((task) => !TERMINAL_STATUSES.has(task.status) && task.output === normalized.output)) {
      throw new Error('output is already in the render queue');
    }
    pruneHistory();
    const task = {
      id: makeId(),
      ...normalized,
      allowExistingOutput,
      status: 'queued',
      progress: 0,
      renderedFrames: 0,
      totalFrames: null,
      error: null,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      cancelRequested: false,
      child: null,
      stdoutPartial: '',
      stderr: ''
    };
    tasks.push(task);
    emitChange(task);
    queueMicrotask(startNext);
    return publicTask(task);
  }

  function list() {
    return tasks.map(publicTask);
  }

  function cancel(id) {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('render task id is invalid');
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('render task was not found');
    if (TERMINAL_STATUSES.has(task.status)) return publicTask(task);
    task.cancelRequested = true;
    if (task.status === 'queued') {
      finish(task, 'cancelled', null);
    } else if (task.status === 'running' && task.child) {
      task.child.kill('SIGTERM');
      task.cancelTimer = setTimeout(() => {
        if (task.status === 'running' && task.child) task.child.kill('SIGKILL');
      }, 3000);
      if (typeof task.cancelTimer.unref === 'function') task.cancelTimer.unref();
    }
    return publicTask(task);
  }

  function retry(id) {
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('render task id is invalid');
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('render task was not found');
    if (task.status !== 'failed') throw new Error('only a failed render task can be retried');
    return enqueue({
      project: task.project,
      production: task.production,
      audio: task.audio,
      output: task.output,
      aspect: task.aspect,
      codec: task.codec
    }, { allowExistingOutput: true });
  }

  function shutdown() {
    shuttingDown = true;
    for (const task of tasks) {
      if (task.status === 'queued') {
        task.cancelRequested = true;
        finish(task, 'cancelled', null);
      }
    }
    if (runningTask && runningTask.child) {
      runningTask.cancelRequested = true;
      runningTask.child.kill('SIGTERM');
      runningTask.cancelTimer = setTimeout(() => {
        if (runningTask && runningTask.child) runningTask.child.kill('SIGKILL');
      }, 3000);
      if (typeof runningTask.cancelTimer.unref === 'function') runningTask.cancelTimer.unref();
    }
  }

  return {
    enqueue,
    list,
    cancel,
    retry,
    shutdown,
    onChange(handler) {
      emitter.on('change', handler);
      return () => emitter.off('change', handler);
    }
  };
}

module.exports = {
  RENDER_WORKER_FLAG,
  createRenderQueue,
  extractRenderWorkerArguments,
  renderWorkerLaunch,
  taskArguments,
  validateTaskInput
};
