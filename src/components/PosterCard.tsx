import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MetaPreview } from '../addons/types';
import { detailPath, genresOf, yearOf } from '../lib/util';
import { useLibrary } from '../store/library';
import { Icon } from './Icon';

type Props = {
  meta: MetaPreview;
  progress?: number;
  subtitle?: string;
  to?: string;
  onDismiss?: () => void;
};

export function PosterCard({ meta, progress, subtitle, to, onDismiss }: Props) {
  const [broken, setBroken] = useState(false);
  const inLibrary = useLibrary((s) => !!s.items[meta.id]?.inLibrary);
  const shape = meta.posterShape ?? 'poster';
  const href = to ?? detailPath(meta.type, meta.id);

  return (
    <div className={`poster-card shape-${shape}`}>
      <Link to={href} className="poster-link" title={meta.name}>
        <div className="poster-img">
          {meta.poster && !broken ? (
            <img src={meta.poster} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <div className="poster-fallback">
              <span>{meta.name}</span>
            </div>
          )}
          {meta.imdbRating && (
            <span className="poster-rating">
              <Icon name="star" size={12} />
              {meta.imdbRating}
            </span>
          )}
          {inLibrary && (
            <span className="poster-badge" title="In library">
              <Icon name="check" size={12} />
            </span>
          )}
          <div className="poster-hover">
            <span className="play-circle">
              <Icon name="play" size={22} />
            </span>
          </div>
          {progress !== undefined && progress > 0 && (
            <div className="progress">
              <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="poster-title">{meta.name}</div>
        <div className="poster-sub">{subtitle ?? ([yearOf(meta), genresOf(meta)[0]].filter(Boolean).join(' · ') || ' ')}</div>
      </Link>
      {onDismiss && (
        <button className="poster-dismiss icon-btn" onClick={onDismiss} title="Remove from Continue Watching">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function PosterSkeleton({ shape = 'poster' }: { shape?: string }) {
  return (
    <div className={`poster-card shape-${shape} skeleton`}>
      <div className="poster-img shimmer" />
      <div className="poster-title shimmer-line" />
    </div>
  );
}
