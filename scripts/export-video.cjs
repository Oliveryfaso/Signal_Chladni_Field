const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');

const ROOT = path.join(__dirname, '..');
const VISUALIZER_FILE = path.join(ROOT, 'app', 'index.html');
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_FFT_SIZE = 2048;
const AUDIO_BANDS = 16;
const PROJECT_REST_FRAME = Object.freeze({
  bands: Object.freeze([0.18, 0.26, 0.38, 0.52, 0.62, 0.58, 0.48, 0.4, 0.34, 0.3, 0.26, 0.22, 0.18, 0.15, 0.12, 0.1]),
  energy: 0.5,
  sharpness: 0.45,
  flat: 0.35
});
const STYLES = new Set(['sand', 'msand', 'cosmic', 'dcosmic']);
const ROTATION_MODES = new Set(['single', 'tumble', 'precess']);
const CODECS = new Set(['prores', 'h264']);
const ASPECTS = Object.freeze({
  '16:9': Object.freeze({ width: 1920, height: 1080 }),
  '9:16': Object.freeze({ width: 1080, height: 1920 }),
  '1:1': Object.freeze({ width: 1080, height: 1080 })
});
const FLAG_ARGS = new Set(['alpha', 'no-rotation', 'help']);
const VALUE_ARGS = new Set([
  'aspect', 'audio', 'codec', 'fps', 'height', 'light', 'output', 'particles', 'pattern', 'project',
  'production', 'rotation', 'rotation-speed', 'seconds', 'seed', 'style', 'width'
]);

const HELP = `Usage:
  npm run export:video -- --output <file.mov|file.mp4> [options]
  npm run export:video -- --production <spec.json> [options]

Options:
  --output <path>         Output file. Required unless --production supplies a safe file name.
  --codec <prores|h264>   Override codec inferred from the output extension.
  --aspect <ratio>        16:9, 9:16, or 1:1; cannot be combined with width/height.
  --style <name>          sand, msand, cosmic, or dcosmic (default: cosmic).
  --width <pixels>        Native output width (default: 3840).
  --height <pixels>       Native output height (default: 2160).
  --fps <number>          Output frame rate (default: 60).
  --seconds <number>      Duration in seconds (default: 10, or the project duration).
  --seed <integer>        Deterministic particle seed (default: 20260710).
  --pattern <json>        Captured pattern JSON; otherwise uses the Web showcase default.
  --project <json>        Valid Signal Field Scene Studio project; drives the export timeline.
  --production <json>     Production spec with project, aspect, titles, lyrics, edits, and output defaults.
  --audio <file>          Drive every frame from this audio and include it in the output.
  --particles <0..1>      Particle-count scale (default: 0.15).
  --light <0..9>          3D lighting model; 0 is depth, 9 is sweep (default: 9).
  --rotation <mode>       single, tumble, or precess (default: precess).
  --rotation-speed <n>    Rotation speed (default: 1).
  --no-rotation           Export a static camera.
  --alpha                 Transparent ProRes 4444 output; only valid with prores.
  --help                  Show this message.

The renderer always uses dpr=1: one canvas pixel becomes one output pixel. It does
not supersample and downscale, which would soften the app's one-pixel particles.
`;

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (FLAG_ARGS.has(key)) {
      parsed[key] = true;
      continue;
    }
    if (!VALUE_ARGS.has(key)) throw new Error(`Unknown option: --${key}`);
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function finiteNumber(value, fallback, label, min, max) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return number;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function aspectDimensions(aspect) {
  if (aspect == null) return null;
  if (!hasOwn(ASPECTS, aspect)) throw new Error(`Unknown aspect: ${aspect}`);
  return { ...ASPECTS[aspect] };
}

function loadSceneProject(file) {
  const projectFile = path.resolve(file);
  if (!fs.existsSync(projectFile) || !fs.statSync(projectFile).isFile()) {
    throw new Error(`Scene project is unavailable: ${projectFile}`);
  }
  const size = fs.statSync(projectFile).size;
  if (size > 5 * 1024 * 1024) throw new Error('Scene project must not exceed 5 MB');
  const project = SceneStudio.importProject(fs.readFileSync(projectFile, 'utf8'));
  if (project.timeline.durationMs <= 0 || !project.timeline.keyframes.length) {
    throw new Error('Scene project requires a non-empty timeline with a positive duration');
  }
  return { file: projectFile, project };
}

