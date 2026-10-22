import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MetaPreview } from '../addons/types';
import { backgroundOf, detailPath, genresOf, logoOf, yearOf } from '../lib/util';
import { useLibrary } from '../store/library';
import { Icon } from './Icon';

const ROTATE_MS = 9000;

export function Hero({ items }: { items: MetaPreview[] }) {
  const [index, setIndex] = useState(0);
  const [logoFailed, setLogoFailed] = useState<Record<string, boolean>>({});
  const toggle = useLibrary((s) => s.toggle);
  const libraryItems = useLibrary((s) => s.items);

  useEffect(() => {
    if (items.length < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, items.length]);

  if (items.length === 0) return <div className="hero hero-placeholder shimmer" />;

  const meta = items[index % items.length];
  const logo = logoOf(meta);
  const inLibrary = !!libraryItems[meta.id]?.inLibrary;

  return (
    <section className="hero">
      {items.map((m, i) => (
        <div
          key={m.id}
          className={`hero-bg ${i === index ? 'active' : ''}`}
          style={{ backgroundImage: `url("${backgroundOf(m) ?? m.poster ?? ''}")` }}
        />
      ))}
      <div className="hero-shade" />
      <div className="hero-content" key={meta.id}>
        {logo && !logoFailed[meta.id] ? (
          <img
            className="hero-logo"
            src={logo}
            alt={meta.name}
            onError={() => setLogoFailed((f) => ({ ...f, [meta.id]: true }))}
          />
        ) : (
          <h1 className="hero-title">{meta.name}</h1>
        )}
        <div className="meta-line">
          {meta.imdbRating && (
            <span className="imdb">
              <b>IMDb</b> {meta.imdbRating}
            </span>
          )}
          {yearOf(meta) && <span>{yearOf(meta)}</span>}
          {meta.runtime && <span>{meta.runtime}</span>}
          {genresOf(meta)
            .slice(0, 3)
            .map((g) => (
              <span key={g} className="chip-lite">
                {g}
              </span>
            ))}
        </div>
        {meta.description && <p className="hero-desc">{meta.description}</p>}
        <div className="hero-actions">
          <Link to={detailPath(meta.type, meta.id) + '?streams=1'} className="btn primary">
            <Icon name="play" /> Watch now
          </Link>
          <Link to={detailPath(meta.type, meta.id)} className="btn glass">
            <Icon name="info" /> More info
          </Link>
          <button className="icon-btn glass round" onClick={() => toggle(meta)} title={inLibrary ? 'Remove from library' : 'Add to library'}>
            <Icon name={inLibrary ? 'check' : 'plus'} />
          </button>
        </div>
      </div>
      <div className="hero-dots">
        {items.map((m, i) => (
          <button
            key={m.id}
            className={i === index ? 'active' : ''}
            onClick={() => setIndex(i)}
            aria-label={`Show ${m.name}`}
          />
        ))}
      </div>
    </section>
  );
}
