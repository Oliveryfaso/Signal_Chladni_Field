// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const VISUALIZER = path.join(ROOT, 'app', 'index.html');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

async function state(win) {
  return win.webContents.executeJavaScript('window.soundMotionTest ? window.soundMotionTest.state() : null;');
}

async function waitFor(win, predicate, label, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await state(win);
    if (current && predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function canvasMetrics(win) {
  return win.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('hero-3d');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, sum = 0, lit8 = 0;
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const offset = (y * canvas.width + x) * 4;
        const luma = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
        count += 1; sum += luma; if (luma >= 8) lit8 += 1;
      }
    }
    return { mean: sum / count, lit8: lit8 / count };
  })()`);
}

async function main() {
  await app.whenReady();
  const windows = [];

  try {
    const results = await Promise.all(['sand', 'dcosmic'].map(async (style) => {
      const win = new BrowserWindow({
        width: 480,
        height: 320,
        show: false,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      });
      windows.push(win);
      await win.loadFile(VISUALIZER, { query: { overlay: '1', style, dpr: '1', seed: '20260710' } });
      const guard = await win.webContents.executeJavaScript('window.soundMotionTest.lowFrequencyProtectionForTest();');
      await win.webContents.executeJavaScript('window.soundMotionNative.playDemo();');
      await waitFor(
        win,
        (current) => current.playing && current.audioSource === 'demo' && current.demoSignal,
        `${style} generated demo signal`
      );
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      const metadata = await win.webContents.executeJavaScript("document.getElementById('hero-meta').textContent;");
      return { style, state: await state(win), visual: await canvasMetrics(win), guard, metadata };
    }));

    for (const result of results) {
      if (result.state.audioSource !== 'demo' || !result.state.demoSignal) {
        throw new Error(`Unexpected ${result.style} demo state: ${JSON.stringify(result.state)}`);
      }
      if (Math.abs(result.state.detail - 1.5) > 1e-6) {
        throw new Error(`Unexpected ${result.style} default detail: ${result.state.detail}`);
      }
      if (!result.metadata.includes('演示信号') || result.metadata.includes('加载失败')) {
        throw new Error(`Generated demo metadata is unavailable: ${result.metadata}`);
      }
      const weightSum = result.guard.dynamic.reduce((sum, weight) => sum + weight, 0);
      if (!result.guard.applied || result.guard.stillApplied || Math.abs(weightSum - 1) > 1e-9) {
        throw new Error(`Low-frequency mode protection failed: ${JSON.stringify(result.guard)}`);
      }
    }

    const sand = results.find((result) => result.style === 'sand');
    const cosmic = results.find((result) => result.style === 'dcosmic');
    if (sand.visual.lit8 < 0.08 || sand.visual.mean < 12) {
      throw new Error(`Dynamic sand became too dark: ${JSON.stringify(sand.visual)}`);
    }
    if (cosmic.visual.lit8 < 0.05 || cosmic.visual.mean < 4) {
      throw new Error(`Dynamic cosmic became too dark: ${JSON.stringify(cosmic.visual)}`);
    }
    console.log(`PASS generated demo signal keeps sand and cosmic visible after 8 s: sand=${(sand.visual.lit8 * 100).toFixed(1)}%, cosmic=${(cosmic.visual.lit8 * 100).toFixed(1)}% lit`);
  } finally {
    windows.forEach((win) => win.destroy());
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
