import type {
  AddonDescriptor,
  CatalogRef,
  Manifest,
  ManifestCatalog,
  MetaDetail,
  MetaPreview,
  Stream,
  Subtitle,
} from './types';

/** Accepts https://, http:// and stremio:// links and returns an http(s) manifest URL. */
export function normalizeTransportUrl(input: string): string {
  let url = input.trim();
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

/** Base URL of the addon: the transport URL without the trailing /manifest.json. */
export function addonBase(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json(\?.*)?$/, '');
}

export function isHttpTransport(transportUrl: string) {
  return /\/manifest\.json(\?.*)?$/.test(transportUrl);
}

export function configureUrl(transportUrl: string) {
  return addonBase(transportUrl) + '/configure';
}

const TIMEOUT_MS = 15000;
const responseCache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Cached GET; failed requests are evicted so they can be retried. */
function cachedJson<T>(url: string): Promise<T> {
  const hit = responseCache.get(url);
  if (hit) return hit as Promise<T>;
  const p = fetchJson<T>(url).catch((err) => {
    responseCache.delete(url);
    throw err;
  });
  responseCache.set(url, p);
  return p;
}

export function clearAddonCache() {
  responseCache.clear();
}

export async function fetchManifest(transportUrl: string): Promise<Manifest> {
  const manifest = await fetchJson<Manifest>(transportUrl);
  if (!manifest || !manifest.id || !manifest.name || !Array.isArray(manifest.resources)) {
    throw new Error('Invalid addon manifest');
  }
  manifest.catalogs = manifest.catalogs ?? [];
  manifest.types = manifest.types ?? [];
  return manifest;
}

export type Extra = Record<string, string | number | undefined>;

/** Builds `{base}/{resource}/{type}/{id}/{extra}.json` as defined by the protocol. */
export function resourceUrl(
  transportUrl: string,
  resource: string,
  type: string,
  id: string,
  extra?: Extra,
) {
  const parts = [addonBase(transportUrl), resource, encodeURIComponent(type), encodeURIComponent(id)];
  const extraStr = Object.entries(extra ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return parts.join('/') + (extraStr ? '/' + extraStr : '') + '.json';
}

export function supportsResource(
  manifest: Manifest,
  resource: string,
  type: string,
  id?: string,
): boolean {
  for (const r of manifest.resources) {
    const name = typeof r === 'string' ? r : r.name;
    if (name !== resource) continue;
    const types = (typeof r !== 'string' && r.types) || manifest.types;
    if (!types.includes(type)) continue;
    const prefixes = (typeof r !== 'string' && r.idPrefixes) || manifest.idPrefixes;
    if (id && prefixes && prefixes.length > 0 && !prefixes.some((p) => id.startsWith(p))) continue;
    return true;
  }
  return false;
}

export function hasResource(manifest: Manifest, resource: string) {
  return manifest.resources.some((r) => (typeof r === 'string' ? r : r.name) === resource);
}

export function resourceNames(manifest: Manifest) {
  return manifest.resources.map((r) => (typeof r === 'string' ? r : r.name));
}

export function catalogExtra(catalog: ManifestCatalog, name: string) {
  return catalog.extra?.find((e) => e.name === name);
}

export function catalogSupportsExtra(catalog: ManifestCatalog, name: string) {
  return !!catalogExtra(catalog, name) || !!catalog.extraSupported?.includes(name);
}

export function catalogRequiredExtras(catalog: ManifestCatalog): string[] {
  const req = (catalog.extra ?? []).filter((e) => e.isRequired).map((e) => e.name);
  return [...new Set([...req, ...(catalog.extraRequired ?? [])])];
}

export function catalogGenres(catalog: ManifestCatalog): string[] {
  return catalogExtra(catalog, 'genre')?.options ?? catalog.genres ?? [];
}

export function catalogTitle(ref: CatalogRef) {
  const name = ref.catalog.name || ref.catalog.id;
  return `${name} · ${typeLabel(ref.catalog.type)}`;
}

/** Catalogs that can be shown without any user input (board rows). */
export function boardCatalogs(addons: AddonDescriptor[]): CatalogRef[] {
  const refs: CatalogRef[] = [];
  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs ?? []) {
      if (catalogRequiredExtras(catalog).length > 0) continue;
      refs.push({ addon, catalog });
    }
  }
  return refs;
}

