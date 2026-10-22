import { desktop } from './desktop';

// Intro / recap / end-credits timings from IntroDB (https://introdb.app), a free community
// database keyed by IMDb id + season + episode. Its API only allows CORS from its own site, so
// the desktop app fetches through the main process and the dev server through a Vite proxy.

export type Segment = { start: number; end: number };
export type Segments = { intro?: Segment; recap?: Segment; outro?: Segment };

type ApiSegment = { start_sec: number; end_sec: number } | null;
export type IntroDbResponse = { intro?: ApiSegment; recap?: ApiSegment; outro?: ApiSegment };

export type EpisodeRef = { imdbId: string; season: number; episode: number };

const cache = new Map<string, Promise<Segments>>();

/** Cinemeta-style episode ids look like tt0903747:1:2. */
export function episodeRef(videoId: string): EpisodeRef | null {
  const m = videoId.match(/^(tt\d+):(\d+):(\d+)$/);
  if (!m || m[2] === '0') return null;
  return { imdbId: m[1], season: +m[2], episode: +m[3] };
}

function toSegment(s: ApiSegment | undefined): Segment | undefined {
  if (!s || !(s.end_sec > s.start_sec)) return undefined;
  return { start: s.start_sec, end: s.end_sec };
}

async function request(ref: EpisodeRef): Promise<IntroDbResponse | null> {
  if (desktop?.segments) return desktop.segments(ref);
  const base = import.meta.env.DEV ? '/introdb' : 'https://api.introdb.app';
  const res = await fetch(`${base}/segments?imdb_id=${ref.imdbId}&season=${ref.season}&episode=${ref.episode}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function fetchSegments(ref: EpisodeRef): Promise<Segments> {
  const key = `${ref.imdbId}:${ref.season}:${ref.episode}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = request(ref)
    .then((data) => ({ intro: toSegment(data?.intro), recap: toSegment(data?.recap), outro: toSegment(data?.outro) }))
    .catch(() => {
      cache.delete(key); // allow a retry next time
      return {};
    });
  cache.set(key, p);
  return p;
}
