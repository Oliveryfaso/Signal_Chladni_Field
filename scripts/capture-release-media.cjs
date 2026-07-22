const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, '.pages');
const RELEASE_MEDIA = path.join(ROOT, 'exports', 'release-media');
const PROFILE = path.join(ROOT, '.cache', `media-capture-${process.pid}`);
const MIME = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.png': 'image/png' };

app.setPath('userData', PROFILE);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

function buildSite() {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts', 'build-pages.sh')], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Pages build failed');
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let file = path.resolve(SITE, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${SITE}${path.sep}`) && file !== SITE) return response.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const body = fs.readFileSync(file);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch (_error) {
      response.writeHead(404).end('Not found');
    }
  });
}

async function waitFor(win, expression, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  if (image.isEmpty()) throw new Error(`Empty screenshot: ${name}`);
  fs.writeFileSync(path.join(RELEASE_MEDIA, name), image.toPNG());
  console.log(`Wrote exports/release-media/${name}`);
}

async function setLanguage(win, language) {
  await win.webContents.executeJavaScript(`(() => {
    const target=${JSON.stringify(language)};
    if(document.documentElement.lang!==target) document.getElementById('langBtn').click();
  })()`);
}

async function main() {
  buildSite();
  fs.mkdirSync(RELEASE_MEDIA, { recursive: true });
  await app.whenReady();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#07080c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });

  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    await waitFor(win, "Boolean(document.getElementById('engine').contentWindow.soundMotionTest)", 'visualizer');
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await win.webContents.executeJavaScript(`(() => {
      document.getElementById('engine').contentWindow.soundMotionNative.setBoolean('rotation',false);
      document.getElementById('spinBtn').click();
    })()`);
    await setLanguage(win, 'en');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await capture(win, 'showcase-en.png');

    await win.webContents.executeJavaScript("document.getElementById('settingsBtn').click()");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await capture(win, 'controls-en.png');

    await win.webContents.executeJavaScript("document.getElementById('closeSettingsBtn').click()");
    await setLanguage(win, 'en');
    win.setContentSize(390, 844);
    await waitFor(win, 'innerWidth===390 && innerHeight===844', 'mobile viewport');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const dock=document.getElementById('dock').getBoundingClientRect();
      return {left:dock.left,right:dock.right,bottom:dock.bottom,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};
    })()`);
    if (geometry.left < 0 || geometry.right > geometry.width || geometry.bottom > geometry.height || geometry.scrollWidth > geometry.width) {
      throw new Error(`Mobile controls overflow: ${JSON.stringify(geometry)}`);
    }
    await capture(win, 'showcase-mobile-en.png');
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(PROFILE, { recursive: true, force: true });
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  app.exit(1);
});
