import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  catalogGenres,
  catalogRequiredExtras,
  catalogSupportsExtra,
  discoverCatalogs,
  fetchCatalog,
  typeLabel,
} from '../addons/client';
import type { CatalogRef, MetaPreview } from '../addons/types';
import { Empty, Select, Spinner } from '../components/Common';
import { PosterCard, PosterSkeleton } from '../components/PosterCard';
import { discoverPath } from '../lib/util';
import { useAddons } from '../store/addons';

const refKey = (r: CatalogRef) => `${r.addon.transportUrl}|${r.catalog.id}`;

export default function Discover() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const addons = useAddons((s) => s.addons);
  const catalogs = useMemo(() => discoverCatalogs(addons), [addons]);

  const types = useMemo(() => {
    const seen: string[] = [];
    for (const c of catalogs) if (!seen.includes(c.catalog.type)) seen.push(c.catalog.type);
    return seen;
  }, [catalogs]);

  const type = params.type && types.includes(params.type) ? params.type : types[0];
  const forType = useMemo(() => catalogs.filter((c) => c.catalog.type === type), [catalogs, type]);
  const selected =
    forType.find((c) => c.addon.transportUrl === params.transportUrl && c.catalog.id === params.catalogId) ??
    forType[0];

  const genres = selected ? catalogGenres(selected.catalog) : [];
  const genreRequired = selected ? catalogRequiredExtras(selected.catalog).includes('genre') : false;
  const genreParam = search.get('genre') ?? '';
  const genre = genres.includes(genreParam) ? genreParam : genreRequired ? genres[0] ?? '' : '';
  const supportsSkip = selected ? catalogSupportsExtra(selected.catalog, 'skip') : false;

  const [metas, setMetas] = useState<MetaPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const loadId = useRef(0);

  const go = (ref?: CatalogRef, g?: string) => {
    if (!ref) return;
    navigate(discoverPath(ref.addon.transportUrl, ref.catalog.type, ref.catalog.id, g || undefined), {
      replace: true,
    });
  };

  const loadPage = useCallback(
    async (skip: number) => {
      if (!selected) return;
      const id = ++loadId.current;
      setLoading(true);
      setError(false);
      try {
        const extra: Record<string, string> = {};
        if (genre) extra.genre = genre;
        if (skip > 0) extra.skip = String(skip);
        const page = await fetchCatalog(selected, extra);
        if (id !== loadId.current) return;
        setMetas((prev) => {
          const existing = new Set(prev.map((m) => m.id));
          const fresh = page.filter((m) => !existing.has(m.id));
          if (fresh.length === 0 || !supportsSkip) setDone(true);
          return [...prev, ...fresh];
        });
      } catch {
        if (id === loadId.current) setError(true);
      } finally {
        if (id === loadId.current) setLoading(false);
      }
    },
    [selected, genre, supportsSkip],
  );

  useEffect(() => {
    setMetas([]);
    setDone(false);
    loadPage(0);
  }, [loadPage]);

  // Infinite scroll
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && !done && !error && metas.length > 0) loadPage(metas.length);
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, done, error, metas.length, loadPage]);

  if (catalogs.length === 0) {
    return (
      <div className="page">
        <Empty icon="discover" title="Nothing to discover">
          Install addons with catalogs to browse content here.
        </Empty>
      </div>
    );
  }

  return (
    <div className="page discover">
      <div className="page-head">
        <h1>Discover</h1>
        <div className="filters">
          <Select
            label="Type"
            value={type}
            onChange={(t) => go(catalogs.find((c) => c.catalog.type === t))}
            options={types.map((t) => ({ value: t, label: typeLabel(t) }))}
          />
          <Select
            label="Catalog"
            value={selected ? refKey(selected) : ''}
            onChange={(k) => go(forType.find((c) => refKey(c) === k))}
            options={forType.map((c) => ({
              value: refKey(c),
              label: `${c.catalog.name || c.catalog.id}${addons.length > 1 ? ` · ${c.addon.manifest.name}` : ''}`,
            }))}
          />
          {genres.length > 0 && (
            <Select
              label={selected?.catalog.id === 'year' ? 'Year' : 'Genre'}
              value={genre}
              onChange={(g) => go(selected, g)}
              options={[
                ...(genreRequired ? [] : [{ value: '', label: 'All' }]),
                ...genres.map((g) => ({ value: g, label: g })),
              ]}
            />
          )}
        </div>
      </div>

      <div className="grid">
        {metas.map((m) => (
          <PosterCard key={m.id} meta={{ ...m, type: m.type || type }} />
        ))}
        {loading && metas.length === 0 && Array.from({ length: 18 }, (_, i) => <PosterSkeleton key={i} />)}
      </div>

      {error && (
        <Empty icon="info" title="Couldn't load this catalog">
          <button className="btn" onClick={() => loadPage(metas.length)}>
            Retry
          </button>
        </Empty>
      )}
      {!loading && !error && done && metas.length === 0 && <Empty title="No items in this catalog" />}
      <div ref={sentinel} className="sentinel">
        {loading && metas.length > 0 && <Spinner />}
      </div>
    </div>
  );
}
