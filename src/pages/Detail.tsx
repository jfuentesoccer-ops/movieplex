import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fetchMeta } from '../addons/client';
import type { MetaDetail, Video } from '../addons/types';
import { Empty, Select, Spinner, YouTubeModal } from '../components/Common';
import { Icon } from '../components/Icon';
import { StreamsPanel } from '../components/StreamsPanel';
import {
  backgroundOf,
  copyText,
  detailPath,
  episodeLabel,
  episodeNumber,
  formatDate,
  genresOf,
  internalLink,
  logoOf,
  sortVideos,
  videoTitle,
  yearOf,
} from '../lib/util';
import { useAddons } from '../store/addons';
import { LibraryItem, useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

export default function Detail() {
  const { type = '', id = '', videoId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const addons = useAddons((s) => s.addons);
  const libItem = useLibrary((s) => s.items[id]) as LibraryItem | undefined;
  const toggleLibrary = useLibrary((s) => s.toggle);
  const setWatched = useLibrary((s) => s.setWatched);

  const [meta, setMeta] = useState<MetaDetail | null>(null);
  const [addonName, setAddonName] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [trailer, setTrailer] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setMeta(null);
    setLogoFailed(false);
    fetchMeta(addons, type, id).then((res) => {
      if (!alive) return;
      if (!res) return setStatus('missing');
      setMeta({ ...res.meta, type: res.meta.type || type });
      setAddonName(res.addon.manifest.name);
      setStatus('ready');
    });
    return () => {
      alive = false;
    };
  }, [addons, type, id]);

  const videos = useMemo(() => sortVideos(meta?.videos ?? []), [meta]);
  const hasEpisodes = videos.length > 0;
  const watched = libItem?.state.watched ?? [];

  /** The episode to play next: in-progress one, else the one after the last watched. */
  const nextUp: Video | undefined = useMemo(() => {
    if (!hasEpisodes) return undefined;
    const regular = videos.filter((v) => v.season !== 0);
    const list = regular.length ? regular : videos;
    const current = libItem?.state.videoId;
    if (current && libItem?.state.timeOffset) {
      const v = list.find((x) => x.id === current);
      if (v) return v;
    }
    let lastIdx = -1;
    list.forEach((v, i) => watched.includes(v.id) && (lastIdx = i));
    return list[lastIdx + 1] ?? list[0];
  }, [videos, hasEpisodes, libItem, watched]);

  // "Watch now" from the board on a series jumps straight to the next episode's streams.
  useEffect(() => {
    if (search.get('streams') && hasEpisodes && !videoId && nextUp) {
      navigate(detailPath(type, id, nextUp.id), { replace: true });
    }
  }, [search, hasEpisodes, videoId, nextUp, navigate, type, id]);

  if (status === 'loading') {
    return (
      <div className="page detail-loading">
        <Spinner size={40} />
      </div>
    );
  }

  if (status === 'missing' || !meta) {
    return (
      <div className="page">
        <Empty title="Couldn't find this title">
          None of your installed addons provide details for <code>{id}</code>.
          <button className="btn" onClick={() => navigate(-1)}>
            Go back
          </button>
        </Empty>
      </div>
    );
  }

  const selectedVideo = videoId ? videos.find((v) => v.id === videoId) : undefined;
  const streamVideoId = hasEpisodes ? videoId : meta.behaviorHints?.defaultVideoId || meta.id;
  const ytTrailer = meta.trailerStreams?.[0]?.ytId;
  const inLibrary = !!libItem?.inLibrary;
  const movieWatched = watched.includes(meta.id);
  const logo = logoOf(meta);
  const background = backgroundOf(meta) ?? meta.poster;
  const resumeLabel =
    nextUp && libItem?.state.videoId === nextUp.id && libItem.state.timeOffset > 0 ? 'Resume' : 'Watch';

  const share = async () => {
    const url = window.location.origin + window.location.pathname + '#' + detailPath(type, id);
    toast((await copyText(url)) ? 'Link copied to clipboard' : 'Could not copy link', 'success');
  };

  const peopleLinks = (label: string, names?: string[] | null) =>
    names && names.length > 0 ? (
      <div className="people">
        <span className="people-label">{label}</span>
        <div className="people-list">
          {names.slice(0, 12).map((n) => (
            <Link key={n} to={`/search?q=${encodeURIComponent(n)}`} className="chip-lite link">
              {n}
            </Link>
          ))}
        </div>
      </div>
    ) : null;

  const genreLinks = (meta.links ?? []).filter((l) => l.category === 'Genres');

  return (
    <div className="page detail">
      <div className="detail-bg" style={{ backgroundImage: background ? `url("${background}")` : undefined }} />
      <div className="detail-shade" />

      <div className="detail-layout">
        <div className="detail-info">
          <button className="btn glass small back-btn" onClick={() => navigate(-1)}>
            <Icon name="back" size={16} /> Back
          </button>

          {logo && !logoFailed ? (
            <img className="detail-logo" src={logo} alt={meta.name} onError={() => setLogoFailed(true)} />
          ) : (
            <h1 className="detail-title">{meta.name}</h1>
          )}

          <div className="meta-line">
            {meta.imdbRating && (
              <a
                className="imdb"
                href={`https://www.imdb.com/title/${meta.id.split(':')[0]}`}
                target="_blank"
                rel="noreferrer"
              >
                <b>IMDb</b> {meta.imdbRating}
              </a>
            )}
            {yearOf(meta) && <span>{yearOf(meta)}</span>}
            {meta.runtime && <span>{meta.runtime}</span>}
            {meta.status && hasEpisodes && <span>{meta.status}</span>}
          </div>

          <div className="genre-chips">
            {genreLinks.length > 0
              ? genreLinks.map((l) => {
                  const internal = internalLink(l.url);
                  return internal ? (
                    <Link key={l.name} to={internal} className="chip-lite link">
                      {l.name}
                    </Link>
                  ) : (
                    <span key={l.name} className="chip-lite">
                      {l.name}
                    </span>
                  );
                })
              : genresOf(meta).map((g) => (
                  <span key={g} className="chip-lite">
                    {g}
                  </span>
                ))}
          </div>

          {meta.description && <p className="detail-desc">{meta.description}</p>}

          <div className="detail-actions">
            {hasEpisodes && nextUp ? (
              <Link to={detailPath(type, id, nextUp.id)} replace className="btn primary">
                <Icon name="play" /> {resumeLabel} {episodeLabel(nextUp)}
              </Link>
            ) : (
              <a href="#streams" className="btn primary mobile-only" onClick={(e) => {
                e.preventDefault();
                document.getElementById('streams')?.scrollIntoView({ behavior: 'smooth' });
              }}>
                <Icon name="play" /> Watch
              </a>
            )}
            {ytTrailer && (
              <button className="btn glass" onClick={() => setTrailer(ytTrailer)}>
                <Icon name="trailer" /> Trailer
              </button>
            )}
            <button className="btn glass" onClick={() => toggleLibrary(meta)}>
              <Icon name={inLibrary ? 'check' : 'plus'} /> {inLibrary ? 'In Library' : 'Library'}
            </button>
            {!hasEpisodes && (
              <button
                className="icon-btn glass round"
                title={movieWatched ? 'Mark as unwatched' : 'Mark as watched'}
                onClick={() => setWatched(meta, meta.id, !movieWatched)}
              >
                <Icon name={movieWatched ? 'eye' : 'check'} />
              </button>
            )}
            <button className="icon-btn glass round" title="Share" onClick={share}>
              <Icon name="share" />
            </button>
          </div>

          <div className="detail-people">
            {peopleLinks('Cast', meta.cast)}
            {peopleLinks('Director', meta.director)}
            {peopleLinks('Writer', meta.writer)}
          </div>

          {(meta.awards || meta.country || meta.released) && (
            <dl className="facts">
              {meta.released && !hasEpisodes && (
                <>
                  <dt>Released</dt>
                  <dd>{formatDate(meta.released)}</dd>
                </>
              )}
              {meta.country && (
                <>
                  <dt>Country</dt>
                  <dd>{meta.country}</dd>
                </>
              )}
              {meta.awards && (
                <>
                  <dt>Awards</dt>
                  <dd>{meta.awards}</dd>
                </>
              )}
            </dl>
          )}
          <p className="muted small">Details from {addonName}</p>
        </div>

        <aside className="detail-panel" id="streams">
          {hasEpisodes && !videoId && (
            <EpisodeList
              meta={meta}
              videos={videos}
              item={libItem}
              current={nextUp}
              onSelect={(v) => navigate(detailPath(type, id, v.id), { replace: true })}
            />
          )}
          {streamVideoId && (
            <>
              {hasEpisodes && (
                <div className="panel-head">
                  <button
                    className="icon-btn ghost"
                    onClick={() => navigate(detailPath(type, id) + location.search.replace(/streams=1&?/, ''), { replace: true })}
                    aria-label="Back to episodes"
                  >
                    <Icon name="back" />
                  </button>
                  <div className="panel-title">
                    <div className="muted small">{selectedVideo ? episodeLabel(selectedVideo) : ''}</div>
                    <div className="strong">{selectedVideo ? videoTitle(selectedVideo) : videoId}</div>
                  </div>
                </div>
              )}
              {!hasEpisodes && <h3 className="panel-heading">Streams</h3>}
              <StreamsPanel meta={meta} videoId={streamVideoId} video={selectedVideo} />
            </>
          )}
        </aside>
      </div>

      {trailer && <YouTubeModal ytId={trailer} title={`${meta.name} — Trailer`} onClose={() => setTrailer(null)} />}
    </div>
  );
}

