// In-app updates from GitHub Releases. Each release carries an update.json (written by
// scripts/release.cjs) naming the version and the Mac zip with its SHA-256. The zip is downloaded in
// the background and checked; once the user says so, a small script swaps the app bundle in place
// after MoviePlex quits and reopens it. (electron-updater's Mac installer requires an Apple
// Developer ID signature, which this app doesn't have.)
const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const CHECK_DELAY_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 15_000;
const BUNDLE_ID = 'com.movieplex.app';

/** "1.2.10" > "1.2.9" */
function newer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

const run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))),
  );

/** The .app bundle this process runs from (macOS), e.g. /Applications/MoviePlex.app. */
const currentBundle = () => path.resolve(path.dirname(app.getPath('exe')), '..', '..');

class Updater {
  /** @param {(state: object) => void} send pushes state changes to the renderer */
  constructor(send) {
    this.send = send;
    this.repo = require('../package.json').movieplexUpdates?.repo ?? '';
    this.state = { state: this.enabled() ? 'idle' : 'disabled', current: app.getVersion() };
    this.timer = null;
    this.pending = null; // { version, appPath } once downloaded and checked
  }

  enabled() {
    return app.isPackaged && /^[\w.-]+\/[\w.-]+$/.test(this.repo);
  }

  set(patch) {
    this.state = { ...this.state, ...patch, current: app.getVersion() };
    this.send(this.state);
  }

  start() {
    if (!this.enabled()) return;
    setTimeout(() => this.check(), CHECK_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  async check() {
    if (!this.enabled()) return this.state;
    if (['checking', 'downloading', 'ready'].includes(this.state.state)) return this.state;
    this.set({ state: 'checking', error: undefined });
    try {
      const res = await fetch(`https://github.com/${this.repo}/releases/latest/download/update.json`, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.status === 404) return this.set({ state: 'latest', checkedAt: Date.now() }), this.state;
      if (!res.ok) throw new Error(`update check failed (${res.status})`);
      const feed = await res.json();
      if (!feed?.version || !newer(feed.version, app.getVersion())) {
        this.set({ state: 'latest', checkedAt: Date.now() });
        return this.state;
      }
      const asset = process.platform === 'darwin' && process.arch === 'arm64' ? feed.mac : null;
      const info = { version: String(feed.version), notes: String(feed.notes ?? '') };
      // Only this repo's own release downloads, with a checksum, are installed.
      const fromRepo = String(asset?.url ?? '').startsWith(`https://github.com/${this.repo}/releases/download/`);
      if (!fromRepo || !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) {
        // No package this copy can install itself: point to the release page instead.
        this.set({ state: 'available', ...info, page: `https://github.com/${this.repo}/releases/latest` });
        return this.state;
      }
      await this.download(info, asset);
    } catch (err) {
      this.set({ state: 'error', error: err.message });
    }
    return this.state;
  }

  async download(info, asset) {
    const dir = path.join(app.getPath('temp'), 'movieplex-update');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'update.zip');
    this.set({ state: 'downloading', ...info, progress: 0 });

    const res = await fetch(asset.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(zip);
    let received = 0;
    let lastSent = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (total && Date.now() - lastSent > 250) {
        lastSent = Date.now();
        this.set({ progress: received / total });
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (hash.digest('hex') !== asset.sha256) throw new Error('the download was damaged; it will be retried later');

    // Unpack and make sure it really is MoviePlex at the advertised version.
    await run('/usr/bin/ditto', ['-x', '-k', zip, dir]);
    fs.rmSync(zip, { force: true });
    const appPath = path.join(dir, 'MoviePlex.app');
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    const [bundleId, version] = await Promise.all([
      run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist]),
      run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist]),
    ]);
    if (bundleId !== BUNDLE_ID || version !== info.version) throw new Error('the downloaded update does not match');
    this.pending = { version, appPath };
    this.set({ state: 'ready', progress: 1 });
  }

  /** Quits, swaps in the downloaded app and reopens it. */
  install() {
    if (!this.pending) return { ok: false, error: 'No update is ready.' };
    const target = currentBundle();
    if (!target.endsWith('.app') || target.startsWith('/Volumes/') || target.includes('/AppTranslocation/')) {
      return { ok: false, error: 'Move MoviePlex to your Applications folder first, then try again.' };
    }
    try {
      fs.accessSync(path.dirname(target), fs.constants.W_OK);
    } catch {
      return { ok: false, error: `MoviePlex can't write to ${path.dirname(target)}. Move it to Applications first.` };
    }
    // Waits for this process to exit, swaps the bundles (restoring the old one if anything fails),
    // then reopens MoviePlex.
    const script = `
      while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
      rm -rf "$2.old"
      if mv "$2" "$2.old" && mv "$3" "$2"; then rm -rf "$2.old"; else [ -d "$2" ] || mv "$2.old" "$2"; fi
      xattr -dr com.apple.quarantine "$2" 2>/dev/null
      open "$2"
    `;
    spawn('/bin/bash', ['-c', script, 'movieplex-update', String(process.pid), target, this.pending.appPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    setImmediate(() => app.quit());
    return { ok: true };
  }

  dispose() {
    clearInterval(this.timer);
  }
}

module.exports = { Updater, newer };
