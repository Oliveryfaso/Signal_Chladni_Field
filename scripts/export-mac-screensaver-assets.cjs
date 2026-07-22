const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const VISUALIZER = path.join(ROOT, 'app', 'index.html');
const OUTPUT = path.resolve(process.argv[2] || path.join(ROOT, '.cache', 'mac-screensaver-assets'));
const BASE_SEED = 20260710;
const PATTERN_COUNT = Math.max(2, Math.min(256, Number.parseInt(process.env.SCREEN_SAVER_PATTERN_COUNT || '64', 10) || 64));
const SOURCE_STRIDE = 6;
const PACKED_STRIDE_BYTES = 12;
const STYLES = ['msand', 'cosmic'];

app.on('window-all-closed', () => {});

function createWindow() {
  return new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#050608',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
}

function decodeDataURL(value, mediaType) {
  const prefix = `data:${mediaType};base64,`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error(`Expected a ${mediaType} data URL`);
  }
  return Buffer.from(value.slice(prefix.length), 'base64');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function packParticles(payload) {
  const source = Buffer.from(payload.data, 'base64');
  const expectedSourceBytes = payload.count * SOURCE_STRIDE * Float32Array.BYTES_PER_ELEMENT;
  if (source.length !== expectedSourceBytes) {
    throw new Error(`Particle source is ${source.length} bytes; expected ${expectedSourceBytes}`);
  }

  const packed = Buffer.allocUnsafe(payload.count * PACKED_STRIDE_BYTES);
  for (let index = 0; index < payload.count; index += 1) {
    const sourceOffset = index * SOURCE_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const packedOffset = index * PACKED_STRIDE_BYTES;
    for (let axis = 0; axis < 3; axis += 1) {
      const local = source.readFloatLE(sourceOffset + axis * 4);
      packed.writeInt16LE(Math.round(clamp(local * 2, -1, 1) * 32767), packedOffset + axis * 2);
    }
    packed.writeUInt16LE(Math.round(clamp(source.readFloatLE(sourceOffset + 12), 0, 1) * 65535), packedOffset + 6);
    packed.writeUInt16LE(Math.round(clamp(source.readFloatLE(sourceOffset + 16), 0, 1) * 65535), packedOffset + 8);
    packed.writeUInt8(Math.round(clamp(source.readFloatLE(sourceOffset + 20), 0, 47)), packedOffset + 10);
    packed.writeUInt8(0, packedOffset + 11);
  }
  return packed;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error(`macOS required, got ${process.platform}`);
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  await app.whenReady();

  const win = createWindow();
  try {
    const seeds = Array.from({ length: PATTERN_COUNT }, (_, index) => BASE_SEED + index * 104_729);
    const styleMetadata = {};
    let atlas = null;
    let expectedCount = null;

    for (const style of STYLES) {
      const buffers = [];
      const patternMetadata = [];
      const uniqueHashes = new Set();

      await win.loadFile(VISUALIZER, {
        query: {
          overlay: '1',
          parity: '1',
          seed: String(BASE_SEED),
          style
        }
      });

      for (const [index, seed] of seeds.entries()) {
        const payload = await win.webContents.executeJavaScript(
          `window.soundMotionTest.screenSaverSnapshotForBuild(${seed}, ${atlas == null});`
        );
        if (style === 'cosmic' && index === 0) {
          const reference = await win.webContents.capturePage();
          fs.writeFileSync(path.join(OUTPUT, 'reference-cosmic-web.png'), reference.toPNG());
        }
        const particles = packParticles(payload);
        const candidateAtlas = payload.atlas ? decodeDataURL(payload.atlas, 'image/png') : null;
        const expectedBytes = payload.count * PACKED_STRIDE_BYTES;

        if (payload.style !== style || !Number.isInteger(payload.count) || payload.count < 1_000 || payload.stride !== SOURCE_STRIDE) {
          throw new Error(`Invalid ${style} particle metadata: ${JSON.stringify({ style: payload.style, count: payload.count, stride: payload.stride })}`);
        }
        if (expectedCount == null) {
          expectedCount = payload.count;
        } else if (payload.count !== expectedCount) {
          throw new Error(`${style} pattern ${index} changed particle layout`);
        }
        if (particles.length !== expectedBytes) {
          throw new Error(`${style} pattern ${index} is ${particles.length} bytes; expected ${expectedBytes}`);
        }
        if (candidateAtlas && (candidateAtlas.length < 8 || candidateAtlas.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')) {
          throw new Error('Grain atlas is not a PNG');
        }
        if (atlas == null && candidateAtlas) atlas = candidateAtlas;

        const hash = sha256(particles);
        if (uniqueHashes.has(hash)) throw new Error(`${style} pattern ${index} duplicates an earlier pattern`);
        uniqueHashes.add(hash);
        buffers.push(particles);
        patternMetadata.push({ index, seed, goal: Number(payload.goal) || 0, time: Number(payload.time) || 0, sha256: hash });
      }

      const distinctGoals = new Set(patternMetadata.map((pattern) => pattern.goal.toFixed(5)));
      if (distinctGoals.size < Math.floor(PATTERN_COUNT * 0.9)) {
        throw new Error(`${style} generated only ${distinctGoals.size} distinct modal targets`);
      }
      const combined = Buffer.concat(buffers);
      const file = `particles-${style}.bin`;
      fs.writeFileSync(path.join(OUTPUT, file), combined);
      styleMetadata[style] = {
        file,
        sha256: sha256(combined),
        patterns: patternMetadata
      };
    }

    fs.writeFileSync(path.join(OUTPUT, 'grain-atlas.png'), atlas);
    fs.writeFileSync(path.join(OUTPUT, 'metadata.json'), `${JSON.stringify({
      version: 3,
      count: expectedCount,
      sourceStride: SOURCE_STRIDE,
      strideBytes: PACKED_STRIDE_BYTES,
      patternCount: PATTERN_COUNT,
      seeds,
      styles: styleMetadata,
      atlasSHA256: sha256(atlas)
    }, null, 2)}\n`);

    console.log(`Exported compact ${expectedCount.toLocaleString('en-US')}-particle modal pattern pool for ${STYLES.join(' + ')} to ${OUTPUT}`);
  } finally {
    win.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
