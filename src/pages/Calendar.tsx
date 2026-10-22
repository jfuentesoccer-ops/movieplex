import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resourceUrl } from '../addons/client';
import type { MetaDetail, Video } from '../addons/types';
import { Empty, Spinner } from '../components/Common';
import { Icon } from '../components/Icon';
import { detailPath, episodeLabel, videoTitle } from '../lib/util';
import { useAddons } from '../store/addons';
import { useLibrary } from '../store/library';

type Entry = { meta: MetaDetail; video: Video; date: Date };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function Calendar() {
  const addons = useAddons((s) => s.addons);
  const items = useLibrary((s) => s.items);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);

  const seriesIds = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.inLibrary && i.type === 'series')
        .map((i) => i.id)
        .sort(),
    [items],
  );

  // Cinemeta exposes a `calendar-videos` catalog that takes the series ids as an extra.
  const provider = useMemo(() => {
    for (const addon of addons) {
      const cat = addon.manifest.catalogs.find((c) =>
        c.extra?.some((e) => e.name === 'calendarVideosIds'),
      );
      if (cat) return { addon, cat };
    }
    return null;
  }, [addons]);

  useEffect(() => {
    if (!provider || seriesIds.length === 0) {
      setEntries([]);
      return;
    }
    let alive = true;
    setEntries(null);
    setError(false);
    const url = resourceUrl(provider.addon.transportUrl, 'catalog', provider.cat.type, provider.cat.id, {
      calendarVideosIds: seriesIds.join(','),
    });
    fetch(url)
      .then((r) => r.json())
      .then((data: { metasDetailed?: MetaDetail[]; metas?: MetaDetail[] }) => {
        if (!alive) return;
        const out: Entry[] = [];
        for (const meta of data.metasDetailed ?? data.metas ?? []) {
          for (const video of meta.videos ?? []) {
            if (!video.released) continue;
            const date = new Date(video.released);
            if (!isNaN(date.getTime())) out.push({ meta, video, date });
          }
        }
        setEntries(out);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [provider, seriesIds]);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries ?? []) {
      const k = dayKey(e.date);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [entries]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const monthEntries = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.date.getMonth() === month.getMonth() && e.date.getFullYear() === month.getFullYear())
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [entries, month],
  );

  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const today = dayKey(new Date());

  if (seriesIds.length === 0) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Calendar</h1>
        </div>
        <Empty icon="calendar" title="No series in your library">
          Add series to your library to see when new episodes air.
          <Link to="/discover" className="btn primary">
            Find series
          </Link>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page calendar">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
            <Icon name="back" />
          </button>
          <span className="month-label">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>

      {error && <Empty title="Couldn't load the calendar" />}
      {!error && entries === null && (
        <div className="center pad">
          <Spinner />
        </div>
      )}

      {!error && entries && (
        <>
          <div className="cal-grid">
            {WEEKDAYS.map((d) => (
              <div key={d} className="cal-weekday">
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              const list = d ? byDay.get(dayKey(d)) ?? [] : [];
              return (
                <div key={i} className={`cal-cell ${!d ? 'blank' : ''} ${d && dayKey(d) === today ? 'today' : ''}`}>
                  {d && <span className="cal-day">{d.getDate()}</span>}
                  {list.slice(0, 3).map((e) => (
                    <Link
                      key={e.video.id}
                      to={detailPath('series', e.meta.id, e.video.id)}
                      className="cal-item"
                      title={`${e.meta.name} ${episodeLabel(e.video)}`}
                    >
                      {e.meta.poster && <img src={e.meta.poster} alt="" />}
                      <span>
                        <b>{e.meta.name}</b>
                        <small>{episodeLabel(e.video)}</small>
                      </span>
                    </Link>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                </div>
              );
            })}
          </div>

          <h2 className="section-title">This month</h2>
          {monthEntries.length === 0 ? (
            <p className="muted">No episodes from your library air this month.</p>
          ) : (
            <div className="cal-list">
              {monthEntries.map((e) => (
                <Link key={e.video.id} to={detailPath('series', e.meta.id, e.video.id)} className="cal-list-item">
                  <div className="cal-date">
                    <b>{e.date.getDate()}</b>
                    <small>{e.date.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                  </div>
                  {e.meta.poster && <img src={e.meta.poster} alt="" />}
                  <div>
                    <div className="strong">{e.meta.name}</div>
                    <div className="muted small">
                      {episodeLabel(e.video)} · {videoTitle(e.video)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
