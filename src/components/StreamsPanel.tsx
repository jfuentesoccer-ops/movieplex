import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AddonResult, fetchStreams, streamAddons } from '../addons/client';
import type { AddonDescriptor, MetaDetail, Stream, Video } from '../addons/types';
import { playerPath, streamKind, streamLines } from '../lib/util';
import { useAddons } from '../store/addons';
import { Empty, Spinner } from './Common';
import { Icon } from './Icon';

type Props = {
  meta: MetaDetail;
  videoId: string;
  video?: Video;
};

const META_GROUP = 'meta';

export function StreamsPanel({ meta, videoId, video }: Props) {
  const addons = useAddons((s) => s.addons);
  const navigate = useNavigate();
  const sources = useMemo(() => streamAddons(addons, meta.type, videoId), [addons, meta.type, videoId]);
  const [results, setResults] = useState<AddonResult<Stream>[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    let alive = true;
    setFilter('all');
    setResults(sources.map((addon) => ({ addon, status: 'loading', items: [] })));
    sources.forEach((addon, i) => {
      fetchStreams(addon, meta.type, videoId)
        .then((items) => {
          if (!alive) return;
          setResults((r) => r.map((x, j) => (j === i ? { ...x, status: 'ready', items } : x)));
        })
        .catch((err: Error) => {
          if (!alive) return;
          setResults((r) => r.map((x, j) => (j === i ? { ...x, status: 'error', error: err.message } : x)));
        });
    });
    return () => {
      alive = false;
    };
  }, [sources, meta.type, videoId]);

  // Metas can carry their own streams (e.g. YouTube channels).
  const embedded = video?.streams ?? [];
  const groups = useMemo(() => {
    const g: {
      key: string;
      name: string;
      status: AddonResult<Stream>['status'];
      items: Stream[];
      addon?: AddonDescriptor;
      error?: string;
    }[] = [];
    if (embedded.length) g.push({ key: META_GROUP, name: meta.name, status: 'ready', items: embedded });
    for (const r of results)
      g.push({ key: r.addon.transportUrl, name: r.addon.manifest.name, status: r.status, items: r.items, addon: r.addon, error: r.error });
    return g;
  }, [results, embedded, meta.name]);

  const loading = groups.some((g) => g.status === 'loading');
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const visible = groups.filter((g) => (filter === 'all' || g.key === filter) && g.items.length > 0);

  const open = (stream: Stream, addon?: AddonDescriptor) => {
    if (streamKind(stream) === 'external') {
      window.open(stream.externalUrl, '_blank', 'noopener');
      return;
    }
    // Remember the source so autoplay can pick the next episode from the same addon.
    navigate(playerPath({ ...stream, movieplexAddon: addon?.transportUrl }, meta.type, meta.id, videoId));
  };

  if (groups.length === 0) {
    return (
      <Empty icon="addons" title="No stream sources installed">
        MoviePlex finds streams through addons. Cinemeta provides catalogs and OpenSubtitles provides
        subtitles — install an addon that provides streams to watch content.
        <Link to="/addons/community" className="btn primary">
          Browse addons
        </Link>
      </Empty>
    );
  }

  return (
    <div className="streams">
      <div className="chips">
        <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All {total > 0 && <span className="count">{total}</span>}
        </button>
        {groups.map((g) => (
          <button
            key={g.key}
            className={`chip ${filter === g.key ? 'active' : ''} ${g.status === 'error' ? 'errored' : ''}`}
            onClick={() => setFilter(g.key)}
            title={g.error}
          >
            {g.name}
            {g.status === 'loading' ? <Spinner size={12} /> : <span className="count">{g.items.length}</span>}
          </button>
        ))}
      </div>

      {visible.map((g) => (
        <div key={g.key} className="stream-group">
          {filter === 'all' && <div className="stream-group-title">{g.name}</div>}
          {g.items.map((s, i) => {
            const { name, desc } = streamLines(s);
            const kind = streamKind(s);
            return (
              <button key={i} className="stream" onClick={() => open(s, g.addon)}>
                <div className="stream-name">{name || g.name}</div>
                <div className="stream-desc">{desc || (kind === 'youtube' ? 'YouTube' : kind === 'torrent' ? 'Torrent' : s.url)}</div>
                <div className="stream-kind" title={kind}>
                  <Icon
                    name={kind === 'torrent' ? 'magnet' : kind === 'external' ? 'external' : kind === 'youtube' ? 'trailer' : 'play'}
                    size={18}
                  />
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {loading && total === 0 && (
        <div className="stream-loading">
          <Spinner /> <span>Searching {sources.length} addon{sources.length === 1 ? '' : 's'} for streams…</span>
        </div>
      )}
      {!loading && total === 0 && (
        <Empty title="No streams found">
          None of your stream addons returned results for this {video ? 'episode' : 'title'}.
        </Empty>
      )}
      {!loading && filter !== 'all' && visible.length === 0 && total > 0 && (
        <p className="muted small center">This addon returned no streams.</p>
      )}
    </div>
  );
}
