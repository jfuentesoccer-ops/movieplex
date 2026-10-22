import type { MetaPreview, Stream, Video } from '../addons/types';

export function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const isImdb = (id: string) => /^tt\d+$/.test(id);

/** Metahub serves artwork for IMDb ids; used as a fallback when an addon omits it. */
export function backgroundOf(meta: Pick<MetaPreview, 'id' | 'background'>) {
  if (meta.background) return meta.background;
  return isImdb(meta.id) ? `https://images.metahub.space/background/medium/${meta.id}/img` : undefined;
}

export function logoOf(meta: Pick<MetaPreview, 'id' | 'logo'>) {
  if (meta.logo) return meta.logo;
  return isImdb(meta.id) ? `https://images.metahub.space/logo/medium/${meta.id}/img` : undefined;
}

export function yearOf(meta: MetaPreview) {
  return meta.releaseInfo || meta.year || '';
}

export function genresOf(meta: MetaPreview) {
  return meta.genres ?? meta.genre ?? [];
}

export function episodeNumber(v: Video) {
  return v.episode ?? v.number ?? 0;
}

export function videoTitle(v: Video) {
  return v.title || v.name || `Episode ${episodeNumber(v)}`;
}

export function episodeLabel(v: Video) {
  if (v.season === undefined) return '';
  return `S${String(v.season).padStart(2, '0')}E${String(episodeNumber(v)).padStart(2, '0')}`;
}

/** Sorts videos by season then episode, keeping specials (season 0) last. */
export function sortVideos(videos: Video[]) {
  return [...videos].sort((a, b) => {
    const sa = a.season === 0 ? Infinity : a.season ?? 0;
    const sb = b.season === 0 ? Infinity : b.season ?? 0;
    if (sa !== sb) return sa - sb;
    const ea = episodeNumber(a);
    const eb = episodeNumber(b);
    if (ea !== eb) return ea - eb;
    return (a.released ?? '').localeCompare(b.released ?? '');
  });
}

export function nextVideo(videos: Video[] | undefined, videoId: string): Video | undefined {
  if (!videos) return undefined;
  const sorted = sortVideos(videos);
  const idx = sorted.findIndex((v) => v.id === videoId);
  return idx >= 0 ? sorted[idx + 1] : undefined;
}

// Streams are passed to the player inside the URL (as Stremio does) so a reload keeps playing.
export function encodeStream(stream: Stream) {
  const json = JSON.stringify(stream);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeStream(encoded: string): Stream | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function playerPath(stream: Stream, type: string, id: string, videoId?: string) {
  const parts = ['/player', encodeStream(stream), encodeURIComponent(type), encodeURIComponent(id)];
  if (videoId && videoId !== id) parts.push(encodeURIComponent(videoId));
  return parts.join('/');
}

export function detailPath(type: string, id: string, videoId?: string) {
  const parts = ['/detail', encodeURIComponent(type), encodeURIComponent(id)];
  if (videoId) parts.push(encodeURIComponent(videoId));
  return parts.join('/');
}

export function discoverPath(transportUrl?: string, type?: string, catalogId?: string, genre?: string) {
  if (!transportUrl || !type || !catalogId) return '/discover';
  const path = `/discover/${encodeURIComponent(transportUrl)}/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}`;
  return genre ? `${path}?genre=${encodeURIComponent(genre)}` : path;
}

/** Translates stremio:/// deep links found in meta links into in-app routes. */
export function internalLink(url: string): string | null {
  const m = url.match(/^stremio:\/\/\/?(.*)$/);
  if (!m) return null;
  return '/' + m[1].replace(/^\/+/, '');
}

export function streamKind(stream: Stream): 'url' | 'youtube' | 'torrent' | 'external' {
  if (stream.ytId) return 'youtube';
  if (stream.infoHash) return 'torrent';
  if (stream.url) return 'url';
  return 'external';
}

export function streamLines(stream: Stream) {
  const name = stream.name?.trim() || '';
  const desc = (stream.description ?? stream.title ?? '').trim();
  return { name, desc };
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
