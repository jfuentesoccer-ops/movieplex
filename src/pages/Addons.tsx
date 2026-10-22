import { FormEvent, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  configureUrl,
  fetchAddonCatalog,
  fetchManifest,
  isHttpTransport,
  normalizeTransportUrl,
  resourceNames,
  typeLabel,
} from '../addons/client';
import type { AddonDescriptor } from '../addons/types';
import { Empty, Modal, Select, Spinner } from '../components/Common';
import { Icon } from '../components/Icon';
import { copyText } from '../lib/util';
import { useAddons } from '../store/addons';
import { useProfiles } from '../store/profiles';
import { toast } from '../store/toast';

type Filter = 'installed' | 'official' | 'community';

/** Profiles set to "Use Main's addons" can browse but not change the addon list. */
const useReadOnly = () =>
  useProfiles((s) => s.profiles.find((p) => p.id === s.activeId)?.addonMode === 'shared');

export default function Addons() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const filter: Filter = (['installed', 'official', 'community'] as const).includes(params.filter as Filter)
    ? (params.filter as Filter)
    : 'installed';

  const installed = useAddons((s) => s.addons);
  const [remote, setRemote] = useState<Record<string, AddonDescriptor[] | 'error' | undefined>>({});
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<AddonDescriptor | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const readOnly = useReadOnly();

  // Official & community listings come from the addon_catalog resource of installed addons.
  useEffect(() => {
    if (filter === 'installed' || remote[filter]) return;
    fetchAddonCatalog(installed, 'all', filter)
      .then((list) => setRemote((r) => ({ ...r, [filter]: list })))
      .catch(() => setRemote((r) => ({ ...r, [filter]: 'error' })));
  }, [filter, installed, remote]);

  // #/addons?install=1 (desktop menu) opens the install-by-URL dialog.
  useEffect(() => {
    if (search.get('install')) {
      setShowInstall(true);
      setSearch({}, { replace: true });
    }
  }, [search, setSearch]);

  // Deep link: #/addons?addon=<manifest url> opens the install dialog (like stremio:// links).
  const deepLink = search.get('addon');
  useEffect(() => {
    if (!deepLink) return;
    const url = normalizeTransportUrl(deepLink);
    fetchManifest(url)
      .then((manifest) => setDetails({ transportUrl: url, manifest }))
      .catch(() => toast('Could not load that addon', 'error'));
    setSearch({}, { replace: true });
  }, [deepLink, setSearch]);

  const source = filter === 'installed' ? installed : remote[filter];
  const list = useMemo(() => {
    if (!Array.isArray(source)) return [];
    const q = query.trim().toLowerCase();
    return source.filter((a) => {
      if (type && !a.manifest.types?.includes(type)) return false;
      if (!q) return true;
      return (
        a.manifest.name.toLowerCase().includes(q) ||
        (a.manifest.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [source, type, query]);

  const types = useMemo(() => {
    const all = new Set<string>();
    if (Array.isArray(source)) source.forEach((a) => a.manifest.types?.forEach((t) => all.add(t)));
    return [...all];
  }, [source]);

  return (
    <div className="page addons">
      <div className="page-head">
        <h1>Addons</h1>
        {!readOnly && (
          <button className="btn primary" onClick={() => setShowInstall(true)}>
            <Icon name="plus" /> Install from URL
          </button>
        )}
      </div>

      {readOnly && (
        <div className="notice">
          <Icon name="info" size={18} />
          <span>
            This profile uses the main profile’s addons. Switch to Main to change them, or give this profile its
            own addons in Settings › Profiles.
          </span>
        </div>
      )}

      <div className="tabs">
        {(['installed', 'official', 'community'] as const).map((f) => (
          <NavLink key={f} to={`/addons/${f}`} className={() => `tab ${filter === f ? 'active' : ''}`}>
            {f === 'installed' ? `Installed (${installed.length})` : f[0].toUpperCase() + f.slice(1)}
          </NavLink>
        ))}
      </div>

      <div className="filters">
        <div className="search-box inline">
          <Icon name="search" size={18} />
          <input placeholder="Search addons" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select
          label="Type"
          value={type}
          onChange={setType}
          options={[{ value: '', label: 'All types' }, ...types.map((t) => ({ value: t, label: typeLabel(t) }))]}
        />
      </div>

      {source === undefined && (
        <div className="center pad">
          <Spinner />
        </div>
      )}
      {source === 'error' && <Empty title="Couldn't load the addon catalog" />}

      <div className="addon-list">
        {list.map((a, i) => (
          <AddonCard
            key={a.transportUrl}
            addon={a}
            index={filter === 'installed' ? i : undefined}
            total={installed.length}
            onOpen={() => setDetails(a)}
          />
        ))}
      </div>
      {Array.isArray(source) && list.length === 0 && (
        <Empty icon="addons" title="No addons match">
          {filter === 'installed' && (
            <button className="btn" onClick={() => navigate('/addons/community')}>
              Browse community addons
            </button>
          )}
        </Empty>
      )}

      <p className="muted small center pad">
        MoviePlex is compatible with Stremio addons. Install any addon by pasting its manifest URL
        (https:// or stremio://).
      </p>

      {showInstall && (
        <InstallModal
          onClose={() => setShowInstall(false)}
          onLoaded={(d) => {
            setShowInstall(false);
            setDetails(d);
          }}
        />
      )}
      {details && <AddonDetails addon={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

function AddonLogo({ addon }: { addon: AddonDescriptor }) {
  const [broken, setBroken] = useState(false);
  const logo = addon.manifest.logo;
  return (
    <div className="addon-logo">
      {logo && !broken ? (
        <img src={logo} alt="" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <Icon name="addons" size={26} />
      )}
    </div>
  );
}

function AddonCard({
  addon,
  index,
  total,
  onOpen,
}: {
  addon: AddonDescriptor;
  index?: number;
  total: number;
  onOpen: () => void;
}) {
  const { install, uninstall, move, isInstalled } = useAddons();
  const readOnly = useReadOnly();
  const installed = isInstalled(addon.transportUrl);
  const m = addon.manifest;
  const [busy, setBusy] = useState(false);
  const legacy = !isHttpTransport(addon.transportUrl);

  const doInstall = async () => {
    if (m.behaviorHints?.configurationRequired) {
      window.open(configureUrl(addon.transportUrl), '_blank', 'noopener');
      return;
    }
    setBusy(true);
    try {
      await install(addon.transportUrl, m);
      toast(`${m.name} installed`, 'success');
    } catch {
      toast(`Couldn't install ${m.name}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="addon-card">
      <button className="addon-main" onClick={onOpen}>
        <AddonLogo addon={addon} />
        <div className="addon-text">
          <div className="addon-name">
            {m.name}
            <span className="muted small">v{m.version}</span>
            {addon.flags?.official && <span className="badge">Official</span>}
          </div>
          <div className="addon-types">
            {(m.types ?? []).slice(0, 5).map((t) => (
              <span key={t} className="chip-lite small">
                {typeLabel(t)}
              </span>
            ))}
            {resourceNames(m).map((r) => (
              <span key={r} className="chip-lite small outline">
                {r}
              </span>
            ))}
          </div>
          {m.description && <p className="addon-desc">{m.description}</p>}
        </div>
      </button>
      <div className="addon-actions">
        {index !== undefined && !readOnly && (
          <>
            <button className="icon-btn ghost" disabled={index === 0} onClick={() => move(addon.transportUrl, -1)} title="Move up">
              <Icon name="up" />
            </button>
            <button
              className="icon-btn ghost"
              disabled={index === total - 1}
              onClick={() => move(addon.transportUrl, 1)}
              title="Move down"
            >
              <Icon name="down" />
            </button>
          </>
        )}
        {m.behaviorHints?.configurable && (
          <a className="btn small glass" href={configureUrl(addon.transportUrl)} target="_blank" rel="noreferrer">
            Configure
          </a>
        )}
        {installed ? (
          <button
            className="btn small danger"
            disabled={addon.flags?.protected || readOnly}
            title={addon.flags?.protected ? 'This addon is required' : readOnly ? 'Only the main profile can change addons' : undefined}
            onClick={() => {
              uninstall(addon.transportUrl);
              toast(`${m.name} uninstalled`);
            }}
          >
            {addon.flags?.protected ? 'Protected' : 'Uninstall'}
          </button>
        ) : (
          <button className="btn small primary" disabled={busy || legacy || readOnly} onClick={doInstall} title={legacy ? 'Legacy addon protocol is not supported' : undefined}>
            {busy ? <Spinner size={14} /> : m.behaviorHints?.configurationRequired ? 'Configure' : 'Install'}
          </button>
        )}
      </div>
    </div>
  );
}

function InstallModal({ onClose, onLoaded }: { onClose: () => void; onLoaded: (d: AddonDescriptor) => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const transportUrl = normalizeTransportUrl(url);
      const manifest = await fetchManifest(transportUrl);
      onLoaded({ transportUrl, manifest });
    } catch (err) {
      setError(
        `Couldn't load a manifest from that URL (${(err as Error).message}). Make sure it ends with /manifest.json.`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Install addon" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <p className="muted">Paste the addon's manifest URL. Both https:// and stremio:// links work.</p>
        <input
          className="input"
          autoFocus
          placeholder="https://example.com/manifest.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="row-gap end">
          <button type="button" className="btn glass" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={loading || !url.trim()}>
            {loading ? <Spinner size={16} /> : 'Continue'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddonDetails({ addon, onClose }: { addon: AddonDescriptor; onClose: () => void }) {
  const { install, uninstall, isInstalled, addons } = useAddons();
  const readOnly = useReadOnly();
  const installed = isInstalled(addon.transportUrl);
  const current = addons.find((a) => a.transportUrl === addon.transportUrl);
  const m = current?.manifest ?? addon.manifest;
  const isProtected = current?.flags?.protected;
  const [busy, setBusy] = useState(false);

  const doInstall = async () => {
    setBusy(true);
    try {
      await install(addon.transportUrl, m);
      toast(`${m.name} installed`, 'success');
      onClose();
    } catch {
      toast(`Couldn't install ${m.name}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <span className="addon-modal-title">
          <AddonLogo addon={addon} /> {m.name} <span className="muted small">v{m.version}</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="stack">
        {m.description && <p>{m.description}</p>}
        <dl className="facts">
          <dt>Types</dt>
          <dd>{(m.types ?? []).map(typeLabel).join(', ') || '—'}</dd>
          <dt>Provides</dt>
          <dd>{resourceNames(m).join(', ')}</dd>
          {m.catalogs.length > 0 && (
            <>
              <dt>Catalogs</dt>
              <dd>{m.catalogs.map((c) => `${c.name || c.id} (${typeLabel(c.type)})`).join(', ')}</dd>
            </>
          )}
          {m.idPrefixes && m.idPrefixes.length > 0 && (
            <>
              <dt>ID prefixes</dt>
              <dd className="mono">{m.idPrefixes.join(', ')}</dd>
            </>
          )}
          <dt>ID</dt>
          <dd className="mono">{m.id}</dd>
          <dt>URL</dt>
          <dd className="mono break">{addon.transportUrl}</dd>
        </dl>
        {m.behaviorHints?.adult && <p className="error-text">This addon contains adult content.</p>}
        {m.behaviorHints?.p2p && <p className="muted small">This addon provides peer-to-peer (torrent) streams.</p>}
        <div className="row-gap end">
          <button
            className="btn glass"
            onClick={async () => toast((await copyText(addon.transportUrl)) ? 'Addon URL copied' : 'Copy failed')}
          >
            <Icon name="copy" size={16} /> Copy URL
          </button>
          {m.behaviorHints?.configurable && (
            <a className="btn glass" href={configureUrl(addon.transportUrl)} target="_blank" rel="noreferrer">
              Configure
            </a>
          )}
          {installed ? (
            <button
              className="btn danger"
              disabled={isProtected || readOnly}
              onClick={() => {
                uninstall(addon.transportUrl);
                toast(`${m.name} uninstalled`);
                onClose();
              }}
            >
              {isProtected ? 'Protected' : 'Uninstall'}
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || readOnly || !!m.behaviorHints?.configurationRequired || !isHttpTransport(addon.transportUrl)}
              onClick={doInstall}
            >
              {busy ? <Spinner size={16} /> : 'Install'}
            </button>
          )}
        </div>
        {m.behaviorHints?.configurationRequired && !installed && (
          <p className="muted small">
            This addon must be configured first. Open Configure, then install the URL it gives you.
          </p>
        )}
      </div>
    </Modal>
  );
}