function loadProductionSpec(file) {
  const productionFile = path.resolve(file);
  if (!fs.existsSync(productionFile) || !fs.statSync(productionFile).isFile()) {
    throw new Error(`Production specification is unavailable: ${productionFile}`);
  }
  const size = fs.statSync(productionFile).size;
  if (size > ProductionSpec.MAX_PROJECT_BYTES + 1024 * 1024) {
    throw new Error('Production specification must not exceed 6 MB');
  }
  const production = ProductionSpec.import(fs.readFileSync(productionFile, 'utf8'));
  if (production.project.timeline.durationMs <= 0 || !production.project.timeline.keyframes.length) {
    throw new Error('Production specification requires a non-empty project timeline with a positive duration');
  }
  return { file: productionFile, production };
}

function timelineSnapshotAt(project, timeMs) {
  return SceneStudio.seekTimeline(project, timeMs);
}

function productionSnapshotAt(production, timeMs, previousTimeMs) {
  const project = production.project;
  const base = timelineSnapshotAt(project, timeMs);
  let cut = null;
  for (let index = production.beatEdits.length - 1; index >= 0; index -= 1) {
    const edit = production.beatEdits[index];
    if (edit.timeMs <= timeMs && edit.action === 'cut') {
      cut = edit;
      break;
    }
  }
  if (!cut || !cut.targetSceneId) return base;
  const crossed = Number.isFinite(previousTimeMs) && cut.timeMs > previousTimeMs && cut.timeMs <= timeMs;
  const nextKeyframe = project.timeline.keyframes.find((keyframe) => keyframe.timeMs > cut.timeMs);
  if (!crossed && nextKeyframe && timeMs >= nextKeyframe.timeMs) return base;
  const scene = project.scenes.find((item) => item.id === cut.targetSceneId);
  if (!scene) throw new Error(`Production cut references an unavailable scene: ${cut.targetSceneId}`);
  return {
    ...base,
    fromId: scene.id,
    toId: scene.id,
    progress: 0,
    snapshot: JSON.parse(JSON.stringify(scene.snapshot)),
    beatCut: { timeMs: cut.timeMs, targetSceneId: scene.id }
  };
}

function productionFrameEffects(production, previousTimeMs, timeMs) {
  const previous = Number.isFinite(previousTimeMs) ? previousTimeMs : -1;
  let accentPulse = 0;
  let holdPulse = 0;
  const crossed = [];
  production.beatEdits.forEach((edit) => {
    if (edit.timeMs > previous && edit.timeMs <= timeMs) {
      crossed.push({ timeMs: edit.timeMs, action: edit.action });
      if (edit.action === 'accent') accentPulse = Math.max(accentPulse, edit.intensity);
      if (edit.action === 'hold') holdPulse = Math.max(holdPulse, edit.intensity);
    }
  });
  return { accentPulse, holdPulse, crossed };
}

