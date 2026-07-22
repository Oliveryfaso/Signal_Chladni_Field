// Signal Field modification notice (2026-07-20). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
  Tray
} = require('electron');

const ROOT_DIR = path.join(__dirname, '..');
const CONTROLLER_FILE = path.join(__dirname, 'controller.html');
const VISUALIZER_FILE = path.join(ROOT_DIR, 'app', 'index.html');
const PRELOAD_FILE = path.join(__dirname, 'preload.cjs');
const APP_ICON_FILE = path.join(__dirname, 'assets', 'signal-field-icon.png');
const IS_SMOKE = process.argv.includes('--smoke');
const APP_NAME = 'Signal Field';

let controllerWindow = null;
let visualizerWindow = null;
let tray = null;
let trayTitle = '';
let pendingVisualizerCommands = [];
let visualizerRestoreBounds = null;
let systemAudioFollowing = false;
let appPreferences = {
  systemAudioPromptSeen: false
};

// On macOS, Screen Recording permission can be denied after Chromium has
// already issued getDisplayMedia(). Electron then rejects its internal capture
// request after our controller has caught the browser-side rejection. Keep that
// expected permission failure from becoming an unhandled main-process promise;
// other rejections remain visible in the terminal for diagnosis.
process.on('unhandledRejection', (reason) => {
  const message = reason && reason.message ? reason.message : String(reason || '');
  if (/Failed to get sources|Video was requested, but no video stream was provided/.test(message)) {
    console.warn(`System-audio capture unavailable: ${message}`);
    return;
  }
  console.error('Unhandled main-process rejection:', reason);
});

const visualizerState = {
  shape: 'circle',
  size: 240,
  alwaysOnTop: true,
  fullScreen: false,
  transparent: true
};

const controlState = {
  sampleMode: 'beat',
  patternInterval: 2
};

const MIN_VISUALIZER_SIZE = 120;
const MAX_VISUALIZER_SIZE = 300;

function preferencesFile() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function loadAppPreferences() {
  try {
    const raw = fs.readFileSync(preferencesFile(), 'utf8');
    const parsed = JSON.parse(raw);
    appPreferences = {
      ...appPreferences,
      ...(parsed && typeof parsed === 'object' ? parsed : {})
    };
  } catch (_error) {}
  appPreferences.systemAudioPromptSeen = Boolean(appPreferences.systemAudioPromptSeen);
}

function saveAppPreferences() {
  try {
    const file = preferencesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(appPreferences, null, 2));
  } catch (_error) {}
}

function createWindowIcon() {
  const fileIcon = nativeImage.createFromPath(APP_ICON_FILE);
  if (!fileIcon.isEmpty()) return fileIcon;
  return nativeImage.createFromDataURL(
    'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
          '<rect width="32" height="32" rx="7" fill="#050608"/>' +
          '<path d="M7 18c4-8 14-8 18 0M7 14c4 8 14 8 18 0" fill="none" stroke="#46b8a5" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="16" cy="16" r="3" fill="#d9933d"/>' +
        '</svg>'
      )
  );
}

function createMenuBarIcon() {
  const image = nativeImage.createFromDataURL(
    'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
          '<path d="M4 12.5c3-7 11-7 14 0M4 9.5c3 7 11 7 14 0" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round"/>' +
          '<circle cx="11" cy="11" r="2.1" fill="#000"/>' +
        '</svg>'
      )
  );
  image.setTemplateImage(true);
  return image;
}

function setTrayLabel() {
  if (!tray || process.platform !== 'darwin') return;
  const mode = controlState.sampleMode === 'time' ? `${formatPatternInterval(controlState.patternInterval)}s` : 'Beat';
  trayTitle = `SM ${mode}`;
  tray.setTitle(trayTitle);
}

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function calculateBounds({ preserveCurrent = false } = {}) {
  const workArea = getWorkArea();
  const size = Math.max(MIN_VISUALIZER_SIZE, Math.min(MAX_VISUALIZER_SIZE, Number(visualizerState.size) || 240));
  const margin = 24;
  if (preserveCurrent && visualizerWindow && !visualizerWindow.isDestroyed()) {
    const bounds = visualizerWindow.getNormalBounds ? visualizerWindow.getNormalBounds() : visualizerWindow.getBounds();
    return { x: bounds.x, y: bounds.y, width: size, height: size };
  }
  return { x: workArea.x + workArea.width - size - margin, y: workArea.y + margin, width: size, height: size };
}

