const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const VISUALIZER_FILE = path.join(ROOT, 'app', 'index.html');
const OUT_DIR = path.join(ROOT, '.cache', 'visual-parity');
const WIDTH = 640;
const HEIGHT = 640;
const MAX_MEAN_DIFF = 0.15;
const MAX_CHANNEL_DIFF = 6;
const MAX_PIXEL_RATIO = 0.0005;

const CASES = [
  {
    name: '3d-sand-dynamic-base',
    commands: [
      ['setStyle', 'sand'],
      ['setSampleMode', 'beat'],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'symmetry', false],
      ['setBoolean', 'frame', true],
      ['setParam', 'detail', 1],
      ['setParam', 'particles', 0.45],
      ['setParam', 'zoom', 3],
      ['setParam', 'evolve', 0.5]
    ]
  },
  {
    name: '3d-msand-modal',
    commands: [
      ['setStyle', 'msand'],
      ['setSampleMode', 'time'],
      ['setParam', 'patternInterval', 4],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'symmetry', true],
      ['setBoolean', 'frame', false],
      ['setParam', 'detail', 1.6],
      ['setParam', 'particles', 0.6],
      ['setParam', 'zoom', 3],
      ['setParam', 'evolve', 0.35]
    ]
  },
  {
    name: '3d-cosmic-timed-pattern',
    commands: [
      ['setStyle', 'cosmic'],
      ['setSampleMode', 'time'],
      ['setParam', 'patternInterval', 4],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'symmetry', false],
      ['setBoolean', 'frame', false],
      ['setParam', 'detail', 1.6],
      ['setParam', 'particles', 0.7],
      ['setParam', 'zoom', 2.4],
      ['setParam', 'evolve', 0.5]
    ]
  },
  {
    name: '3d-dcosmic-base',
    commands: [
      ['setStyle', 'dcosmic'],
      ['setSampleMode', 'beat'],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'symmetry', false],
      ['setBoolean', 'frame', false],
      ['setParam', 'detail', 1.4],
      ['setParam', 'particles', 0.5],
      ['setParam', 'zoom', 2.2],
      ['setParam', 'evolve', 0.5]
    ]
  },
  {
    name: '3d-cosmic-light-shell',
    commands: [
      ['setStyle', 'cosmic'],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'frame', true],
      ['setRotationMode', 'precess'],
      ['setSolidShape', 'regular', 12, false],
      ['setParam', 'detail', 1.85],
      ['setParam', 'particles', 0.55],
      ['setParam', 'zoom', 1.4],
      ['setParam', 'rotationSpeed', 1.15],
      ['setParam', 'light', 7]
    ]
  },
  {
    name: '3d-sand-high-detail',
    commands: [
      ['setStyle', 'sand'],
      ['setBoolean', 'rotation', false],
      ['setBoolean', 'frame', false],
      ['setRotationMode', 'single'],
      ['setSolidShape', 'regular', 20, false],
      ['setParam', 'detail', 2.8],
      ['setParam', 'particles', 0.72],
      ['setParam', 'zoom', 6],
      ['setParam', 'rotationSpeed', 0],
      ['setParam', 'light', 8]
    ]
  }
];

app.on('window-all-closed', () => {});

function cleanOutputDir() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function createWindow(_kind, seed) {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    backgroundColor: '#00000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const query = {
    overlay: '1',
    parity: '1',
    seed: String(seed)
  };

  return win.loadFile(VISUALIZER_FILE, { query }).then(() => win);
}

async function settle(win) {
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => { let n = 0; const tick = () => (++n >= 5 ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); })'
  );
}

async function applyCommands(win, commands) {
  for (const command of commands) {
    const [method, ...args] = command;
    await win.webContents.executeJavaScript(
      `window.soundMotionNative.${method}(...${JSON.stringify(args)});`
    );
  }
  await win.webContents.executeJavaScript('window.soundMotionTest.renderStill();');
  await settle(win);
  return win.webContents.executeJavaScript('window.soundMotionTest.state();');
}

async function captureBitmap(win, label) {
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  const size = image.getSize();
  const png = image.toPNG();
  fs.writeFileSync(path.join(OUT_DIR, `${label}.png`), png);
  return {
    size,
    bitmap: image.toBitmap()
  };
}

function compareBitmaps(a, b) {
  if (a.size.width !== b.size.width || a.size.height !== b.size.height) {
    throw new Error(`size mismatch ${a.size.width}x${a.size.height} vs ${b.size.width}x${b.size.height}`);
  }
  if (a.bitmap.length !== b.bitmap.length) {
    throw new Error(`bitmap length mismatch ${a.bitmap.length} vs ${b.bitmap.length}`);
  }

  let total = 0;
  let max = 0;
  let mismatchedPixels = 0;
  const pixels = a.bitmap.length / 4;

  for (let i = 0; i < a.bitmap.length; i += 4) {
    let pixelMismatch = false;
    for (let c = 0; c < 4; c += 1) {
      const diff = Math.abs(a.bitmap[i + c] - b.bitmap[i + c]);
      total += diff;
      if (diff > max) max = diff;
      if (diff > MAX_CHANNEL_DIFF) pixelMismatch = true;
    }
    if (pixelMismatch) mismatchedPixels += 1;
  }

  return {
    mean: total / a.bitmap.length,
    max,
    mismatchedPixels,
    mismatchRatio: mismatchedPixels / pixels
  };
}

async function runCase(testCase, index) {
  const seed = 20260627 + index * 101;
  const web = await createWindow('web', seed);
  const desktop = await createWindow('app', seed);

  try {
    const webState = await applyCommands(web, testCase.commands);
    const desktopState = await applyCommands(desktop, testCase.commands);
    const webShot = await captureBitmap(web, `${testCase.name}-web`);
    const desktopShot = await captureBitmap(desktop, `${testCase.name}-mac`);
    const diff = compareBitmaps(webShot, desktopShot);
    const passed =
      diff.mean <= MAX_MEAN_DIFF &&
      diff.max <= MAX_CHANNEL_DIFF &&
      diff.mismatchRatio <= MAX_PIXEL_RATIO;

    return {
      name: testCase.name,
      seed,
      passed,
      diff,
      webState,
      desktopState
    };
  } finally {
    web.destroy();
    desktop.destroy();
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(`Mac parity verification must run on darwin, got ${process.platform}`);
  }
  cleanOutputDir();
  await app.whenReady();

  const results = [];
  for (let i = 0; i < CASES.length; i += 1) {
    const result = await runCase(CASES[i], i);
    results.push(result);
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`${status} ${result.name} mean=${result.diff.mean.toFixed(4)} max=${result.diff.max} mismatch=${(result.diff.mismatchRatio * 100).toFixed(4)}%`);
  }

  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);

  const failed = results.filter((result) => !result.passed);
  if (failed.length) {
    throw new Error(`${failed.length} parity case(s) failed. See ${reportPath}`);
  }

  console.log(`Mac Web/Electron visual parity passed. Artifacts: ${reportPath}`);
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
