const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RENDER_WORKER_FLAG } = require('../desktop/render-queue.cjs');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');

const ROOT = path.join(__dirname, '..');

function findPackagedApp(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.SIGNAL_FIELD_PACKAGED_APP,
    path.join(ROOT, 'dist', 'mac-arm64', 'Signal Field.app'),
    path.join(ROOT, 'dist', 'mac', 'Signal Field.app')
  ].filter(Boolean).map((candidate) => path.resolve(candidate));

  const appPath = candidates.find((candidate) => {
    try { return fs.statSync(candidate).isDirectory() && candidate.endsWith('.app'); } catch (_error) { return false; }
  });
  if (appPath) return appPath;
  throw new Error(
    'Packaged Signal Field.app was not found. Run npm run package:mac, then pass its .app path: ' +
    'npm run verify:packaged-render-worker -- "/path/to/Signal Field.app"'
  );
}

function writeToneWav(file) {
  const sampleRate = 8000;
  const samples = sampleRate;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin(index / sampleRate * Math.PI * 2 * 220) * 0.12;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  fs.writeFileSync(file, buffer);
}

function verifyEncodedOutput(executable) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-field-packaged-worker-'));
  try {
    const snapshot = SceneStudio.createSnapshot({ style: 'cosmic', solidShape: 'sphere', parameters: { particles: 0.03, light: 8 } });
    const project = SceneStudio.createProject({
      title: 'Packaged worker smoke',
      scenes: [{ id: 'scene-a', name: 'Scene', snapshot }],
      timeline: { durationMs: 1000, keyframes: [{ id: 'keyframe-a', timeMs: 0, snapshot }] }
    });
    const production = ProductionSpec.create({
      project,
      aspect: '1:1',
      titleCard: { template: 'minimal', mainTitle: 'Signal Field', subtitle: 'Packaged worker', durationMs: 500 },
      lyrics: [{ startMs: 100, endMs: 450, text: 'Packaged encode verified' }],
      output: { codec: 'h264', fileName: 'packaged-smoke.mp4' }
    });
    const productionFile = path.join(directory, 'production.json');
    const audioFile = path.join(directory, 'tone.wav');
    const outputFile = path.join(directory, 'packaged-smoke.mp4');
    fs.writeFileSync(productionFile, ProductionSpec.export(production));
    writeToneWav(audioFile);
    const result = spawnSync(executable, [
      RENDER_WORKER_FLAG,
      '--production', productionFile,
      '--audio', audioFile,
      '--output', outputFile,
      '--fps', '2',
      '--seconds', '0.5'
    ], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
      maxBuffer: 8 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Packaged encode exited with status ${result.status}, signal ${result.signal || 'none'}:\n${result.stdout || ''}\n${result.stderr || ''}`);
    }
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size <= 1000) throw new Error('Packaged worker did not create a non-empty MP4.');
    const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', outputFile
    ], { encoding: 'utf8', timeout: 10000 });
    if (probe.error || probe.status !== 0) throw new Error(`ffprobe could not verify packaged output: ${probe.stderr || probe.error}`);
    const stream = JSON.parse(probe.stdout).streams[0];
    if (!stream || stream.width !== 1080 || stream.height !== 1080 || stream.codec_name !== 'h264') {
      throw new Error(`Packaged output stream is invalid: ${JSON.stringify(stream)}`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function verifyPackagedWorker(appPath, options = {}) {
  if (process.platform !== 'darwin') throw new Error('packaged .app worker verification requires macOS');
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Signal Field');
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error(`Packaged executable is unavailable: ${executable}`);
  }
  const result = spawnSync(executable, [RENDER_WORKER_FLAG, '--help'], {
    cwd: path.dirname(appPath),
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`Packaged render worker exited with status ${result.status}, signal ${result.signal || 'none'}:\n${output.trim()}`);
  }
  if (!/Usage:\s*\n\s*npm run export:video/.test(output)) {
    throw new Error(`Packaged app did not dispatch to the render worker:\n${output.trim()}`);
  }
  if (options.encode) verifyEncodedOutput(executable);
  console.log(`PASS packaged render worker bootstrap${options.encode ? ' and real H.264 encode' : ''}: ${appPath}`);
}

if (require.main === module) verifyPackagedWorker(findPackagedApp(process.argv[2]), { encode: process.argv.includes('--encode') });

module.exports = { findPackagedApp, verifyEncodedOutput, verifyPackagedWorker };
