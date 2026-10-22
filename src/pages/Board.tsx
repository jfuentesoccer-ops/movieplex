import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { boardCatalogs, fetchCatalog, typeLabel } from '../addons/client';
import { CINEMETA_URL } from '../addons/defaults';
import type { MetaPreview } from '../addons/types';
import { Empty } from '../components/Common';
import { Hero } from '../components/Hero';
import { CatalogRow, Row } from '../components/MetaRow';
import { PosterCard } from '../components/PosterCard';
import { detailPath, discoverPath, episodeLabel } from '../lib/util';
import { useAddons } from '../store/addons';
import { continueWatching, itemToMeta, useLibrary } from '../store/library';
import { useSettings } from '../store/settings';

export default function Board() {
  const addons = useAddons((s) => s.addons);
  const items = useLibrary((s) => s.items);
  const dismiss = useLibrary((s) => s.dismissContinue);
  const showHero = useSettings((s) => s.showHero);
  const catalogs = useMemo(() => boardCatalogs(addons), [addons]);
  const continueItems = useMemo(() => continueWatching(items), [items]);
  const [heroItems, setHeroItems] = useState<MetaPreview[]>([]);

  // The hero features the first page of the primary catalog (Cinemeta "Popular" when installed).
  const heroCatalog = useMemo(
    () =>
      catalogs.find((c) => c.addon.transportUrl === CINEMETA_URL && c.catalog.id === 'top') ?? catalogs[0],
    [catalogs],
  );

  useEffect(() => {
    if (!heroCatalog || !showHero) return;
    let alive = true;
    fetchCatalog(heroCatalog)
      .then((metas) => {
        if (!alive) return;
        const withArt = metas.filter((m) => m.background || /^tt\d+$/.test(m.id));
        setHeroItems(withArt.slice(0, 8).map((m) => ({ ...m, type: m.type || heroCatalog.catalog.type })));
      })
      .catch(() => alive && setHeroItems([]));
    return () => {
      alive = false;
    };
  }, [heroCatalog, showHero]);

  return (
    <div className="page board">
      {showHero && heroCatalog && <Hero items={heroItems} />}

      <div className="rows">
        {continueItems.length > 0 && (
          <Row title="Continue Watching">
            {continueItems.map((item) => {
              const progress = item.state.duration ? item.state.timeOffset / item.state.duration : 0;
              const isEpisode = item.state.videoId && item.state.videoId !== item.id;
              const ep = isEpisode ? episodeFromId(item.state.videoId!) : '';
              return (
                <PosterCard
                  key={item.id}
                  meta={itemToMeta(item)}
                  progress={progress}
                  subtitle={ep || `${Math.round(progress * 100)}% watched`}
                  to={detailPath(item.type, item.id, isEpisode ? item.state.videoId : undefined) + '?streams=1'}
                  onDismiss={() => dismiss(item.id)}
                />
              );
            })}
          </Row>
        )}

        {catalogs.map((ref) => (
          <CatalogRow
            key={`${ref.addon.transportUrl}|${ref.catalog.type}|${ref.catalog.id}`}
            catalogRef={ref}
            title={`${ref.catalog.name || ref.catalog.id} ${typeLabel(ref.catalog.type)}`}
            subtitle={ref.addon.manifest.name}
            seeAll={discoverPath(ref.addon.transportUrl, ref.catalog.type, ref.catalog.id)}
          />
        ))}

        {catalogs.length === 0 && (
          <Empty icon="addons" title="No catalogs installed">
            Install an addon that provides catalogs to fill your board.
            <Link to="/addons" className="btn primary">
              Browse addons
            </Link>
          </Empty>
        )}
      </div>
    </div>
  );
}

function episodeFromId(videoId: string) {
  // Cinemeta-style ids: tt123:season:episode
  const [, s, e] = videoId.split(':');
  if (s === undefined || e === undefined) return '';
  return episodeLabel({ id: videoId, season: +s, episode: +e });
}
