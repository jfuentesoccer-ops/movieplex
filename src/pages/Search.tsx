import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchCatalogs, typeLabel } from '../addons/client';
import { Empty } from '../components/Common';
import { CatalogRow } from '../components/MetaRow';
import { useAddons } from '../store/addons';

export default function Search() {
  const [params] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const addons = useAddons((s) => s.addons);
  const catalogs = useMemo(() => searchCatalogs(addons), [addons]);

  if (!query) {
    return (
      <div className="page">
        <Empty icon="search" title="Search MoviePlex">
          Type a title above. Results come from every installed addon that supports search.
        </Empty>
      </div>
    );
  }

  if (catalogs.length === 0) {
    return (
      <div className="page">
        <Empty icon="addons" title="No searchable addons">
          None of your installed addons support search.
          <Link to="/addons" className="btn primary">
            Browse addons
          </Link>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page search">
      <div className="page-head">
        <h1>
          Results for <span className="accent">“{query}”</span>
        </h1>
      </div>
      <div className="rows">
        {catalogs.map((ref) => (
          <CatalogRow
            key={`${ref.addon.transportUrl}|${ref.catalog.type}|${ref.catalog.id}|${query}`}
            catalogRef={ref}
            title={typeLabel(ref.catalog.type)}
            subtitle={`${ref.addon.manifest.name}${ref.catalog.name ? ' · ' + ref.catalog.name : ''}`}
            extra={{ search: query }}
          />
        ))}
      </div>
      <p className="muted small center">Rows without results are hidden.</p>
    </div>
  );
}
