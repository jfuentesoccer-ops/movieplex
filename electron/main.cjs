// MoviePlex desktop shell. The renderer is the same Vite build as the web app,
// served from a privileged app:// scheme so it gets a stable, secure origin.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CastManager } = require('./cast.cjs');
const { Transcoder } = require('./transcode.cjs');
const { Updater } = require('./updater.cjs');

// `npm run desktop:dev` passes --dev-url=<vite server> so the window gets hot reload.
const devUrlArg = process.argv.find((a) => a.startsWith('--dev-url='));
const isDev = !app.isPackaged && !!devUrlArg;
const DEV_URL = devUrlArg ? devUrlArg.slice('--dev-url='.length) : '';
const APP_URL = 'app://movieplex';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEEP_LINK_SCHEME = 'movieplex';
const isMac = process.platform === 'darwin';

// Lets the player switch between a file's audio tracks itself (video.audioTracks), so changing
// language on playable audio is instant instead of going through conversion.
app.commandLine.appendSwitch('enable-blink-features', 'AudioVideoTracks');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;
let rendererReady = false;
/** Routes waiting for the renderer to finish loading. */
const pendingRoutes = [];

// ---------- Deep links ----------
// movieplex://host/path/manifest.json      -> install https://host/path/manifest.json
// movieplex:///detail/movie/tt0111161      -> open that route in the app
// Links come from any website, so they may only open browsing pages (never the player, which
// would start fetching whatever stream the link names, or settings).
const DEEP_LINK_ROUTES = /^\/(detail|discover|search|library|calendar|addons)(\/|\?|$)/;
function routeFromDeepLink(link) {
  if (!link || !link.startsWith(`${DEEP_LINK_SCHEME}://`)) return null;
  const rest = link.slice(`${DEEP_LINK_SCHEME}://`.length);
  if (/manifest\.json(\?.*)?$/.test(rest)) {
    return `/addons?addon=${encodeURIComponent('https://' + rest.replace(/^\/+/, ''))}`;
  }
  const route = '/' + rest.replace(/^\/+/, '');
  return DEEP_LINK_ROUTES.test(route) ? route : '/';
}

function openRoute(route) {
  if (!route) return;
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('navigate', route);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingRoutes.push(route);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Windows/Linux pass deep links to the already-running instance via argv.
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (link) openRoute(routeFromDeepLink(link));
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// macOS delivers deep links through open-url, possibly before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  openRoute(routeFromDeepLink(url));
});

if (app.isPackaged) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);

// ---------- Window state ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1400, height: 880 };
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // non-fatal
  }
}

// ---------- Static file serving for app:// ----------
// Only the app's own scripts may run (no inline or injected ones), so content from addons or
// subtitles can never execute code. Media, images and addon requests may come from anywhere.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'connect-src * data: blob: ws: wss:',
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const requested = path.normalize(path.join(DIST_DIR, decodeURIComponent(pathname)));
    // Refuse anything that escapes dist/; unknown paths fall back to the SPA entry.
    if (requested !== DIST_DIR && !requested.startsWith(DIST_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    const file = fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(DIST_DIR, 'index.html');
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(res.body, { status: res.status, headers });
  });
}

// Electron grants every permission by default; the app only needs fullscreen and copying.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
function restrictPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/** IPC is only for the app's own page, not for frames inside it (e.g. the YouTube player). */
function fromApp(event) {
  const frame = event.senderFrame;
  return !!mainWindow && event.sender === mainWindow.webContents && frame === mainWindow.webContents.mainFrame && isAppUrl(frame.url);
}
/** ipcMain.handle / ipcMain.on that ignore anything but the app's own page. */
const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => (fromApp(event) ? fn(...args) : null));
const listen = (channel, fn) => ipcMain.on(channel, (event, ...args) => fromApp(event) && fn(...args));

// YouTube's embed player refuses to load (Error 153) without an http(s) Referer,
// which pages served from app:// don't send. Supply the embed's own origin.
function fixYouTubeReferer() {
  const filter = { urls: ['*://*.youtube-nocookie.com/*', '*://*.youtube.com/*'] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = details.requestHeaders;
    if (!headers.Referer || !/^https?:/.test(headers.Referer)) {
      headers.Referer = 'https://www.youtube-nocookie.com/';
    }
    callback({ requestHeaders: headers });
  });
}