function clampPatternInterval(value) {
  const numeric = Number(value);
  return Math.max(0.25, Math.min(30, Number.isFinite(numeric) ? numeric : 2));
}

function formatPatternInterval(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function sendVisualizerCommand(command) {
  if (!visualizerWindow || visualizerWindow.isDestroyed()) {
    pendingVisualizerCommands.push(command);
    return;
  }

  if (visualizerWindow.webContents.isLoading()) {
    pendingVisualizerCommands.push(command);
    return;
  }

  visualizerWindow.webContents.send('sound-motion:visualizer-command', command);
}

function visualizerHostVisible() {
  return Boolean(
    visualizerWindow &&
      !visualizerWindow.isDestroyed() &&
      visualizerWindow.isVisible() &&
      !visualizerWindow.isMinimized()
  );
}

function syncVisualizerHostVisibility() {
  sendVisualizerCommand({ type: 'hostVisibility', visible: visualizerHostVisible() });
}

function flushVisualizerCommands() {
  syncVisualizerHostVisibility();
  sendVisualizerCommand({ type: 'call', method: 'setOverlayShape', args: [visualizerState.shape] });
  sendVisualizerCommand({ type: 'call', method: 'setTransparent', args: [Boolean(visualizerState.transparent)] });
  sendVisualizerCommand({ type: 'call', method: 'selectSource', args: ['system'] });
  sendVisualizerCommand({ type: 'call', method: 'setSampleMode', args: [controlState.sampleMode] });
  sendVisualizerCommand({ type: 'call', method: 'setParam', args: ['patternInterval', controlState.patternInterval] });
  const commands = pendingVisualizerCommands;
  pendingVisualizerCommands = [];
  commands.forEach(sendVisualizerCommand);
}

function loadVisualizerContent() {
  if (!visualizerWindow || visualizerWindow.isDestroyed()) return;
  visualizerWindow.loadFile(VISUALIZER_FILE, {
    query: {
      overlay: '1',
      transparent: visualizerState.transparent ? '1' : '0'
    }
  });
}

function broadcastVisualizerState() {
  if (controllerWindow && !controllerWindow.isDestroyed() && !controllerWindow.webContents.isLoading()) {
    controllerWindow.webContents.send('sound-motion:visualizer-state', { ...visualizerState });
  }
}

function broadcastControlState() {
  if (controllerWindow && !controllerWindow.isDestroyed() && !controllerWindow.webContents.isLoading()) {
    controllerWindow.webContents.send('sound-motion:control-state', { ...controlState });
  }
}

function setSampleMode(sampleMode) {
  if (sampleMode !== 'beat' && sampleMode !== 'time') return { ...controlState };
  controlState.sampleMode = sampleMode;
  sendVisualizerCommand({ type: 'call', method: 'setSampleMode', args: [controlState.sampleMode] });
  sendVisualizerCommand({ type: 'call', method: 'setParam', args: ['patternInterval', controlState.patternInterval] });
  buildMenu();
  broadcastControlState();
  return { ...controlState };
}

function setPatternInterval(value) {
  controlState.patternInterval = clampPatternInterval(value);
  controlState.sampleMode = 'time';
  sendVisualizerCommand({ type: 'call', method: 'setSampleMode', args: ['time'] });
  sendVisualizerCommand({ type: 'call', method: 'setParam', args: ['patternInterval', controlState.patternInterval] });
  buildMenu();
  broadcastControlState();
  return { ...controlState };
}

function applyVisualizerBounds(next = {}) {
  Object.assign(visualizerState, next);
  if (!visualizerWindow || visualizerWindow.isDestroyed()) return visualizerState;
  if (!visualizerState.fullScreen) visualizerWindow.setBounds(calculateBounds({ preserveCurrent: true }), true);
  visualizerWindow.setAlwaysOnTop(Boolean(visualizerState.alwaysOnTop), 'screen-saver');
  visualizerWindow.setVisibleOnAllWorkspaces(Boolean(visualizerState.alwaysOnTop), {
    visibleOnFullScreen: true
  });
  sendVisualizerCommand({ type: 'call', method: 'setOverlayShape', args: [visualizerState.shape] });
  sendVisualizerCommand({ type: 'call', method: 'setTransparent', args: [Boolean(visualizerState.transparent)] });
  buildMenu();
  broadcastVisualizerState();
  return visualizerState;
}

function setVisualizerFullScreen(fullScreen) {
  const win = createVisualizerWindow();
  if (fullScreen && !visualizerState.fullScreen) visualizerRestoreBounds = win.getBounds();
  visualizerState.fullScreen = Boolean(fullScreen);
  win.setFullScreen(visualizerState.fullScreen);
  if (!visualizerState.fullScreen) {
    win.setBounds(visualizerRestoreBounds || calculateBounds({ preserveCurrent: true }), true);
    visualizerRestoreBounds = null;
  }
  buildMenu();
  broadcastVisualizerState();
  return visualizerState;
}

function showControllerWindow() {
  const win = createControllerWindow();
  win.show();
  win.focus();
  return win;
}

function showVisualizerWindow() {
  const win = createVisualizerWindow();
  win.show();
  syncVisualizerHostVisibility();
  return win;
}

function hideVisualizerWindow() {
  if (visualizerWindow && !visualizerWindow.isDestroyed()) {
    visualizerWindow.hide();
    syncVisualizerHostVisibility();
  }
}

function createControllerWindow() {
  if (controllerWindow && !controllerWindow.isDestroyed()) {
    controllerWindow.show();
    controllerWindow.focus();
    return controllerWindow;
  }

  controllerWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 420,
    minHeight: 680,
    show: !IS_SMOKE,
    title: APP_NAME,
    backgroundColor: '#090a0b',
    icon: createWindowIcon(),
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  controllerWindow.loadFile(CONTROLLER_FILE);
  controllerWindow.on('closed', () => {
    controllerWindow = null;
  });

  return controllerWindow;
}

function createVisualizerWindow() {
  if (visualizerWindow && !visualizerWindow.isDestroyed()) {
    visualizerWindow.show();
    return visualizerWindow;
  }

  visualizerWindow = new BrowserWindow({
    ...calculateBounds(),
    minWidth: MIN_VISUALIZER_SIZE,
    minHeight: MIN_VISUALIZER_SIZE,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    hasShadow: false,
    show: !IS_SMOKE,
    skipTaskbar: false,
    title: `${APP_NAME} Visualizer`,
    backgroundColor: '#00000000',
    icon: createWindowIcon(),
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  visualizerWindow.setAlwaysOnTop(Boolean(visualizerState.alwaysOnTop), 'screen-saver');
  visualizerWindow.setVisibleOnAllWorkspaces(Boolean(visualizerState.alwaysOnTop), {
    visibleOnFullScreen: true
  });

  loadVisualizerContent();

  visualizerWindow.webContents.on('did-finish-load', flushVisualizerCommands);
  visualizerWindow.on('show', syncVisualizerHostVisibility);
  visualizerWindow.on('hide', syncVisualizerHostVisibility);
  visualizerWindow.on('minimize', syncVisualizerHostVisibility);
  visualizerWindow.on('restore', syncVisualizerHostVisibility);
  visualizerWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && visualizerState.fullScreen) {
      setVisualizerFullScreen(false);
    }
  });
  visualizerWindow.webContents.on('context-menu', (event, params) => {
    if (params && params.isEditable) return;
    event.preventDefault();
    showMenuBarMenu(visualizerWindow);
  });
  visualizerWindow.on('leave-full-screen', () => {
    if (!visualizerState.fullScreen) return;
    visualizerState.fullScreen = false;
    visualizerWindow.setBounds(visualizerRestoreBounds || calculateBounds({ preserveCurrent: true }), true);
    visualizerRestoreBounds = null;
    buildMenu();
    broadcastVisualizerState();
  });
  visualizerWindow.on('closed', () => {
    visualizerWindow = null;
  });

  return visualizerWindow;
}

