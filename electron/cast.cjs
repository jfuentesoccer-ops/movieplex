// Chromecast support for the desktop app: mDNS discovery, the Cast v2 protocol
// (Default Media Receiver) and a tiny LAN HTTP server that hands subtitles to the TV.
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { Bonjour } = require('bonjour-service');
const { Client, DefaultMediaReceiver } = require('castv2-client');

const POLL_MS = 1000;
const CONNECT_TIMEOUT_MS = 15000;

function ipv4Addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/** The local address on the same subnet as the device, so the TV can reach us. */
function localAddressFor(deviceHost) {
  const all = ipv4Addresses();
  const prefix = deviceHost.split('.').slice(0, 3).join('.');
  return all.find((a) => a.startsWith(prefix + '.')) ?? all[0] ?? '127.0.0.1';
}

function contentTypeFor(url, filename) {
  const name = `${filename ?? ''} ${url}`.toLowerCase();
  if (/\.m3u8(\?|\s|$)/.test(name)) return 'application/x-mpegURL';
  if (/\.mpd(\?|\s|$)/.test(name)) return 'application/dash+xml';
  if (/\.webm(\?|\s|$)/.test(name)) return 'video/webm';
  if (/\.mkv(\?|\s|$)/.test(name)) return 'video/x-matroska';
  if (/\.mp3(\?|\s|$)/.test(name)) return 'audio/mpeg';
  return 'video/mp4';
}

class CastManager {
  /** @param {(channel: string, payload: unknown) => void} emit */
  constructor(emit) {
    this.emit = emit;
    this.devices = new Map();
    this.bonjour = null;
    this.browser = null;
    this.client = null;
    this.player = null;
    this.device = null;
    this.pollTimer = null;
    this.duration = 0;
    this.server = null;
    this.subtitle = null; // { token, vtt }
  }