function loadOptions(argv) {
  const args = parseArgs(argv);
  if (args.help) return { help: true };
  if (args.project && args.production) throw new Error('--production cannot be combined with --project');
  if (!args.output && !args.production) throw new Error('--output is required unless --production is supplied');

  let production = null;
  let productionFile = null;
  if (args.production) {
    const loaded = loadProductionSpec(args.production);
    production = loaded.production;
    productionFile = loaded.file;
  }
  const projectSource = Boolean(args.project || production);
  if (projectSource) {
    const conflicting = ['style', 'pattern', 'particles', 'light', 'rotation', 'rotation-speed', 'no-rotation']
      .filter((key) => hasOwn(args, key));
    if (conflicting.length) throw new Error(`${production ? '--production' : '--project'} cannot be combined with --${conflicting[0]}`);
  }

  let project = production ? production.project : null;
  let projectFile = null;
  let projectDurationSeconds = null;
  let initialSnapshot = null;
  if (args.project) {
    const loaded = loadSceneProject(args.project);
    project = loaded.project;
    projectFile = loaded.file;
    projectDurationSeconds = project.timeline.durationMs / 1000;
    initialSnapshot = timelineSnapshotAt(project, 0).snapshot;
    if (!initialSnapshot) throw new Error('Scene project has no snapshot at the start of its timeline');
  } else if (production) {
    projectDurationSeconds = project.timeline.durationMs / 1000;
    initialSnapshot = productionSnapshotAt(production, 0).snapshot;
    if (!initialSnapshot) throw new Error('Production project has no snapshot at the start of its timeline');
  }

  const aspect = args.aspect || (production ? production.aspect : null);
  const dimensions = aspectDimensions(aspect);
  if (dimensions && (hasOwn(args, 'width') || hasOwn(args, 'height'))) {
    throw new Error('--aspect or the production aspect cannot be combined with --width or --height');
  }
  if (production && aspect !== production.aspect) {
    production = ProductionSpec.create({ ...production, aspect });
  }
  const output = args.output
    ? path.resolve(args.output)
    : path.join(path.dirname(productionFile), production.output.fileName);
  const extension = path.extname(output).toLowerCase();
  const codec = args.codec || (production ? production.output.codec : (extension === '.mp4' ? 'h264' : 'prores'));
  const style = initialSnapshot ? initialSnapshot.style : (args.style || 'cosmic');
  const rotationMode = initialSnapshot ? initialSnapshot.rotationMode : (args.rotation || 'precess');
  const width = Math.round(finiteNumber(args.width, dimensions ? dimensions.width : 3840, 'width', 64, 8192));
  const height = Math.round(finiteNumber(args.height, dimensions ? dimensions.height : 2160, 'height', 64, 8192));
  const fps = finiteNumber(args.fps, 60, 'fps', 1, 240);
  const secondsExplicit = hasOwn(args, 'seconds');
  const seconds = finiteNumber(args.seconds, projectDurationSeconds == null ? 10 : projectDurationSeconds, 'seconds', 0.01, 3600);
  const seed = Math.round(finiteNumber(args.seed, 20260710, 'seed', 1, 4294967295));
  const particles = finiteNumber(args.particles, initialSnapshot ? initialSnapshot.parameters.particles : 0.15, 'particles', 0.01, 1);
  const light = Math.round(finiteNumber(args.light, initialSnapshot ? initialSnapshot.parameters.light : 9, 'light', 0, 9));
  const rotationSpeed = finiteNumber(args['rotation-speed'], initialSnapshot ? initialSnapshot.parameters.rotationSpeed : 1, 'rotation-speed', 0, 10);
  const alpha = Boolean(args.alpha);
  const audio = args.audio ? path.resolve(args.audio) : null;

  if (!STYLES.has(style)) throw new Error(`Unknown style: ${style}`);
  if (!ROTATION_MODES.has(rotationMode)) throw new Error(`Unknown rotation mode: ${rotationMode}`);
  if (!CODECS.has(codec)) throw new Error(`Unknown codec: ${codec}`);
  if ((width % 2) !== 0 || (height % 2) !== 0) throw new Error('width and height must be even');
  if (alpha && codec !== 'prores') throw new Error('--alpha requires --codec prores');
  if (codec === 'h264' && extension !== '.mp4') throw new Error('H.264 output must use a .mp4 extension');
  if (codec === 'prores' && extension !== '.mov') throw new Error('ProRes output must use a .mov extension');
  if (audio && (!fs.existsSync(audio) || !fs.statSync(audio).isFile())) throw new Error(`Audio file is unavailable: ${audio}`);
  if (projectDurationSeconds != null && seconds > projectDurationSeconds + 1e-9) {
    throw new Error(`seconds must not exceed the scene project duration (${projectDurationSeconds})`);
  }

  let pattern = initialSnapshot ? initialSnapshot.pattern : null;
  if (args.pattern) {
    const patternFile = path.resolve(args.pattern);
    pattern = JSON.parse(fs.readFileSync(patternFile, 'utf8'));
  }

  return {
    alpha,
    aspect,
    audio,
    codec,
    fps,
    frameCount: Math.max(1, Math.round(fps * seconds)),
    height,
    light,
    output,
    particles,
    pattern,
    project,
    projectFile,
    projectDurationSeconds,
    production,
    productionFile,
    initialSnapshot,
    rotation: initialSnapshot ? initialSnapshot.toggles.rotation : !args['no-rotation'],
    rotationMode,
    rotationSpeed,
    seed,
    seconds,
    secondsExplicit,
    style,
    width
  };
}