function requestControllerCapture(action) {
  const win =
    action === 'start'
      ? showControllerWindow()
      : controllerWindow && !controllerWindow.isDestroyed()
        ? controllerWindow
        : null;
  if (!win) return;
  const send = () => win.webContents.send('sound-motion:capture-request', { action });
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function followSystemAudio() {
  createVisualizerWindow();
  sendVisualizerCommand({ type: 'call', method: 'selectSource', args: ['system'] });
  requestControllerCapture('start');
}

function unfollowSystemAudio() {
  systemAudioFollowing = false;
  sendVisualizerCommand({ type: 'call', method: 'stop', args: [] });
  requestControllerCapture('stop');
  buildMenu();
}

function showPatternIntervalPrompt() {
  const parent = controllerWindow && !controllerWindow.isDestroyed() ? controllerWindow : null;
  const promptWindow = new BrowserWindow({
    width: 320,
    height: 190,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    modal: Boolean(parent),
    parent: parent || undefined,
    title: 'Pattern Interval',
    backgroundColor: '#090a0b',
    icon: createWindowIcon(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });
  const channel = `sound-motion:pattern-interval:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  ipcMain.once(channel, (_event, value) => {
    setPatternInterval(value);
    if (!promptWindow.isDestroyed()) promptWindow.close();
  });
  promptWindow.on('closed', () => {
    ipcMain.removeAllListeners(channel);
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<style>
body{margin:0;background:#090a0b;color:#eef3ef;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
form{padding:18px;display:grid;gap:12px}
h1{font-size:14px;margin:0;color:#46b8a5}
label{display:grid;gap:6px;color:#9aa79d}
input{height:36px;border:1px solid #263029;border-radius:7px;background:#171a18;color:#eef3ef;padding:0 10px;font:inherit}
.actions{display:flex;justify-content:flex-end;gap:8px}
button{height:34px;border:1px solid #263029;border-radius:7px;background:#171a18;color:#eef3ef;padding:0 12px;font:inherit;cursor:pointer}
button.primary{background:#46b8a5;color:#04100e;border-color:#46b8a5;font-weight:650}
</style>
</head>
<body>
<form id="form">
  <h1>定时更新 pattern</h1>
  <label>秒数 <input id="seconds" type="number" min="0.25" max="30" step="0.25" value="${formatPatternInterval(controlState.patternInterval)}" autofocus></label>
  <div class="actions"><button type="button" id="cancel">取消</button><button class="primary" type="submit">应用</button></div>
</form>
<script>
const { ipcRenderer } = require('electron');
const input = document.getElementById('seconds');
document.getElementById('cancel').addEventListener('click', () => window.close());
document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();
  ipcRenderer.send(${JSON.stringify(channel)}, input.value);
});
input.select();
</script>
</body>
</html>`;
  promptWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  promptWindow.once('ready-to-show', () => promptWindow.show());
}

function visualizerMenuItems() {
  return [
    { label: 'Show Controls', accelerator: 'CmdOrCtrl+,', click: () => showControllerWindow() },
    {
      label: 'Show Visualizer',
      accelerator: 'CmdOrCtrl+Shift+V',
      click: () => showVisualizerWindow()
    },
    {
      label: 'Hide Visualizer',
      click: () => hideVisualizerWindow()
    },
    { type: 'separator' },
    {
      label: 'Full Screen',
      accelerator: 'F11',
      type: 'checkbox',
      checked: Boolean(visualizerState.fullScreen),
      click: (item) => setVisualizerFullScreen(item.checked)
    },
    {
      label: 'Transparent Background',
      type: 'checkbox',
      checked: Boolean(visualizerState.transparent),
      click: (item) => applyVisualizerBounds({ transparent: item.checked })
    },
    { type: 'separator' },
    {
      label: '120 px',
      type: 'radio',
      checked: visualizerState.size === 120,
      click: () => applyVisualizerBounds({ size: 120 })
    },
    {
      label: '240 px',
      type: 'radio',
      checked: visualizerState.size === 240,
      click: () => applyVisualizerBounds({ size: 240 })
    },
    {
      label: '300 px',
      type: 'radio',
      checked: visualizerState.size === 300,
      click: () => applyVisualizerBounds({ size: 300 })
    },
    { type: 'separator' },
    {
      label: 'Always On Top',
      type: 'checkbox',
      checked: Boolean(visualizerState.alwaysOnTop),
      click: (item) => applyVisualizerBounds({ alwaysOnTop: item.checked })
    }
  ];
}

function viewMenuItems() {
  return [
    {
      label: 'Dynamic Sand',
      accelerator: 'CmdOrCtrl+1',
      click: () => sendVisualizerCommand({ type: 'call', method: 'setStyle', args: ['sand'] })
    },
    {
      label: 'Modal Sand',
      accelerator: 'CmdOrCtrl+2',
      click: () => sendVisualizerCommand({ type: 'call', method: 'setStyle', args: ['msand'] })
    },
    {
      label: 'Cosmic',
      accelerator: 'CmdOrCtrl+3',
      click: () => sendVisualizerCommand({ type: 'call', method: 'setStyle', args: ['cosmic'] })
    },
    {
      label: 'Dynamic Cosmic',
      accelerator: 'CmdOrCtrl+4',
      click: () => sendVisualizerCommand({ type: 'call', method: 'setStyle', args: ['dcosmic'] })
    },
    {
      label: 'Sand',
      click: () => sendVisualizerCommand({ type: 'call', method: 'setStyle', args: ['sand'] })
    },
    { type: 'separator' },
    {
      label: 'Sampling',
      submenu: samplingMenuItems()
    },
    { type: 'separator' },
    {
      label: '3D Lighting',
      submenu: lightingMenuItems()
    }
  ];
}

function samplingMenuItems() {
  const intervalMatches = (value) => controlState.sampleMode === 'time' && Math.abs(controlState.patternInterval - value) < 1e-6;
  return [
    {
      label: 'Beat',
      type: 'radio',
      checked: controlState.sampleMode === 'beat',
      click: () => setSampleMode('beat')
    },
    {
      label: 'Timed',
      type: 'radio',
      checked: controlState.sampleMode === 'time',
      click: () => setSampleMode('time')
    },
    { type: 'separator' },
    {
      label: 'Every 1 Second',
      type: 'radio',
      checked: intervalMatches(1),
      click: () => setPatternInterval(1)
    },
    {
      label: 'Every 2 Seconds',
      type: 'radio',
      checked: intervalMatches(2),
      click: () => setPatternInterval(2)
    },
    {
      label: `Custom... (${formatPatternInterval(controlState.patternInterval)}s)`,
      click: () => showPatternIntervalPrompt()
    }
  ];
}

function lightingMenuItems() {
  return [
    ['Depth', 0],
    ['Low Light', 1],
    ['Top Area Light', 2],
    ['Point Light', 6],
    ['Rim Light', 7],
    ['Core Light', 8],
    ['Rotating Sweep', 9]
  ].map(([label, value]) => ({
    label,
    click: () => sendVisualizerCommand({ type: 'call', method: 'setParam', args: ['light', value] })
  }));
}

function windowMenuItems() {
  return visualizerMenuItems().slice(4);
}

function systemAudioMenuItems() {
  return [
    {
      label: '跟随系统音频',
      enabled: !systemAudioFollowing,
      click: () => followSystemAudio()
    },
    {
      label: '取消跟随系统音频',
      enabled: systemAudioFollowing,
      click: () => unfollowSystemAudio()
    }
  ];
}

function menuBarMenuTemplate() {
  return [
    ...systemAudioMenuItems(),
    { type: 'separator' },
    { label: 'Show Controls', click: () => showControllerWindow() },
    { label: 'Show Visualizer', click: () => showVisualizerWindow() },
    { label: 'Hide Visualizer', click: () => hideVisualizerWindow() },
    { type: 'separator' },
    {
      label: 'Sampling',
      submenu: samplingMenuItems()
    },
    { type: 'separator' },
    {
      label: 'Window',
      submenu: windowMenuItems()
    },
    {
      label: 'View',
      submenu: viewMenuItems()
    },
    { type: 'separator' },
    {
      label: 'Open Project Folder',
      click: () => shell.openPath(ROOT_DIR)
    },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: () => app.quit() }
  ];
}

function showMenuBarMenu(window) {
  Menu.buildFromTemplate(menuBarMenuTemplate()).popup({
    window: window && !window.isDestroyed() ? window : undefined
  });
}

function buildTrayMenu() {
  if (!tray) {
    tray = new Tray(createMenuBarIcon());
    tray.setToolTip(APP_NAME);
    setTrayLabel();
  }

  const contextMenu = Menu.buildFromTemplate(menuBarMenuTemplate());

  tray.setContextMenu(contextMenu);
  setTrayLabel();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push(
    {
      label: 'Visualizer',
      submenu: visualizerMenuItems()
    },
    {
      label: 'View',
      submenu: viewMenuItems()
    },
    {
      label: 'Sampling',
      submenu: samplingMenuItems()
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Project Folder',
          click: () => shell.openPath(ROOT_DIR)
        },
        { role: 'toggleDevTools' }
      ]
    }
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  buildTrayMenu();
}