// ---------- Window ----------
function isAppUrl(url) {
  return url.startsWith(APP_URL) || (isDev && url.startsWith(DEV_URL));
}

function createWindow() {
  const state = loadWindowState();
  rendererReady = false;

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 380,
    minHeight: 560,
    title: 'MoviePlex',
    backgroundColor: '#0b0a12',
    show: false,
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    icon: isMac ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', () => mainWindow && saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Addon configure pages, IMDb links, etc. open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Leaving fullscreen with Esc should also work for the native window.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });

  mainWindow.loadURL(isDev ? DEV_URL : `${APP_URL}/index.html`);
}

// ---------- Casting ----------
const cast = new CastManager((channel, payload) => mainWindow?.webContents.send(channel, payload));
handle('cast:devices', () => {
  cast.startDiscovery();
  return cast.listDevices();
});
handle('cast:load', async (media) => {
  try {
    await cast.load(media);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
listen('cast:control', (action, value) => cast.control(action, value));
app.on('before-quit', () => cast.dispose());

// ---------- Audio conversion (Dolby / DTS -> AAC) ----------
const transcoder = new Transcoder();
handle('media:resolve', (url, headers) => transcoder.inspect(url, headers).catch(() => ({ url, audio: null })));
handle('media:open', (url, headers) => transcoder.open(url, headers).catch(() => null));
handle('media:prepare', (url, headers) => transcoder.prepare(url, headers).catch(() => null));
handle('media:startPoint', (base, start, audio) => transcoder.startPoint(base, start, audio).catch(() => start));
app.on('before-quit', () => transcoder.dispose());

// ---------- Updates ----------
const updater = new Updater((state) => mainWindow?.webContents.send('update:state', state));
handle('update:get', () => updater.state);
handle('update:check', () => updater.check());
handle('update:install', () => updater.install());
app.on('before-quit', () => updater.dispose());

// ---------- Skip intro timings ----------
// IntroDB only allows CORS from its own site, so the renderer asks the main process.
handle('segments:get', async (ref) => {
  const { imdbId, season, episode } = ref ?? {};
  if (!/^tt\d+$/.test(imdbId) || !Number.isInteger(season) || !Number.isInteger(episode)) return null;
  try {
    const res = await fetch(
      `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`,
      { signal: AbortSignal.timeout(8000) },
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
});

listen('renderer-ready', () => {
  rendererReady = true;
  while (pendingRoutes.length) mainWindow.webContents.send('navigate', pendingRoutes.shift());
});

// ---------- Menu ----------
function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Install Addon…',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => openRoute('/addons/installed?install=1'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Board', accelerator: 'CmdOrCtrl+1', click: () => openRoute('/') },
        { label: 'Discover', accelerator: 'CmdOrCtrl+2', click: () => openRoute('/discover') },
        { label: 'Library', accelerator: 'CmdOrCtrl+3', click: () => openRoute('/library') },
        { label: 'Calendar', accelerator: 'CmdOrCtrl+4', click: () => openRoute('/calendar') },
        { label: 'Addons', accelerator: 'CmdOrCtrl+5', click: () => openRoute('/addons') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => openRoute('/settings') },
        { type: 'separator' },
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => openRoute('/search') },
        {
          label: 'Back',
          accelerator: isMac ? 'Cmd+[' : 'Alt+Left',
          click: () => mainWindow?.webContents.navigationHistory.goBack(),
        },
        {
          label: 'Forward',
          accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
          click: () => mainWindow?.webContents.navigationHistory.goForward(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  // Earlier builds kept a playback timing log for diagnosing slow starts; remove it.
  fs.rm(path.join(app.getPath('userData'), 'playback-timing.log'), { force: true }, () => {});
  registerAppProtocol();
  restrictPermissions();
  fixYouTubeReferer();
  buildMenu();
  createWindow();
  updater.start();

  // A deep link can also arrive as a launch argument (Windows/Linux).
  const link = process.argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
  if (link) openRoute(routeFromDeepLink(link));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
