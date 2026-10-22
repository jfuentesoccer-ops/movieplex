// When each piece of local data last changed on this device, so sync can tell which side
// is newer. Kept per device (not per account) in localStorage.

export type ProfileMeta = {
  /** Library item id -> last local change (ms). */
  items: Record<string, number>;
  /** Library item id -> when it was removed locally. */
  tombstones: Record<string, number>;
  settingsAt: number;
  addonsAt: number;
};

export type SyncMeta = {
  /** The account this device last synced with. */
  linkedUserId?: string;
  lastSyncedAt?: number;
  profileTimes: Record<number, number>;
  profileTombstones: Record<number, number>;
  data: Record<number, ProfileMeta>;
};

const KEY = 'movieplex.sync';
let cache: SyncMeta | null = null;

export function loadMeta(): SyncMeta {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '') as SyncMeta;
  } catch {
    cache = null;
  }
  cache ??= { profileTimes: {}, profileTombstones: {}, data: {} };
  return cache;
}

export function saveMeta() {
  if (cache) localStorage.setItem(KEY, JSON.stringify(cache));
}

export function profileMeta(id: number): ProfileMeta {
  const meta = loadMeta();
  return (meta.data[id] ??= { items: {}, tombstones: {}, settingsAt: 0, addonsAt: 0 });
}