async function installDisplayMediaHandler() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'display-capture';
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 }
        });
        const source = sources.find((item) => item.id.startsWith('screen:')) || sources[0];
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source, audio: 'loopback' });
      } catch (_error) {
        callback({});
      }
    },
    // Keep capture app-owned, like CueRecord's ScreenCaptureKit path. The macOS
    // system picker can bypass this handler and return a video-only stream.
    { useSystemPicker: false }
  );
}

async function openSystemAudioSettings() {
  const urls =
    process.platform === 'darwin'
      ? [
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenRecording'
        ]
      : process.platform === 'win32'
        ? ['ms-settings:sound']
        : [];

  for (const rawURL of urls) {
    try {
      await shell.openExternal(rawURL);
      return true;
    } catch (_error) {}
  }
  return false;
}

ipcMain.handle('sound-motion:get-state', () => ({ ...visualizerState }));

ipcMain.handle('sound-motion:get-control-state', () => ({ ...controlState }));

ipcMain.handle('sound-motion:set-sample-mode', (_event, sampleMode) => setSampleMode(sampleMode));

ipcMain.handle('sound-motion:set-pattern-interval', (_event, value) => setPatternInterval(value));

ipcMain.handle('sound-motion:get-preferences', () => ({ ...appPreferences }));

ipcMain.handle('sound-motion:mark-system-audio-prompt-seen', () => {
  appPreferences.systemAudioPromptSeen = true;
  saveAppPreferences();
  return { ...appPreferences };
});

