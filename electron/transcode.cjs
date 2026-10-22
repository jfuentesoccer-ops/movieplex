// Audio conversion for streams whose audio the built-in player can't decode (Dolby Digital,
// Dolby Digital Plus, DTS, TrueHD). ffmpeg copies the video untouched, converts the chosen
// audio track to stereo AAC, and streams fragmented MP4 to the player over a loopback server.
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

/** Audio codecs Chromium can't play (names as ffmpeg reports them). */
const UNSUPPORTED_AUDIO = new Set(['ac3', 'eac3', 'dts', 'truehd', 'mlp']);
// Network inputs only: addons supply these URLs, so ffmpeg must never read local files.
const PROTOCOLS = ['-protocol_whitelist', 'http,https,tls,tcp,crypto'];
const PROBE_TIMEOUT_MS = 20000;
const RESOLVE_TIMEOUT_MS = 20000;
// The start of the file, read while resolving the link. In MKV (most debrid streams) it holds the
// track list, so the audio codecs are known without waiting for the ffmpeg check.
const SNIFF_BYTES = 128 * 1024;
const SNIFF_TIMEOUT_MS = 1500;

// Seeking: video is copied, so it can only start on a keyframe. "-noaccurate_seek" makes the audio
// start from the same point instead of being trimmed to the exact request (which put audio seconds
// out of sync), and "-copyts -start_at_zero" keeps the file's own timestamps.
const seekArgs = (start) => (start > 0 ? ['-ss', start.toFixed(3), '-noaccurate_seek'] : []);
const TIMESTAMP_ARGS = ['-copyts', '-start_at_zero'];

function ffmpegPath() {
  // Packaged builds unpack the binary next to app.asar (see build.asarUnpack in package.json).
  return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
}

const isNetworkUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

function headerArgs(headers) {
  const entries = Object.entries(headers ?? {}).filter(([k, v]) => /^[\w-]+$/.test(k) && typeof v === 'string' && !/[\r\n]/.test(v));
  return entries.length ? ['-headers', entries.map(([k, v]) => `${k}: ${v}\r\n`).join('')] : [];
}

/** Reads duration and stream layout from ffmpeg's input summary. */
function parseProbe(text) {
  const d = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  let videoCodec = null;
  const audio = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/Stream #0:\d+(?:\[[^\]]+\])?(?:\(([^)]+)\))?: (Video|Audio): ([\w-]+)(.*)$/);
    if (!m) continue;
    const [, language, kind, codec, rest] = m;
    if (kind === 'Video' && !videoCodec && !/attached pic/.test(rest)) videoCodec = codec;
    if (kind !== 'Audio') continue;
    // A "title : ..." metadata line may follow (e.g. "Commentary").
    let title = '';
    for (let j = i + 1; j < Math.min(i + 6, lines.length) && !/Stream #/.test(lines[j]); j++) {
      const t = lines[j].match(/^\s+title\s+:\s+(.+)$/);
      if (t) title = t[1].trim();
    }
    audio.push({
      index: audio.length,
      codec,
      language: language && language !== 'und' ? language : '',
      channels: (rest.match(/Hz, ([^,]+),/) ?? [])[1] ?? '',
      title,
      isDefault: /\(default\)/.test(rest),
      supported: !UNSUPPORTED_AUDIO.has(codec),
    });
  }
  return { duration, videoCodec, audio };
}

function probe(url, headers) {
  return new Promise((resolve) => {
    // Codecs and duration come from the container header, so a small read is enough.
    const proc = spawn(ffmpegPath(), [
      '-hide_banner', '-nostdin', ...PROTOCOLS, '-probesize', '1000000', '-analyzeduration', '0',
      ...headerArgs(headers), '-i', url,
    ]);
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), PROBE_TIMEOUT_MS);
    proc.stderr.on('data', (c) => (err += c));
    proc.on('error', () => resolve(null));
    // ffmpeg exits non-zero here ("no output file"), but has printed the input summary.
    proc.on('close', () => {
      clearTimeout(timer);
      const info = parseProbe(err);
      resolve(info.duration || info.audio.length ? info : null);
    });
  });
}

