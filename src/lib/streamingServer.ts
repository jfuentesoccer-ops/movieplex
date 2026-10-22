import type { Stream } from '../addons/types';

// MoviePlex talks to a Stremio-compatible streaming server (stremio-service /
// server.js) for torrent playback, the same way Stremio's web client does.

export async function checkServer(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${base.replace(/\/$/, '')}/settings`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

type CreateResponse = { guessedFileIdx?: number };

/** Registers the torrent with the server and returns a playable HTTP URL. */
export async function torrentUrl(
  base: string,
  stream: Stream,
  hint?: { season?: number; episode?: number },
): Promise<string> {
  const server = base.replace(/\/$/, '');
  const infoHash = stream.infoHash!.toLowerCase();
  let fileIdx = stream.fileIdx;
  const sources = (stream.sources ?? []).filter((s) => /^(tracker|dht):/.test(s));
  try {
    const res = await fetch(`${server}/${infoHash}/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        torrent: { infoHash },
        peerSearch: sources.length
          ? { sources: [...sources, `dht:${infoHash}`], min: 40, max: 200 }
          : undefined,
        guessFileIdx: fileIdx === undefined ? hint ?? {} : undefined,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as CreateResponse;
      if (fileIdx === undefined && typeof data.guessedFileIdx === 'number') fileIdx = data.guessedFileIdx;
    }
  } catch {
    // Older servers don't need the create call; fall through to the direct URL.
  }
  return `${server}/${infoHash}/${fileIdx ?? -1}`;
}
