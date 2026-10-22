// Exposes a minimal, isolated API to the renderer (no Node access).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('movieplexDesktop', {
  platform: process.platform,
  /** Subscribes to routes sent by the main process (menu items, deep links). */
  onNavigate(callback) {
    const listener = (_event, route) => callback(route);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },
  /** Chromecast (Default Media Receiver) via the main process. */
  cast: {
    devices: () => ipcRenderer.invoke('cast:devices'),
    load: (media) => ipcRenderer.invoke('cast:load', media),
    control: (action, value) => ipcRenderer.send('cast:control', action, value),
    onStatus(callback) {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('cast:status', listener);
      return () => ipcRenderer.removeListener('cast:status', listener);
    },
    onDevices(callback) {
      const listener = (_event, devices) => callback(devices);
      ipcRenderer.on('cast:devices', listener);
      return () => ipcRenderer.removeListener('cast:devices', listener);
    },
  },
  /** Probes a stream; for audio the player can't decode, returns a URL base for converted playback. */
  media: {
    resolve: (url, headers) => ipcRenderer.invoke('media:resolve', url, headers),
    open: (url, headers) => ipcRenderer.invoke('media:open', url, headers),
    prepare: (url, headers) => ipcRenderer.invoke('media:prepare', url, headers),
    startPoint: (base, start, audio) => ipcRenderer.invoke('media:startPoint', base, start, audio),
  },
  /** In-app updates (see electron/updater.cjs). */
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState(callback) {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update:state', listener);
      return () => ipcRenderer.removeListener('update:state', listener);
    },
  },
  /** Intro/recap/credits timings for an episode (IntroDB). */
  segments: (ref) => ipcRenderer.invoke('segments:get', ref),
  /** Tells the main process the router is mounted and can receive routes. */
  ready() {
    ipcRenderer.send('renderer-ready');
  },
});