/** Catalogs browsable in Discover: no required extras besides genre (which has options). */
export function discoverCatalogs(addons: AddonDescriptor[]): CatalogRef[] {
  const refs: CatalogRef[] = [];
  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs ?? []) {
      const req = catalogRequiredExtras(catalog);
      if (req.some((r) => r !== 'genre')) continue;
      if (req.includes('genre') && catalogGenres(catalog).length === 0) continue;
      refs.push({ addon, catalog });
    }
  }
  return refs;
}

export function searchCatalogs(addons: AddonDescriptor[]): CatalogRef[] {
  const refs: CatalogRef[] = [];
  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs ?? []) {
      if (!catalogSupportsExtra(catalog, 'search')) continue;
      if (catalogRequiredExtras(catalog).some((r) => r !== 'search')) continue;
      refs.push({ addon, catalog });
    }
  }
  return refs;
}

export async function fetchCatalog(ref: CatalogRef, extra?: Extra): Promise<MetaPreview[]> {
  const url = resourceUrl(ref.addon.transportUrl, 'catalog', ref.catalog.type, ref.catalog.id, extra);
  const res = await cachedJson<{ metas?: MetaPreview[] }>(url);
  return (res.metas ?? []).filter((m) => m && m.id && m.name);
}

/** Queries addons in order and returns the first meta found, like Stremio does. */
export async function fetchMeta(
  addons: AddonDescriptor[],
  type: string,
  id: string,
): Promise<{ meta: MetaDetail; addon: AddonDescriptor } | null> {
  const candidates = addons.filter((a) => supportsResource(a.manifest, 'meta', type, id));
  for (const addon of candidates) {
    try {
      const res = await cachedJson<{ meta?: MetaDetail }>(
        resourceUrl(addon.transportUrl, 'meta', type, id),
      );
      if (res.meta && res.meta.id) return { meta: res.meta, addon };
    } catch {
      // try the next addon
    }
  }
  return null;
}

export type AddonResult<T> = {
  addon: AddonDescriptor;
  status: 'loading' | 'ready' | 'error';
  items: T[];
  error?: string;
};

export function streamAddons(addons: AddonDescriptor[], type: string, id: string) {
  return addons.filter((a) => supportsResource(a.manifest, 'stream', type, id));
}

export async function fetchStreams(addon: AddonDescriptor, type: string, id: string): Promise<Stream[]> {
  const res = await cachedJson<{ streams?: Stream[] }>(resourceUrl(addon.transportUrl, 'stream', type, id));
  return (res.streams ?? []).filter((s) => s && (s.url || s.ytId || s.infoHash || s.externalUrl));
}

export function subtitleAddons(addons: AddonDescriptor[], type: string, id: string) {
  return addons.filter((a) => supportsResource(a.manifest, 'subtitles', type, id));
}

export async function fetchSubtitles(
  addon: AddonDescriptor,
  type: string,
  id: string,
  extra?: Extra,
): Promise<Subtitle[]> {
  const res = await cachedJson<{ subtitles?: Subtitle[] }>(
    resourceUrl(addon.transportUrl, 'subtitles', type, id, extra),
  );
  return (res.subtitles ?? []).filter((s) => s && s.url);
}

/** Community/official addon listings come from the `addon_catalog` resource (Cinemeta provides them). */
export async function fetchAddonCatalog(
  addons: AddonDescriptor[],
  type: string,
  id: string,
): Promise<AddonDescriptor[]> {
  const providers = addons.filter((a) => hasResource(a.manifest, 'addon_catalog'));
  const results = await Promise.allSettled(
    providers.map((p) =>
      cachedJson<{ addons?: AddonDescriptor[] }>(resourceUrl(p.transportUrl, 'addon_catalog', type, id)),
    ),
  );
  const seen = new Set<string>();
  const out: AddonDescriptor[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const d of r.value.addons ?? []) {
      if (!d?.manifest?.id || seen.has(d.transportUrl)) continue;
      seen.add(d.transportUrl);
      out.push(d);
    }
  }
  return out;
}

const TYPE_LABELS: Record<string, string> = {
  movie: 'Movies',
  series: 'Series',
  channel: 'Channels',
  tv: 'TV',
  anime: 'Anime',
  other: 'Other',
  all: 'All',
};

export function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}