// ---------- Matroska track list ----------
// EBML elements: an ID (1-4 bytes, length marker kept) then a size (1-8 bytes, marker removed).
const EBML_HEADER = 0x1a45dfa3;
const MKV_SEGMENT = 0x18538067;
const MKV_TRACKS = 0x1654ae6b;
const MKV_CLUSTER = 0x1f43b675;
const MKV_TRACK_ENTRY = 0xae;
const MKV_TRACK_TYPE = 0x83;
const MKV_CODEC_ID = 0x86;
const MKV_FLAG_DEFAULT = 0x88;
const MKV_LANGUAGE = 0x22b59c;
const MKV_LANGUAGE_BCP47 = 0x22b59d;

function readElement(buf, i) {
  const first = buf[i];
  const idLen = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
  if (!idLen || i + idLen >= buf.length) return null;
  let id = 0;
  for (let k = 0; k < idLen; k++) id = id * 256 + buf[i + k];
  const at = i + idLen;
  let sizeLen = 1;
  let mask = 0x80;
  while (sizeLen <= 8 && !(buf[at] & mask)) {
    sizeLen++;
    mask >>= 1;
  }
  if (sizeLen > 8 || at + sizeLen > buf.length) return null;
  let size = buf[at] & (mask - 1);
  let unknown = size === mask - 1;
  for (let k = 1; k < sizeLen; k++) {
    size = size * 256 + buf[at + k];
    unknown = unknown && buf[at + k] === 0xff;
  }
  return { id, start: at + sizeLen, size: unknown ? -1 : size };
}

const readUint = (buf, start, size) => {
  let v = 0;
  for (let k = 0; k < size; k++) v = v * 256 + buf[start + k];
  return v;
};

const readString = (buf, start, size) => buf.toString('latin1', start, start + size).replace(/\0+$/, '');

const MKV_AUDIO_CODECS = [
  ['A_EAC3', 'eac3'],
  ['A_AC3', 'ac3'],
  ['A_DTS', 'dts'],
  ['A_TRUEHD', 'truehd'],
  ['A_MLP', 'mlp'],
  ['A_AAC', 'aac'],
  ['A_OPUS', 'opus'],
  ['A_VORBIS', 'vorbis'],
  ['A_FLAC', 'flac'],
  ['A_MPEG/L3', 'mp3'],
];

/**
 * The audio tracks of an MKV/WebM file, in ffmpeg's order, read from the start of the file.
 * Null when it isn't Matroska or the track list isn't complete within `buf` (ffmpeg checks then).
 */
function sniffAudio(buf) {
  if (!buf?.length) return null;
  const header = readElement(buf, 0);
  if (!header || header.id !== EBML_HEADER || header.size < 0) return null;
  const segment = readElement(buf, header.start + header.size);
  if (!segment || segment.id !== MKV_SEGMENT) return null;
  let i = segment.start;
  for (;;) {
    const el = readElement(buf, i);
    if (!el || el.size < 0 || el.id === MKV_CLUSTER) return null;
    if (el.id === MKV_TRACKS) {
      if (el.start + el.size > buf.length) return null;
      const audio = [];
      for (let t = el.start; t < el.start + el.size; ) {
        const entry = readElement(buf, t);
        if (!entry || entry.size < 0) return null;
        if (entry.id === MKV_TRACK_ENTRY) {
          let type = 0;
          let codecId = '';
          let isDefault = true; // FlagDefault defaults to 1
          let language = 'eng'; // Language defaults to English
          let bcp47 = '';
          for (let f = entry.start; f < entry.start + entry.size; ) {
            const field = readElement(buf, f);
            if (!field || field.size < 0) return null;
            if (field.id === MKV_TRACK_TYPE) type = readUint(buf, field.start, field.size);
            else if (field.id === MKV_CODEC_ID) codecId = readString(buf, field.start, field.size);
            else if (field.id === MKV_FLAG_DEFAULT) isDefault = readUint(buf, field.start, field.size) !== 0;
            else if (field.id === MKV_LANGUAGE) language = readString(buf, field.start, field.size);
            else if (field.id === MKV_LANGUAGE_BCP47) bcp47 = readString(buf, field.start, field.size);
            f = field.start + field.size;
          }
          if (type === 2) {
            const known = MKV_AUDIO_CODECS.find(([prefix]) => codecId.startsWith(prefix));
            const codec = known ? known[1] : codecId.replace(/^A_/, '').toLowerCase();
            const lang = bcp47 || language;
            audio.push({
              index: audio.length,
              codec,
              language: lang && lang !== 'und' ? lang : '',
              isDefault,
              supported: !UNSUPPORTED_AUDIO.has(codec),
            });
          }
        }
        t = entry.start + entry.size;
      }
      return audio.length ? audio : null;
    }
    i = el.start + el.size;
    if (i >= buf.length) return null;
  }
}

