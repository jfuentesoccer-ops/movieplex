import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCatalog } from '../addons/client';
import type { CatalogRef, MetaPreview } from '../addons/types';
import { Icon } from './Icon';
import { PosterCard, PosterSkeleton } from './PosterCard';

export function Row({
  title,
  subtitle,
  seeAll,
  children,
}: {
  title: string;
  subtitle?: string;
  seeAll?: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  return (
    <section className="row">
      <div className="row-head">
        <h2>
          {title}
          {subtitle && <span className="row-sub">{subtitle}</span>}
        </h2>
        <div className="row-actions">
          {seeAll && (
            <Link to={seeAll} className="see-all">
              See all <Icon name="chevronRight" size={16} />
            </Link>
          )}
          <button className="icon-btn ghost row-arrow" onClick={() => scroll(-1)} aria-label="Scroll left">
            <Icon name="back" size={18} />
          </button>
          <button className="icon-btn ghost row-arrow" onClick={() => scroll(1)} aria-label="Scroll right">
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </div>
      <div className="row-scroller" ref={scroller}>
        {children}
      </div>
    </section>
  );
}

/** A board row fed by an addon catalog. Hides itself when the catalog is empty or fails. */
export function CatalogRow({
  catalogRef,
  title,
  subtitle,
  seeAll,
  extra,
  onLoaded,
}: {
  catalogRef: CatalogRef;
  title: string;
  subtitle?: string;
  seeAll?: string;
  extra?: Record<string, string>;
  onLoaded?: (metas: MetaPreview[]) => void;
}) {
  const [metas, setMetas] = useState<MetaPreview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const extraKey = JSON.stringify(extra ?? {});

  useEffect(() => {
    let alive = true;
    setMetas(null);
    setFailed(false);
    fetchCatalog(catalogRef, extra)
      .then((m) => {
        if (!alive) return;
        setMetas(m);
        onLoaded?.(m);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogRef.addon.transportUrl, catalogRef.catalog.type, catalogRef.catalog.id, extraKey]);

  if (failed || (metas && metas.length === 0)) return null;

  return (
    <Row title={title} subtitle={subtitle} seeAll={seeAll}>
      {metas
        ? metas.slice(0, 30).map((m) => <PosterCard key={m.id} meta={{ ...m, type: m.type || catalogRef.catalog.type }} />)
        : Array.from({ length: 10 }, (_, i) => <PosterSkeleton key={i} />)}
    </Row>
  );
}
