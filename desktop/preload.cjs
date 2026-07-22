const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundMotionDesktop', {
  getState: () => ipcRenderer.invoke('sound-motion:get-state'),
  getControlState: () => ipcRenderer.invoke('sound-motion:get-control-state'),
  setSampleMode: (sampleMode) => ipcRenderer.invoke('sound-motion:set-sample-mode', sampleMode),
  setPatternInterval: (value) => ipcRenderer.invoke('sound-motion:set-pattern-interval', value),
  getPreferences: () => ipcRenderer.invoke('sound-motion:get-preferences'),
  markSystemAudioPromptSeen: () => ipcRenderer.invoke('sound-motion:mark-system-audio-prompt-seen'),
  setVisualizerBounds: (next) => ipcRenderer.invoke('sound-motion:set-visualizer-bounds', next),
  showVisualizer: () => ipcRenderer.invoke('sound-motion:show-visualizer'),
  hideVisualizer: () => ipcRenderer.invoke('sound-motion:hide-visualizer'),
  openSystemAudioSettings: () => ipcRenderer.invoke('sound-motion:open-system-audio-settings'),
  setVisualizerFullScreen: (fullScreen) => ipcRenderer.invoke('sound-motion:set-visualizer-full-screen', fullScreen),
  sendVisualizerCommand: (command) => ipcRenderer.send('sound-motion:visualizer-command', command),
  sendSystemAudioFrame: (frame) => ipcRenderer.send('sound-motion:system-audio-frame', frame),
  sendSystemAudioState: (payload) => ipcRenderer.send('sound-motion:system-audio-state', payload),
  onCaptureRequest: (handler) => {
    ipcRenderer.on('sound-motion:capture-request', (_event, payload) => handler(payload));
  },
  onVisualizerState: (handler) => {
    ipcRenderer.on('sound-motion:visualizer-state', (_event, payload) => handler(payload));
  },
  onControlState: (handler) => {
    ipcRenderer.on('sound-motion:control-state', (_event, payload) => handler(payload));
  }
});

contextBridge.exposeInMainWorld('soundMotionElectron', {
  postNative: (message) => ipcRenderer.send('sound-motion:native-message', message),
  onControl: (handler) => {
    ipcRenderer.on('sound-motion:visualizer-command', (_event, command) => handler(command));
  }
});