function EpisodeList({
  meta,
  videos,
  item,
  current,
  onSelect,
}: {
  meta: MetaDetail;
  videos: Video[];
  item?: LibraryItem;
  current?: Video;
  onSelect: (v: Video) => void;
}) {
  const hideSpoilers = useSettings((s) => s.hideSpoilers);
  const setWatched = useLibrary((s) => s.setWatched);
  const watched = item?.state.watched ?? [];
  const hasSeasons = videos.some((v) => v.season !== undefined);
  const seasons = useMemo(() => {
    const s = [...new Set(videos.map((v) => v.season ?? 0))];
    return s.sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  }, [videos]);
  const [season, setSeason] = useState<number>(() => current?.season ?? seasons.find((s) => s > 0) ?? seasons[0] ?? 0);
  const [query, setQuery] = useState('');
  const now = Date.now();

  const list = useMemo(() => {
    let l = hasSeasons ? videos.filter((v) => (v.season ?? 0) === season) : [...videos].reverse();
    if (query) {
      const q = query.toLowerCase();
      l = videos.filter((v) => videoTitle(v).toLowerCase().includes(q));
    }
    return l;
  }, [videos, season, hasSeasons, query]);

  const seasonWatched = list.length > 0 && list.every((v) => watched.includes(v.id));

  return (
    <div className="episodes">
      <div className="episodes-head">
        {hasSeasons && seasons.length > 0 && (
          <Select
            value={String(season)}
            onChange={(v) => setSeason(+v)}
            options={seasons.map((s) => ({ value: String(s), label: s === 0 ? 'Specials' : `Season ${s}` }))}
          />
        )}
        <input
          className="input small"
          placeholder="Search episodes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hasSeasons && (
          <button
            className="icon-btn ghost"
            title={seasonWatched ? 'Mark season unwatched' : 'Mark season watched'}
            onClick={() => list.forEach((v) => setWatched(meta, v.id, !seasonWatched))}
          >
            <Icon name={seasonWatched ? 'eye' : 'check'} />
          </button>
        )}
      </div>

      <div className="episode-list">
        {list.map((v) => {
          const isWatched = watched.includes(v.id);
          const upcoming = v.released ? new Date(v.released).getTime() > now : false;
          const inProgress = item?.state.videoId === v.id && item.state.timeOffset > 0 && item.state.duration > 0;
          const blur = hideSpoilers && !isWatched;
          return (
            <div
              key={v.id}
              className={`episode ${upcoming ? 'upcoming' : ''} ${current?.id === v.id ? 'current' : ''}`}
              onClick={() => onSelect(v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(v)}
            >
              <div className={`episode-thumb ${blur ? 'spoiler' : ''}`}>
                {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" /> : <div className="thumb-fallback" />}
                {inProgress && (
                  <div className="progress">
                    <div style={{ width: `${(item!.state.timeOffset / item!.state.duration) * 100}%` }} />
                  </div>
                )}
                {isWatched && (
                  <span className="watched-badge">
                    <Icon name="check" size={12} />
                  </span>
                )}
              </div>
              <div className="episode-body">
                <div className="episode-title">
                  {hasSeasons && <span className="ep-num">{episodeNumber(v)}.</span>} {videoTitle(v)}
                </div>
                <div className="muted small">
                  {upcoming ? 'Upcoming · ' : ''}
                  {formatDate(v.released)}
                </div>
                {(v.overview || v.description) && !blur && (
                  <p className="episode-overview">{v.overview || v.description}</p>
                )}
              </div>
              <button
                className="icon-btn ghost episode-watch"
                title={isWatched ? 'Mark unwatched' : 'Mark watched'}
                onClick={(e) => {
                  e.stopPropagation();
                  setWatched(meta, v.id, !isWatched);
                }}
              >
                <Icon name={isWatched ? 'eye' : 'check'} size={18} />
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted center pad">No episodes.</p>}
      </div>
    </div>
  );
}