ipcMain.handle('sound-motion:open-system-audio-settings', () => openSystemAudioSettings());

ipcMain.handle('sound-motion:set-visualizer-full-screen', (_event, fullScreen) => setVisualizerFullScreen(fullScreen));

ipcMain.handle('sound-motion:set-visualizer-bounds', (_event, next) => {
  createVisualizerWindow();
  return applyVisualizerBounds(next || {});
});

ipcMain.handle('sound-motion:show-visualizer', () => {
  showVisualizerWindow();
  return true;
});

ipcMain.handle('sound-motion:hide-visualizer', () => {
  hideVisualizerWindow();
  return true;
});

ipcMain.on('sound-motion:visualizer-command', (_event, command) => {
  sendVisualizerCommand(command);
});

ipcMain.on('sound-motion:system-audio-frame', (_event, frame) => {
  sendVisualizerCommand({ type: 'audioFrame', frame });
});

ipcMain.on('sound-motion:system-audio-state', (_event, payload) => {
  const active = Boolean(payload && payload.active);
  if (systemAudioFollowing !== active) {
    systemAudioFollowing = active;
    buildMenu();
  }
  sendVisualizerCommand({
    type: 'call',
    method: 'setSystemAudioState',
    args: [active, (payload && payload.label) || '系统音频 · 已停止']
  });
});