/** Reads up to `limit` bytes of a response body, giving up (null) after `ms`. */
async function readHead(res, limit, ms) {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  const timer = setTimeout(() => reader.cancel().catch(() => {}), ms);
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    return Buffer.concat(chunks).subarray(0, limit);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
}

/**
 * Follows a link's redirects once and returns the final address plus the audio tracks when the
 * start of the file shows them. Debrid links from addons like Torrentio go through a slow first
 * hop (the addon asks the debrid service for the file, then redirects); resolving once means the
 * player, the audio check, the conversion and every seek skip it.
 */
async function resolveFinalUrl(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { ...(headers ?? {}), Range: `bytes=0-${SNIFF_BYTES - 1}` },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok || !isNetworkUrl(res.url)) {
      res.body?.cancel().catch(() => {});
      return { url, audio: null };
    }
    const head = await readHead(res, SNIFF_BYTES, SNIFF_TIMEOUT_MS);
    let audio = null;
    try {
      audio = sniffAudio(head);
    } catch {
      // unreadable header: the ffmpeg check decides
    }
    return { url: res.url, audio };
  } catch {
    return { url, audio: null };
  } finally {
    clearTimeout(timer);
  }
}

class Transcoder {
  constructor() {
    this.sessions = new Map(); // token -> { url, headers, videoCodec }
    this.tokens = new Map(); // url -> token, so each stream keeps one conversion link
    this.probes = new Map(); // url -> prepare() result, so reopening a stream skips the check
    this.resolved = new Map(); // url -> Promise<{ url: final url, audio: tracks | null }>
    this.procs = new Set();
    this.server = null;
  }

