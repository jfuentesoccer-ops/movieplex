export type Cue = { start: number; end: number; text: string };

function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!m) return NaN;
  const [, h = '0', mm, ss, ms] = m;
  return +h * 3600 + +mm * 60 + +ss + +ms.padEnd(3, '0') / 1000;
}

/** Returns HTML-safe text: everything escaped except plain <i>, <b> and <u> tags. */
function cleanText(text: string) {
  return text
    .replace(/\{\\[^}]*\}/g, '') // SSA override tags that sometimes leak into SRT
    .replace(/<[^>]*>/g, (tag) => (/^<\/?[ibu]>$/i.test(tag) ? tag.toLowerCase() : ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?[ibu])&gt;/g, '<$1>')
    .trim();
}

/** Parses SRT or WebVTT into cues. */
export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    if (isNaN(start) || isNaN(end)) continue;
    const body = cleanText(lines.slice(timeIdx + 1).join('\n'));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Returns all cues active at `time` (cues may overlap). */
export function activeCues(cues: Cue[], time: number): Cue[] {
  // Binary search for the last cue starting before `time`, then scan back over overlaps.
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: Cue[] = [];
  for (let i = idx; i >= 0 && i > idx - 10; i--) {
    if (cues[i].end > time) out.unshift(cues[i]);
  }
  return out;
}

export async function loadSubtitles(url: string, proxyBase?: string): Promise<Cue[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseSubtitles(await res.text());
  } catch (err) {
    // Fall back to the streaming server's subtitle proxy when CORS blocks direct access.
    if (!proxyBase) throw err;
    const res = await fetch(`${proxyBase}/subtitles.vtt?from=${encodeURIComponent(url)}`);
    if (!res.ok) throw err;
    return parseSubtitles(await res.text());
  }
}

function vttTime(t: number) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
}

/** Serialises cues (with the user's delay applied) as WebVTT for cast receivers. */
export function cuesToVtt(cues: Cue[], delay = 0): string {
  const body = cues
    .map((c) => `${vttTime(c.start + delay)} --> ${vttTime(c.end + delay)}\n${c.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
