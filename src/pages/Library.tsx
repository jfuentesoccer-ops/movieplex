import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { typeLabel } from '../addons/client';
import { Empty, Select } from '../components/Common';
import { PosterCard } from '../components/PosterCard';
import { itemToMeta, useLibrary } from '../store/library';

type Sort = 'lastwatched' | 'added' | 'name' | 'watched';

export default function Library() {
  const { type } = useParams();
  const navigate = useNavigate();
  const items = useLibrary((s) => s.items);
  const remove = useLibrary((s) => s.remove);
  const [sort, setSort] = useState<Sort>('lastwatched');

  const library = useMemo(() => Object.values(items).filter((i) => i.inLibrary), [items]);
  const types = useMemo(() => [...new Set(library.map((i) => i.type))], [library]);

  const list = useMemo(() => {
    const filtered = type ? library.filter((i) => i.type === type) : library;
    const sorted = [...filtered];
    switch (sort) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'added':
        sorted.sort((a, b) => b.addedAt - a.addedAt);
        break;
      case 'watched':
        sorted.sort((a, b) => b.state.watched.length - a.state.watched.length);
        break;
      default:
        sorted.sort((a, b) => (b.state.lastWatched ?? b.addedAt) - (a.state.lastWatched ?? a.addedAt));
    }
    return sorted;
  }, [library, type, sort]);

  return (
    <div className="page library">
      <div className="page-head">
        <h1>Library</h1>
        <div className="filters">
          <Select
            label="Type"
            value={type ?? ''}
            onChange={(t) => navigate(t ? `/library/${t}` : '/library', { replace: true })}
            options={[{ value: '', label: 'All' }, ...types.map((t) => ({ value: t, label: typeLabel(t) }))]}
          />
          <Select<Sort>
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'lastwatched', label: 'Last watched' },
              { value: 'added', label: 'Recently added' },
              { value: 'name', label: 'A–Z' },
              { value: 'watched', label: 'Most watched' },
            ]}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <Empty icon="library" title="Your library is empty">
          Add movies and series with the <b>+</b> button and they'll show up here. Your library is saved on this device.
          <Link to="/discover" className="btn primary">
            Discover something
          </Link>
        </Empty>
      ) : (
        <div className="grid">
          {list.map((item) => {
            const progress = item.state.duration ? item.state.timeOffset / item.state.duration : 0;
            return (
              <PosterCard
                key={item.id}
                meta={itemToMeta(item)}
                progress={progress}
                subtitle={typeLabel(item.type)}
                onDismiss={() => remove(item.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