ipcMain.on('sound-motion:native-message', (_event, message) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'ready') {
    flushVisualizerCommands();
    return;
  }
  if (message.type === 'systemAudioStart') {
    requestControllerCapture('start');
  } else if (message.type === 'systemAudioStop') {
    requestControllerCapture('stop');
  }
});

async function runSmokeCheck() {
  createControllerWindow();
  createVisualizerWindow();
  await Promise.all([
    controllerWindow.webContents.executeJavaScript('document.readyState'),
    visualizerWindow.webContents.executeJavaScript(
      'new Promise((resolve) => setTimeout(() => resolve(Boolean(window.soundMotionNative)), 900))'
    )
  ]);
  if (!tray || tray.isDestroyed()) throw new Error('menu-bar-tray-not-created');
  const trayTemplate = menuBarMenuTemplate();
  if (trayTemplate[0].label !== '跟随系统音频' || trayTemplate[1].label !== '取消跟随系统音频') {
    throw new Error('system-audio-menu-items-not-first');
  }
  if (trayTemplate[0].enabled !== true || trayTemplate[1].enabled !== false) {
    throw new Error('system-audio-menu-default-state-invalid');
  }
  const appMenu = Menu.getApplicationMenu();
  if (!appMenu || !appMenu.items.some((item) => item.label === 'Sampling')) {
    throw new Error('sampling-app-menu-not-created');
  }
  if (process.platform === 'darwin' && !trayTitle.startsWith('SM ')) {
    throw new Error('sampling-menu-bar-title-not-created');
  }
  const defaultState = await visualizerWindow.webContents.executeJavaScript('window.soundMotionTest.state();');
  if (!defaultState.transparent) {
    throw new Error('default-transparent-not-enabled');
  }
  if (defaultState.rotationMode !== 'single') {
    throw new Error('default-rotation-mode-not-single');
  }
  if (defaultState.playing) {
    throw new Error('default-system-audio-autostart-enabled');
  }
  if (defaultState.view !== '3d') {
    throw new Error('default-view-not-3d');
  }
  if (defaultState.physics !== true) {
    throw new Error('default-fable-physics-disabled');
  }
  if (Math.abs(defaultState.zoom - 3) > 1e-6 || Math.abs(defaultState.zoom3d - 3) > 1e-6) {
    throw new Error('default-view-zoom-invalid');
  }
  if (Math.abs(defaultState.particles - 0.15) > 1e-6) {
    throw new Error('default-particle-density-invalid');
  }
  if (Math.abs(defaultState.detail - 1.5) > 1e-6) {
    throw new Error('default-detail-invalid');
  }
  if (defaultState.maxRenderFps !== 60) {
    throw new Error('visible-render-cap-invalid');
  }
  const styles = await visualizerWindow.webContents.executeJavaScript(`
    window.soundMotionNative.setStyle('msand');
    const m = window.soundMotionTest.state();
    window.soundMotionNative.setStyle('cosmic');
    const c = window.soundMotionTest.state();
    window.soundMotionNative.setStyle('dcosmic');
    const d = window.soundMotionTest.state();
    window.soundMotionNative.setStyle('sand');
    const s = window.soundMotionTest.state();
    ({ m, c, d, s });
  `);
  if (styles.m.style !== 'msand' || styles.c.style !== 'cosmic' || styles.d.style !== 'dcosmic' || styles.s.style !== 'sand') {
    throw new Error('style-switch-invalid');
  }
  if (Math.abs(styles.m.detail - 1) > 1e-6 || Math.abs(styles.c.detail - 1) > 1e-6 ||
      Math.abs(styles.d.detail - 1.5) > 1e-6 || Math.abs(styles.s.detail - 1.5) > 1e-6) {
    throw new Error('style-detail-default-invalid');
  }
  const lowModeProtection = await visualizerWindow.webContents.executeJavaScript(
    'window.soundMotionTest.lowFrequencyProtectionForTest();'
  );
  const dynamicWeightSum = lowModeProtection.dynamic.reduce((sum, weight) => sum + weight, 0);
  if (
    !lowModeProtection.applied ||
    lowModeProtection.stillApplied ||
    lowModeProtection.dynamic[0] > lowModeProtection.limit + 1e-9 ||
    lowModeProtection.dynamic[1] < 0.25 ||
    lowModeProtection.dynamic[2] < 0.1 ||
    lowModeProtection.dynamic[3] < 0.05 ||
    Math.abs(dynamicWeightSum - 1) > 1e-9 ||
    Math.abs(lowModeProtection.still[0] - 0.95) > 1e-9
  ) {
    throw new Error('dynamic-low-frequency-mode-protection-invalid');
  }
  const commandDrag = await visualizerWindow.webContents.executeJavaScript(`({
    withoutCommand: window.soundMotionTest.commandDragForTest(false),
    withCommand: window.soundMotionTest.commandDragForTest(true)
  });`);
  if (commandDrag.withoutCommand || !commandDrag.withCommand) {
    throw new Error('left-command-drag-gate-invalid');
  }
  const patternAdvance = await visualizerWindow.webContents.executeJavaScript(`({
    timed: window.soundMotionTest.patternAdvanceForTest('time'),
    beat: window.soundMotionTest.patternAdvanceForTest('beat')
  });`);
  if (patternAdvance.timed.count < 3) {
    throw new Error('timed-pattern-sampling-not-advancing');
  }
  if (patternAdvance.beat.count < 2) {
    throw new Error('beat-pattern-sampling-not-advancing');
  }
  const zoomBurst = await visualizerWindow.webContents.executeJavaScript('window.soundMotionTest.zoomBurstForTest();');
  if (!zoomBurst.queued || zoomBurst.runs > 1) {
    throw new Error('zoom-render-not-coalesced');
  }
  await visualizerWindow.webContents.executeJavaScript(`
    window.__soundMotionSmokeMarker = 'transparent-toggle-survived';
    window.soundMotionTest.forcePlayingForTest();
    true;
  `);
  applyVisualizerBounds({ transparent: true });
  const transparentState = await visualizerWindow.webContents.executeJavaScript(`
    new Promise((resolve) => setTimeout(() => resolve({
      marker: window.__soundMotionSmokeMarker,
      state: window.soundMotionTest.state()
    }), 180));
  `);
  if (transparentState.marker !== 'transparent-toggle-survived') {
    throw new Error('transparent-toggle-reloaded-visualizer');
  }
  if (!transparentState.state.transparent || !transparentState.state.playing) {
    throw new Error('transparent-toggle-stopped-visualizer');
  }
  app.quit();
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = createWindowIcon();
    // Only override the Dock icon when we actually have a real image; otherwise keep the bundle .icns.
    // (The SVG fallback decodes to an EMPTY nativeImage, and setIcon(empty) would blank the Dock on launch.)
    if (dockIcon && !dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
  loadAppPreferences();
  await installDisplayMediaHandler();
  buildMenu();
  createControllerWindow();
  createVisualizerWindow();
  if (IS_SMOKE) {
    setTimeout(() => {
      runSmokeCheck().catch((error) => {
        console.error(error);
        app.exit(1);
      });
    }, 500);
  }
});

app.on('activate', () => {
  showControllerWindow();
  showVisualizerWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
