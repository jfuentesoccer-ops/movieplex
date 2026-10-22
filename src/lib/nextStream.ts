import { fetchStreams, streamAddons } from '../addons/client';
import type { AddonDescriptor, Stream } from '../addons/types';
import { streamKind } from './util';

// Picks a stream for the next episode so autoplay can keep going without the stream list:
//  1. the stream in the same "binge group" (the addon says it continues this one), else
//  2. from the same addon, the stream with the same quality (e.g. 1080p), else
//  3. the same addon's first stream, else
//  4. the first stream any addon offers.

const QUALITY = /\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p|360p)\b/i;
const quality = (s: Stream) => `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`.match(QUALITY)?.[1]?.toLowerCase();
const playable = (s: Stream) => streamKind(s) !== 'external';

export async function findNextStream(
  addons: AddonDescriptor[],
  type: string,
  nextVideoId: string,
  current: Stream | null,
): Promise<Stream | null> {
  const sources = streamAddons(addons, type, nextVideoId);
  const origin = sources.find((a) => a.transportUrl === current?.movieplexAddon);
  // The source of the current stream first, so its streams win ties.
  const ordered = origin ? [origin, ...sources.filter((a) => a !== origin)] : sources;
  const results = await Promise.all(
    ordered.map(async (addon) => ({
      addon,
      streams: await fetchStreams(addon, type, nextVideoId)
        .then((list) => list.filter(playable))
        .catch(() => [] as Stream[]),
    })),
  );
  const tag = (s: Stream, addon: AddonDescriptor): Stream => ({ ...s, movieplexAddon: addon.transportUrl });

  const bingeGroup = current?.behaviorHints?.bingeGroup;
  if (bingeGroup) {
    for (const { addon, streams } of results) {
      const match = streams.find((s) => s.behaviorHints?.bingeGroup === bingeGroup);
      if (match) return tag(match, addon);
    }
  }

  const fromOrigin = origin && results[0];
  if (fromOrigin && fromOrigin.streams.length) {
    const wanted = current && quality(current);
    const sameQuality = wanted ? fromOrigin.streams.find((s) => quality(s) === wanted) : undefined;
    return tag(sameQuality ?? fromOrigin.streams[0], fromOrigin.addon);
  }

  for (const { addon, streams } of results) if (streams.length) return tag(streams[0], addon);
  return null;
}