  async ensureServer() {
    if (this.server) return this.server.address().port;
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve); // loopback only
    });
    return this.server.address().port;
  }

  /** The stream's final address after redirects (resolved once per link, then cached). */
  resolve(url, headers) {
    return this.inspect(url, headers).then((r) => r.url);
  }

  /** The final address plus the audio tracks, when the start of the file lists them. */
  inspect(url, headers) {
    if (!isNetworkUrl(url)) return Promise.resolve({ url, audio: null });
    let pending = this.resolved.get(url);
    if (!pending) {
      pending = resolveFinalUrl(url, headers).then((result) => {
        this.resolved.set(result.url, Promise.resolve(result)); // the final address needs no lookup
        return result;
      });
      this.resolved.set(url, pending);
    }
    return pending;
  }

  /**
   * A conversion link for the stream, created without touching the network so conversion can
   * start immediately (the audio check runs alongside via prepare()).
   */
  async open(url, headers) {
    if (!isNetworkUrl(url)) return null;
    let token = this.tokens.get(url);
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      this.tokens.set(url, token);
      this.sessions.set(token, { url, headers, videoCodec: null });
    }
    const port = await this.ensureServer();
    return { base: `http://127.0.0.1:${port}/t/${token}` };
  }

  /** Probes the stream and returns its audio tracks plus the conversion link for the player. */
  async prepare(url, headers) {
    if (!isNetworkUrl(url)) return null;
    const cached = this.probes.get(url);
    if (cached) return cached;
    const [info, link] = await Promise.all([
      this.resolve(url, headers).then((final) => probe(final, headers)),
      this.open(url, headers),
    ]);
    if (!info || !link) return null;
    this.sessions.get(link.base.split('/t/')[1]).videoCodec = info.videoCodec;
    const result = { ...info, base: link.base };
    this.probes.set(url, result);
    return result;
  }

  /**
   * Where converted playback requested at `start` actually begins (the keyframe at or before it).
   * The player's clock counts from there, so it needs this to show the right time.
   */
  startPoint(base, start, audio) {
    const session = this.sessions.get(String(base).split('/t/')[1] ?? '');
    const at = Math.max(0, Number(Number(start || 0).toFixed(3)));
    if (!session || at <= 0) return Promise.resolve(0);
    const track = Math.max(0, Math.floor(Number(audio) || 0));
    return this.resolve(session.url, session.headers).then((input) => new Promise((resolve) => {
      // Same seek as playback, but only lists the first packets' timestamps.
      const proc = spawn(ffmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-nostdin', ...PROTOCOLS, ...seekArgs(at), '-t', '1',
        ...headerArgs(session.headers), '-i', input,
        '-map', '0:v:0?', '-map', `0:a:${track}?`, '-c', 'copy', ...TIMESTAMP_ARGS, '-f', 'framecrc', 'pipe:1',
      ]);
      let out = '';
      const timer = setTimeout(() => proc.kill('SIGKILL'), PROBE_TIMEOUT_MS);
      proc.stdout.on('data', (c) => (out += c));
      proc.on('error', () => resolve(at));
      proc.on('close', () => {
        clearTimeout(timer);
        const timebase = {};
        let earliest = Infinity;
        for (const line of out.split('\n')) {
          const tb = line.match(/^#tb (\d+): (\d+)\/(\d+)/);
          if (tb) timebase[tb[1]] = +tb[2] / +tb[3];
          const pkt = line.match(/^(\d+),\s*-?\d+,\s*(-?\d+),/);
          if (pkt && timebase[pkt[1]]) earliest = Math.min(earliest, +pkt[2] * timebase[pkt[1]]);
        }
        resolve(isFinite(earliest) ? Math.max(0, earliest) : at);
      });
    }));
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const session = this.sessions.get(url.pathname.replace(/^\/t\//, ''));
    if (!session) {
      res.writeHead(404);
      return res.end();
    }
    const start = Math.max(0, Number(Number(url.searchParams.get('start') || 0).toFixed(3)));
    const audio = Math.max(0, Math.floor(Number(url.searchParams.get('audio')) || 0));
    let closed = false;
    req.on('close', () => (closed = true));
    const input = await this.resolve(session.url, session.headers);
    if (closed) return; // the player moved on (seeked again or left) while the link resolved
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', ...PROTOCOLS,
      ...seekArgs(start),
      ...headerArgs(session.headers),
      '-i', input,
      '-map', '0:v:0?', '-map', `0:a:${audio}?`,
      '-c:v', 'copy',
      // macOS prefers the hvc1 tag for HEVC (Chromium also plays the default hev1 when the codec
      // isn't known yet because conversion started before the audio check finished).
      ...(session.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
      '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
      ...TIMESTAMP_ARGS,
      // Small fragments so playback can start within ~0.5 s instead of waiting for a whole
      // keyframe interval (often several seconds of video) to download.
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '500000',
      'pipe:1',
    ];
    const proc = spawn(ffmpegPath(), args);
    this.procs.add(proc);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    proc.stdout.pipe(res);
    proc.stderr.on('data', (c) => console.warn('[transcode]', String(c).trim()));
    const stop = () => {
      proc.kill('SIGKILL');
      this.procs.delete(proc);
    };
    // The player closes the request when it seeks (a new request starts at the new position).
    req.on('close', stop);
    proc.on('close', () => {
      this.procs.delete(proc);
      res.end();
    });
  }

  dispose() {
    for (const p of this.procs) p.kill('SIGKILL');
    this.procs.clear();
    this.server?.close();
  }
}

module.exports = { Transcoder, parseProbe, sniffAudio };