  // ---------- Discovery ----------
  startDiscovery() {
    if (this.browser) {
      this.browser.update();
      return;
    }
    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: 'googlecast' });
    this.browser.on('up', (svc) => {
      const host = (svc.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? svc.referer?.address;
      if (!host) return;
      const id = svc.txt?.id || svc.fqdn || svc.name;
      this.devices.set(id, { id, name: svc.txt?.fn || svc.name, model: svc.txt?.md || '', host, port: svc.port || 8009 });
      this.emit('cast:devices', this.listDevices());
    });
    this.browser.on('down', (svc) => {
      const id = svc.txt?.id || svc.fqdn || svc.name;
      if (this.devices.delete(id)) this.emit('cast:devices', this.listDevices());
    });
  }

  listDevices() {
    return [...this.devices.values()]
      .map(({ id, name, model }) => ({ id, name, model }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- Subtitle server ----------
  async ensureServer() {
    if (this.server) return this.server.address().port;
    this.server = http.createServer((req, res) => {
      // The Default Media Receiver fetches text tracks with CORS.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
      if (req.method === 'OPTIONS') return res.end();
      const match = req.url && req.url.match(/^\/subtitles\/([a-f0-9]+)\.vtt$/);
      if (!match || !this.subtitle || match[1] !== this.subtitle.token) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.end(this.subtitle.vtt);
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '0.0.0.0', resolve);
    });
    return this.server.address().port;
  }

  // ---------- Session ----------
  /**
   * @param {{ deviceId: string, url: string, filename?: string, title?: string, subtitle?: string,
   *   poster?: string, startTime?: number, subtitleVtt?: string, subtitleLang?: string }} media
   */
  async load(media) {
    const device = this.devices.get(media.deviceId);
    if (!device) throw new Error('That device is no longer available.');
    this.disconnect(false);
    this.device = device;
    this.duration = 0;
    this.emitStatus({ state: 'connecting' });

    const local = localAddressFor(device.host);
    // Streams served from this machine (e.g. the torrent streaming server) must use a LAN address.
    const url = new URL(media.url);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) url.hostname = local;

    const info = {
      contentId: url.toString(),
      contentType: contentTypeFor(media.url, media.filename),
      streamType: 'BUFFERED',
      metadata: {
        type: 0,
        metadataType: 0,
        title: media.title ?? '',
        subtitle: media.subtitle ?? '',
        images: media.poster ? [{ url: media.poster }] : [],
      },
    };
    const options = { autoplay: true, currentTime: Math.max(0, media.startTime ?? 0) };

    if (media.subtitleVtt) {
      const port = await this.ensureServer();
      const token = crypto.randomBytes(8).toString('hex');
      this.subtitle = { token, vtt: media.subtitleVtt };
      info.tracks = [
        {
          trackId: 1,
          type: 'TEXT',
          subtype: 'SUBTITLES',
          trackContentId: `http://${local}:${port}/subtitles/${token}.vtt`,
          trackContentType: 'text/vtt',
          name: media.subtitleLang || 'Subtitles',
          language: media.subtitleLang || 'en',
        },
      ];
      info.textTrackStyle = { backgroundColor: '#00000080', foregroundColor: '#FFFFFFFF', fontScale: 1 };
      options.activeTrackIds = [1];
    }

    const client = new Client();
    this.client = client;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to the device.')), CONNECT_TIMEOUT_MS);
      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
        if (this.client === client) {
          this.emitStatus({ state: 'error', error: err.message });
          this.disconnect(false);
        }
      });
      client.connect({ host: device.host, port: device.port }, () => {
        client.launch(DefaultMediaReceiver, (err, player) => {
          if (err) return (clearTimeout(timer), reject(err));
          this.player = player;
          player.on('status', (s) => this.handleStatus(s));
          player.load(info, options, (loadErr, status) => {
            clearTimeout(timer);
            if (loadErr) return reject(new Error(`The device couldn't play this stream (${loadErr.message}).`));
            this.handleStatus(status);
            resolve();
          });
        });
      });
    }).catch((err) => {
      this.disconnect(false);
      this.emitStatus({ state: 'error', error: err.message });
      throw err;
    });

    this.pollTimer = setInterval(() => {
      this.player?.getStatus((err, status) => !err && status && this.handleStatus(status));
    }, POLL_MS);
  }

  handleStatus(status) {
    if (!status) return;
    if (status.media?.duration) this.duration = status.media.duration;
    const map = { PLAYING: 'playing', PAUSED: 'paused', BUFFERING: 'buffering' };
    let state = map[status.playerState];
    if (status.playerState === 'IDLE') {
      state = status.idleReason === 'FINISHED' ? 'ended' : status.idleReason === 'ERROR' ? 'error' : 'idle';
    }
    this.emitStatus({
      state: state ?? 'buffering',
      currentTime: status.currentTime ?? 0,
      duration: this.duration,
      error: state === 'error' ? 'The device stopped playback because of an error.' : undefined,
    });
  }

  emitStatus(partial) {
    this.emit('cast:status', {
      deviceId: this.device?.id,
      deviceName: this.device?.name,
      currentTime: 0,
      duration: this.duration,
      ...partial,
    });
  }

  control(action, value) {
    const p = this.player;
    if (!p && action !== 'stop') return;
    switch (action) {
      case 'play':
        return p.play(() => undefined);
      case 'pause':
        return p.pause(() => undefined);
      case 'seek':
        return p.seek(Math.max(0, Number(value) || 0), () => undefined);
      case 'volume':
        return this.client?.setVolume({ level: Math.min(1, Math.max(0, Number(value))) }, () => undefined);
      case 'stop':
        if (p) p.stop(() => this.disconnect(true));
        else this.disconnect(true);
    }
  }

  disconnect(notify) {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    try {
      this.client?.close();
    } catch {
      // already closed
    }
    this.client = null;
    this.player = null;
    this.subtitle = null;
    if (notify) this.emitStatus({ state: 'disconnected' });
    this.device = null;
  }

  dispose() {
    this.disconnect(false);
    this.browser?.stop();
    this.bonjour?.destroy();
    this.server?.close();
  }
}

module.exports = { CastManager };