function ffmpegArgs(options) {
  const input = [
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'image2pipe',
    '-framerate', String(options.fps),
    '-vcodec', 'png',
    '-i', 'pipe:0'
  ];
  if (options.audio) {
    input.push('-stream_loop', '-1', '-i', options.audio, '-map', '0:v:0', '-map', '1:a:0');
  } else {
    input.push('-an');
  }

  if (options.codec === 'h264') {
    return input.concat([
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-tune', 'grain',
      '-crf', '10',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-movflags', '+faststart',
      ...(options.audio ? ['-c:a', 'aac', '-b:a', '320k', '-t', String(options.seconds), '-shortest'] : []),
      options.output
    ]);
  }

  return input.concat([
    '-c:v', 'prores_ks',
    '-profile:v', '4',
    '-pix_fmt', options.alpha ? 'yuva444p10le' : 'yuv444p10le',
    '-vendor', 'apl0',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    ...(options.audio ? ['-c:a', 'pcm_s24le', '-ar', String(AUDIO_SAMPLE_RATE), '-t', String(options.seconds), '-shortest'] : []),
    options.output
  ]);
}

function assertFfmpeg() {
  const binary = process.env.FFMPEG_PATH || 'ffmpeg';
  const probe = spawnSync(binary, ['-version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) throw new Error(`ffmpeg is unavailable: ${binary}`);
  return binary;
}

function probeAudioDuration(ffmpegBinary, audioFile) {
  const inferred = path.isAbsolute(ffmpegBinary)
    ? path.join(path.dirname(ffmpegBinary), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    : 'ffprobe';
  const binary = process.env.FFPROBE_PATH || inferred;
  const result = spawnSync(binary, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioFile
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const duration = Number(result.stdout && result.stdout.trim());
  if (result.error || result.status !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Audio duration is unavailable: ${audioFile}`);
  }
  return duration;
}

function decodeAudioSamples(ffmpegBinary, options) {
  const decodeSeconds = options.seconds + (AUDIO_FFT_SIZE / AUDIO_SAMPLE_RATE);
  const maxBuffer = Math.ceil(decodeSeconds * AUDIO_SAMPLE_RATE * 4 + 4 * 1024 * 1024);
  const result = spawnSync(ffmpegBinary, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-stream_loop', '-1', '-i', options.audio,
    '-t', String(decodeSeconds), '-vn', '-ac', '1', '-ar', String(AUDIO_SAMPLE_RATE),
    '-f', 'f32le', 'pipe:1'
  ], { encoding: null, maxBuffer });
  if (result.error || result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString().trim() : '';
    throw new Error(`Audio decode failed${detail ? `: ${detail}` : ''}`);
  }
  const count = Math.floor(result.stdout.length / 4);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) samples[index] = result.stdout.readFloatLE(index * 4);
  return samples;
}

function bitReverseTable(size) {
  const bits = Math.round(Math.log2(size));
  const table = new Uint16Array(size);
  for (let index = 0; index < size; index += 1) {
    let source = index;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | (source & 1);
      source >>>= 1;
    }
    table[index] = reversed;
  }
  return table;
}

// Reproduce the Web AnalyserNode path offline: Blackman FFT, -100..-30 dB byte mapping,
// 0.35 spectral smoothing, then the same 16 linear bands consumed by the renderer.
function analyzeAudioFrames(ffmpegBinary, options) {
  const samples = decodeAudioSamples(ffmpegBinary, options);
  const size = AUDIO_FFT_SIZE;
  const bins = size / 2;
  const reverse = bitReverseTable(size);
  const window = new Float64Array(size);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const smoothed = new Float64Array(bins);
  let windowSum = 0;
  for (let index = 0; index < size; index += 1) {
    const phase = (2 * Math.PI * index) / (size - 1);
    const value = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2);
    window[index] = value;
    windowSum += value;
  }

  const frames = [];
  let minEnergy = Infinity;
  let maxEnergy = -Infinity;
  let sumEnergy = 0;
  for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
    const sampleStart = Math.round((frameIndex * AUDIO_SAMPLE_RATE) / options.fps);
    imaginary.fill(0);
    for (let index = 0; index < size; index += 1) {
      real[reverse[index]] = (samples[sampleStart + index] || 0) * window[index];
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >>> 1;
      const angle = (-2 * Math.PI) / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let start = 0; start < size; start += length) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < half; offset += 1) {
          const even = start + offset;
          const odd = even + half;
          const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          const evenReal = real[even];
          const evenImaginary = imaginary[even];
          real[even] = evenReal + oddReal;
          imaginary[even] = evenImaginary + oddImaginary;
          real[odd] = evenReal - oddReal;
          imaginary[odd] = evenImaginary - oddImaginary;
          const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
          twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
          twiddleReal = nextReal;
        }
      }
    }

    const bands = new Float64Array(AUDIO_BANDS);
    let energySum = 0;
    let centroid = 0;
    let total = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]) * 2 / windowSum;
      const decibels = 20 * Math.log10(Math.max(1e-8, magnitude));
      const current = Math.max(0, Math.min(1, (decibels + 100) / 70));
      const value = frameIndex === 0 ? current : smoothed[bin] * 0.35 + current * 0.65;
      smoothed[bin] = value;
      bands[Math.min(AUDIO_BANDS - 1, Math.floor(bin * AUDIO_BANDS / bins))] += value;
      energySum += value * value;
      centroid += bin * value;
      total += value;
    }
    let maximumBand = 1e-6;
    for (const value of bands) maximumBand = Math.max(maximumBand, value);
    for (let band = 0; band < bands.length; band += 1) bands[band] /= maximumBand;
    let geometric = 0;
    let arithmetic = 0;
    for (const value of bands) {
      geometric += Math.log(value + 1e-4);
      arithmetic += value;
    }
    const energy = Math.min(2, Math.sqrt(energySum / bins) * 4.5);
    const sharpness = total > 1e-6 ? Math.min(1, (centroid / total) / bins * 1.6) : 0.3;
    const flat = Math.exp(geometric / AUDIO_BANDS) / (arithmetic / AUDIO_BANDS);
    const round = (value) => Number(value.toFixed(6));
    frames.push({
      bands: Array.from(bands, round),
      energy: round(energy),
      sharpness: round(sharpness),
      flat: round(flat)
    });
    minEnergy = Math.min(minEnergy, energy);
    maxEnergy = Math.max(maxEnergy, energy);
    sumEnergy += energy;
  }
  console.log(
    `Analyzed ${frames.length} audio frames: energy ${minEnergy.toFixed(3)}..${maxEnergy.toFixed(3)}, mean ${(sumEnergy / frames.length).toFixed(3)}`
  );
  return frames;
}

async function waitForPattern(win, target) {
  const expected = JSON.stringify(target);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const expected = ${expected};
    let frames = 0;
    const close = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
    const matches = (actual) => actual && actual.style === expected.style &&
      close(actual.goal, expected.goal) && close(actual.detail, expected.detail) &&
      Array.isArray(actual.ex) && actual.ex.length === expected.ex.length &&
      actual.ex.every((value, index) => close(value, expected.ex[index]));
    const next = () => {
      const actual = JSON.parse(window.soundMotionNative.exportPatternJSON());
      if (matches(actual)) { resolve(true); return; }
      if (++frames >= 180) { reject(new Error('Timed out waiting for the requested pattern')); return; }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  })`);
}

async function configureRenderer(win, options) {
  const config = JSON.stringify({
    alpha: options.alpha,
    initialSnapshot: options.initialSnapshot,
    light: options.light,
    particles: options.particles,
    pattern: options.pattern,
    rotation: options.rotation,
    rotationMode: options.rotationMode,
    rotationSpeed: options.rotationSpeed,
    style: options.style
  });

  const targetPattern = await win.webContents.executeJavaScript(`(() => {
    const config = ${config};
    const snapshot = config.initialSnapshot;
    window.soundMotionNative.setStyle(snapshot ? snapshot.style : config.style);
    if (snapshot) {
      window.soundMotionNative.setSampleMode(snapshot.sampleMode);
      window.soundMotionNative.setRotationMode(snapshot.rotationMode);
      window.soundMotionNative.setSolidShape(snapshot.solidShape, snapshot.parameters.faces, false);
      Object.keys(snapshot.parameters).forEach((name) => window.soundMotionNative.setParam(name, snapshot.parameters[name]));
      window.soundMotionNative.setBoolean('symmetry', snapshot.toggles.symmetry);
      window.soundMotionNative.setBoolean('frame', snapshot.toggles.frame);
    } else {
      window.soundMotionNative.setParam('particles', config.particles);
      window.soundMotionNative.setParam('light', config.light);
      window.soundMotionNative.setRotationMode(config.rotationMode);
      window.soundMotionNative.setParam('rotationSpeed', config.rotationSpeed);
    }
    window.soundMotionNative.setTransparent(config.alpha);
    window.soundMotionTest.renderStill();
    const pattern = config.pattern || window.soundMotionTest.webDefaultPattern(config.style);
    window.soundMotionNative.applyPatternSpec(pattern);
    return pattern;
  })()`);

  await waitForPattern(win, targetPattern);

  const initialSnapshot = JSON.stringify(options.initialSnapshot);
  return win.webContents.executeJavaScript(`(() => {
    const exportAlpha = ${options.alpha};
    window.soundMotionNative.setBoolean('rotation', ${options.rotation});
    if (${Boolean(options.project)}) {
      window.__signalFieldExportLastSnapshot = ${initialSnapshot};
      window.__signalFieldApplyExportSnapshot = (snapshot) => {
        const Studio = window.SignalFieldSceneStudio;
        if (!Studio || !snapshot) throw new Error('Scene Studio export bridge is unavailable');
        const recipe = Studio.createSoundMotionRecipe(snapshot);
        const validation = Studio.validateSoundMotionRecipe(recipe);
        if (!validation.valid) throw new Error(validation.errors.join(' '));
        const previous = window.__signalFieldExportLastSnapshot;
        const changed = (path) => {
          const read = (value) => path.reduce((current, key) => current == null ? current : current[key], value);
          return JSON.stringify(read(previous)) !== JSON.stringify(read(snapshot));
        };
        recipe.commands.forEach((command) => {
          let apply = !previous;
          if (command.method === 'setStyle') apply = apply || changed(['style']);
          else if (command.method === 'setSampleMode') apply = apply || changed(['sampleMode']);
          else if (command.method === 'setRotationMode') apply = apply || changed(['rotationMode']);
          else if (command.method === 'setSolidShape') apply = apply || changed(['solidShape']) || changed(['parameters', 'faces']);
          else if (command.method === 'setParam') apply = apply || changed(['parameters', command.args[0]]);
          else if (command.method === 'setBoolean') apply = apply || changed(['toggles', command.args[0]]);
          else if (command.method === 'applyPatternSpec') apply = apply || changed(['pattern']);
          else if (command.method === 'setTransparent') apply = false;
          if (apply) window.soundMotionNative[command.method](...command.args);
        });
        window.soundMotionNative.setTransparent(exportAlpha);
        window.__signalFieldExportLastSnapshot = snapshot;
        return true;
      };
      window.soundMotionTest.forcePlayingForTest();
    }
    return {...window.soundMotionTest.state(), pattern:JSON.parse(window.soundMotionNative.exportPatternJSON())};
  })()`);
}

async function applyProjectTimeline(win, project, timeMs, production, previousTimeMs) {
  const result = production ? productionSnapshotAt(production, timeMs, previousTimeMs) : timelineSnapshotAt(project, timeMs);
  if (!result.snapshot) throw new Error(`Scene project has no snapshot at ${result.timeMs} ms`);
  const snapshot = JSON.stringify(result.snapshot);
  await win.webContents.executeJavaScript(`window.__signalFieldApplyExportSnapshot(${snapshot});`);
  return result;
}

async function loadProductionModules(win, production) {
  if (!production) return;
  const serialized = JSON.stringify(production);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const load = (file, globalName) => new Promise((done, fail) => {
      if (window[globalName]) { done(); return; }
      const script = document.createElement('script');
      script.src = new URL(file, document.baseURI).href;
      script.onload = () => window[globalName] ? done() : fail(new Error(globalName + ' was not exposed'));
      script.onerror = () => fail(new Error('Failed to load ' + file));
      document.head.appendChild(script);
    });
    load('./production-spec.js', 'SignalFieldProductionSpec')
      .then(() => load('./production-overlay.js', 'SignalFieldProductionOverlay'))
      .then(() => {
        window.__signalFieldProduction = window.SignalFieldProductionSpec.import(${serialized});
        resolve(true);
      }, reject);
  })`);
}

async function createRenderWindow(options) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    transparent: options.alpha,
    backgroundColor: options.alpha ? '#00000000' : '#050608',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: false
    }
  });

  const query = {
    dpr: '1',
    overlay: '1',
    parity: '1',
    seed: String(options.seed),
    style: options.style
  };
  if (options.alpha) query.alpha = '1';

  win.webContents.setZoomFactor(1);
  await win.loadFile(VISUALIZER_FILE, { query });
  await loadProductionModules(win, options.production);
  return win;
}

async function captureCanvasPng(win, timeMs, productionEffects) {
  const withProduction = Boolean(productionEffects);
  if (withProduction) {
    const effects = JSON.stringify(productionEffects);
    const base64 = await win.webContents.executeJavaScript(`(() => {
      const source = document.getElementById('hero-3d');
      if (!source) throw new Error('Render canvas is unavailable');
      let composite = window.__signalFieldCompositeCanvas;
      let overlay = window.__signalFieldOverlayCanvas;
      if (!composite) composite = window.__signalFieldCompositeCanvas = document.createElement('canvas');
      if (!overlay) overlay = window.__signalFieldOverlayCanvas = document.createElement('canvas');
      if (composite.width !== source.width || composite.height !== source.height) {
        composite.width = source.width; composite.height = source.height;
        overlay.width = source.width; overlay.height = source.height;
      }
      const context = composite.getContext('2d');
      context.clearRect(0, 0, composite.width, composite.height);
      context.drawImage(source, 0, 0);
      window.SignalFieldProductionOverlay.drawOverlay(overlay, window.__signalFieldProduction, ${Number(timeMs)}, {
        width: source.width, height: source.height, dpr: 1, reducedMotion: false,
        accentPulse: ${effects}.accentPulse, holdPulse: ${effects}.holdPulse
      });
      context.drawImage(overlay, 0, 0);
      return composite.toDataURL('image/png').slice('data:image/png;base64,'.length);
    })()`);
    return Buffer.from(base64, 'base64');
  }
  const base64 = await win.webContents.executeJavaScript(
    `document.getElementById('hero-3d').toDataURL('image/png').slice('data:image/png;base64,'.length)`
  );
  return Buffer.from(base64, 'base64');
}

async function writeFrame(ffmpeg, png) {
  if (ffmpeg.stdin.write(png)) return;
  await once(ffmpeg.stdin, 'drain');
}

async function render(options) {
  const ffmpegBinary = assertFfmpeg();
  if (options.audio && options.secondsExplicit) {
    const audioDuration = probeAudioDuration(ffmpegBinary, options.audio);
    if (options.seconds > audioDuration + (1 / options.fps)) {
      throw new Error(`seconds must not exceed the audio duration (${audioDuration.toFixed(3)})`);
    }
  }
  const audioFrames = options.audio ? analyzeAudioFrames(ffmpegBinary, options) : null;
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  const win = await createRenderWindow(options);
  let ffmpeg = null;

  try {
    const state = await configureRenderer(win, options);
    if (state.canvasWidth !== options.width || state.canvasHeight !== options.height || state.dpr.cube !== 1) {
      throw new Error(
        `Renderer is not pixel-exact: canvas=${state.canvasWidth}x${state.canvasHeight}, dpr=${state.dpr.cube}`
      );
    }
    if (Math.abs(state.particles - options.particles) > 1e-9 || state.light !== options.light) {
      throw new Error(
        `Renderer configuration mismatch: particles=${state.particles}, light=${state.light}`
      );
    }
    if (!state.pattern || Math.abs(state.detail - state.pattern.detail) > 1e-9) {
      throw new Error(`Renderer detail mismatch: style=${state.style}, detail=${state.detail}`);
    }
    if (state.transparent !== options.alpha) {
      throw new Error(`Renderer transparency mismatch: expected=${options.alpha}, actual=${state.transparent}`);
    }
    if (audioFrames || options.project) {
      await win.webContents.executeJavaScript('window.soundMotionTest.beginAudioExportForTest()');
    }

    ffmpeg = spawn(ffmpegBinary, ffmpegArgs(options), { stdio: ['pipe', 'inherit', 'inherit'] });
    ffmpeg.on('error', (error) => console.error(error));
    const ffmpegClosed = once(ffmpeg, 'close');

    const progressEvery = Math.max(1, Math.round(options.frameCount / 20));
    for (let frame = 0; frame < options.frameCount; frame += 1) {
      const timeMs = (frame * 1000) / options.fps;
      const previousTimeMs = frame === 0 ? -1 : ((frame - 1) * 1000) / options.fps;
      if (options.project) {
        await applyProjectTimeline(win, options.project, timeMs, options.production, previousTimeMs);
      }
      const featureFrame = audioFrames
        ? JSON.stringify(audioFrames[frame])
        : (options.project ? JSON.stringify(PROJECT_REST_FRAME) : 'null');
      const idle = !audioFrames && !options.project;
      await win.webContents.executeJavaScript(
        `window.soundMotionTest.exportTickForTest(${1 / options.fps}, ${idle}, ${featureFrame});`
      );
      const effects = options.production ? productionFrameEffects(options.production, previousTimeMs, timeMs) : null;
      const png = await captureCanvasPng(win, timeMs, effects);
      await writeFrame(ffmpeg, png);
      if ((frame + 1) % progressEvery === 0 || frame + 1 === options.frameCount) {
        console.log(`Rendered ${frame + 1}/${options.frameCount} frames`);
      }
    }

    ffmpeg.stdin.end();
    const [code, signal] = await ffmpegClosed;
    ffmpeg = null;
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`);
    console.log(`Wrote ${options.output}`);
  } finally {
    if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGTERM');
    if (!win.isDestroyed()) win.destroy();
  }
}

function runCli() {
  const { app } = require('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.on('window-all-closed', () => {});

  app.whenReady().then(async () => {
    const options = loadOptions(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    console.log(
      `Exporting ${options.width}x${options.height}, ${options.fps} fps, ${options.frameCount} frames, ${options.codec}${options.audio ? ', audio-driven' : ''}${options.production ? ', production-overlay' : (options.project ? ', scene-project' : '')}`
    );
    await render(options);
  }).then(() => {
    app.quit();
  }).catch((error) => {
    console.error(error.message || error);
    console.error('\n' + HELP);
    app.exit(1);
  });
}

module.exports = {
  ASPECTS,
  aspectDimensions,
  loadOptions,
  loadProductionSpec,
  loadSceneProject,
  parseArgs,
  productionFrameEffects,
  productionSnapshotAt,
  render,
  timelineSnapshotAt
};

if (require.main === module) runCli();
