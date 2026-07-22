const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app } = require('electron');
const SceneStudio = require('../app/scene-studio.js');
const ProductionSpec = require('../app/production-spec.js');
const ExportVideo = require('./export-video.cjs');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.on('window-all-closed', () => {});

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
    const pulse = index % 2000 < 120 ? 0.65 * (1 - (index % 2000) / 120) : Math.sin(index / sampleRate * Math.PI * 2 * 220) * 0.08;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pulse)) * 32767), 44 + index * 2);
  }
  fs.writeFileSync(file, buffer);
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-field-export-smoke-'));
  try {
    const first = SceneStudio.createSnapshot({ style: 'cosmic', solidShape: 'sphere', parameters: { particles: 0.05, light: 8 } });
    const last = SceneStudio.createSnapshot({ style: 'dcosmic', parameters: { particles: 0.05, light: 9 } });
    const project = SceneStudio.createProject({
      title: 'Production smoke',
      scenes: [{ id: 'intro-scene', name: 'Intro', snapshot: first }, { id: 'cut-scene', name: 'Cut', snapshot: last }],
      timeline: { durationMs: 1000, keyframes: [{ id: 'start', timeMs: 0, snapshot: first }, { id: 'end', timeMs: 1000, snapshot: last }] }
    });
    const production = ProductionSpec.create({
      project,
      aspect: '1:1',
      titleCard: { template: 'cinematic', mainTitle: 'Signal Field', subtitle: 'Render smoke', durationMs: 900 },
      lyrics: [{ startMs: 200, endMs: 800, text: 'Local render verified' }],
      beatEdits: [{ timeMs: 500, action: 'cut', intensity: 0.8, targetSceneId: 'cut-scene' }],
      output: { codec: 'h264', fileName: 'smoke.mp4' }
    });
    const productionFile = path.join(directory, 'production.json');
    const audioFile = path.join(directory, 'tone.wav');
    const outputFile = path.join(directory, 'smoke.mp4');
    fs.writeFileSync(productionFile, ProductionSpec.export(production));
    writeToneWav(audioFile);

    const options = ExportVideo.loadOptions(['--production', productionFile, '--audio', audioFile, '--output', outputFile, '--fps', '2', '--seconds', '0.75']);
    await ExportVideo.render(options);
    assert.ok(fs.statSync(outputFile).size > 1000, 'encoded MP4 should be non-empty');
    const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', outputFile], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.deepEqual({ width: stream.width, height: stream.height, codec: stream.codec_name }, { width: 1080, height: 1080, codec: 'h264' });
    console.log('PASS real FFmpeg production export with audio, title, lyric, beat cut, and square H.264 output');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

app.whenReady().then(main).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
