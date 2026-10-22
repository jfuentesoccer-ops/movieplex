import type { SupabaseClient } from '@supabase/supabase-js';
import { useAddons } from '../store/addons';
import { LibraryItem, useLibrary } from '../store/library';
import { SCOPED_KEYS } from '../store/profileScope';
import { AVATAR_COLORS, MAX_PROFILES, PRIMARY_ID, Profile, useProfiles } from '../store/profiles';
import { DEFAULT_SETTINGS, Settings, useSettings } from '../store/settings';
import { activateProfile, moveProfileData } from '../store/switchProfile';
import { loadMeta, profileMeta, saveMeta } from './meta';
import { isTracking, untracked } from './tracking';

// Two-way sync with Supabase. Each piece of data carries the time it last changed (client
// clock, ms) and the newer side wins: profiles one by one, library items one by one, and
// settings / addon lists as whole documents. Deletions are synced as tombstones.

type ProfileRow = {
  user_id?: string;
  profile_id: number;
  name: string;
  color: string;
  addon_mode: 'own' | 'shared';
  pin: Profile['pin'] | null;
  deleted: boolean;
  updated_at: number;
};
type LibraryRow = { item_id: string; data: LibraryItem | null; deleted: boolean; updated_at: number };
type DataRow = { profile_id: number; kind: 'settings' | 'addons'; data: unknown; updated_at: number };

const CHUNK = 500;
const now = () => Date.now();

async function upsert(sb: SupabaseClient, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(error.message);
  }
}

// ---------- Change tracking (always on, so edits made while signed out sync later) ----------

let scheduled: ReturnType<typeof setTimeout> | null = null;
let onLocalChange: (() => void) | null = null;

function changed(delay = 4000) {
  if (scheduled || !onLocalChange) return;
  const run = onLocalChange;
  scheduled = setTimeout(() => {
    scheduled = null;
    run();
  }, delay);
}

const settingsData = (s: Settings) =>
  Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, s[k as keyof Settings]])) as Settings;

const addonsOwner = (profileId: number) =>
  useProfiles.getState().profiles.find((p) => p.id === profileId)?.addonMode === 'shared' ? PRIMARY_ID : profileId;

export function startTracking(scheduleSync: () => void) {
  onLocalChange = scheduleSync;

  useLibrary.subscribe((s, prev) => {
    if (!isTracking() || s.items === prev.items) return;
    const m = profileMeta(useProfiles.getState().activeId);
    const t = now();
    for (const [id, item] of Object.entries(s.items)) {
      if (prev.items[id] !== item) {
        m.items[id] = t;
        delete m.tombstones[id];
      }
    }
    for (const id of Object.keys(prev.items)) {
      if (!s.items[id]) {
        m.tombstones[id] = t;
        delete m.items[id];
      }
    }
    saveMeta();
    changed();
  });

  useSettings.subscribe(() => {
    if (!isTracking()) return;
    profileMeta(useProfiles.getState().activeId).settingsAt = now();
    saveMeta();
    changed();
  });

  useAddons.subscribe((s, prev) => {
    if (!isTracking() || s.addons === prev.addons) return;
    profileMeta(addonsOwner(useProfiles.getState().activeId)).addonsAt = now();
    saveMeta();
    changed();
  });

  useProfiles.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) changed(300); // pull the newly active profile's data
    if (!isTracking() || s.profiles === prev.profiles) return;
    const meta = loadMeta();
    const t = now();
    for (const p of s.profiles) {
      if (prev.profiles.find((x) => x.id === p.id) !== p) {
        meta.profileTimes[p.id] = t;
        delete meta.profileTombstones[p.id];
      }
    }
    for (const p of prev.profiles) {
      if (!s.profiles.some((x) => x.id === p.id)) {
        meta.profileTombstones[p.id] = t;
        delete meta.profileTimes[p.id];
      }
    }
    saveMeta();
    changed();
  });
}

// ---------- Profiles ----------

const toRow = (p: Profile, updatedAt: number): ProfileRow => ({
  profile_id: p.id,
  name: p.name,
  color: p.color,
  addon_mode: p.addonMode,
  pin: p.pin ?? null,
  deleted: false,
  updated_at: updatedAt,
});

const fromRow = (r: ProfileRow): Profile => ({
  id: r.profile_id,
  name: r.name,
  color: r.color || AVATAR_COLORS[0],
  addonMode: r.profile_id === PRIMARY_ID ? 'own' : r.addon_mode,
  pin: r.pin ?? undefined,
});

/** Removes a profile and its data from this device because it was deleted elsewhere. */
function dropLocalProfile(id: number) {
  if (useProfiles.getState().activeId === id) activateProfile(PRIMARY_ID);
  for (const key of SCOPED_KEYS) localStorage.removeItem(`${key}.p${id}`);
  delete loadMeta().data[id];
}

async function syncProfiles(sb: SupabaseClient, userId: string) {
  const { data, error } = await sb
    .from('mp_profiles')
    .select('profile_id,name,color,addon_mode,pin,deleted,updated_at');
  if (error) throw new Error(error.message);
  const remote = new Map((data as ProfileRow[]).map((r) => [r.profile_id, r]));
  const meta = loadMeta();
  let local = [...useProfiles.getState().profiles];

  // First sync with this account: a local profile that collides with a different account
  // profile of the same number moves to a free number instead of merging two people's data.
  if (meta.linkedUserId !== userId) {
    const taken = () => new Set([...remote.keys(), ...local.map((p) => p.id)]);
    local = local.map((p) => {
      const r = remote.get(p.id);
      if (p.id === PRIMARY_ID || !r || r.deleted || r.name === p.name) return p;
      const free = [2, 3, 4, 5, 6].find((id) => !taken().has(id));
      if (!free) return p;
      untracked(() => moveProfileData(p.id, free));
      meta.profileTimes[free] = meta.profileTimes[p.id] ?? now();
      meta.data[free] = meta.data[p.id];
      delete meta.profileTimes[p.id];
      delete meta.data[p.id];
      return { ...p, id: free };
    });
  }

  const ids = new Set([...remote.keys(), ...local.map((p) => p.id), ...Object.keys(meta.profileTombstones).map(Number)]);
  const result: Profile[] = [];
  const push: ProfileRow[] = [];
  for (const id of ids) {
    const l = local.find((p) => p.id === id);
    const r = remote.get(id);
    const lt = l ? meta.profileTimes[id] ?? 0 : meta.profileTombstones[id] ?? -1;
    const rt = r ? r.updated_at : -1;
    if (r && rt > lt) {
      if (r.deleted && id !== PRIMARY_ID) {
        if (l) dropLocalProfile(id);
        meta.profileTombstones[id] = rt;
        delete meta.profileTimes[id];
      } else if (!r.deleted) {
        result.push(fromRow(r));
        meta.profileTimes[id] = rt;
        delete meta.profileTombstones[id];
      }
    } else {
      if (l) result.push(l);
      if (l && (!r || lt > rt)) push.push(toRow(l, lt || 1)); // untouched defaults lose to real edits
      else if (!l && r && !r.deleted && lt > rt) push.push({ ...r, deleted: true, updated_at: lt });
    }
  }
  if (!result.some((p) => p.id === PRIMARY_ID)) {
    result.push(local.find((p) => p.id === PRIMARY_ID) ?? { id: PRIMARY_ID, name: 'Main', color: AVATAR_COLORS[0], addonMode: 'own' });
  }
  result.sort((a, b) => a.id - b.id);
  const profiles = result.slice(0, MAX_PROFILES);
  const activeId = useProfiles.getState().activeId;
  const modeBefore = useProfiles.getState().profiles.find((p) => p.id === activeId)?.addonMode;
  untracked(() => useProfiles.setState({ profiles }));
  const active = profiles.find((p) => p.id === activeId);
  if (!active) activateProfile(PRIMARY_ID);
  // Another device switched this profile between its own and Main's addons: reload the list.
  else if (active.addonMode !== modeBefore) activateProfile(activeId);

  await upsert(sb, 'mp_profiles', push.map((r) => ({ ...r, user_id: userId })), 'user_id,profile_id');
  meta.linkedUserId = userId;
  saveMeta();
}

// ---------- Active profile's library, settings and addons ----------

async function syncLibrary(sb: SupabaseClient, userId: string, profileId: number) {
  const { data, error } = await sb
    .from('mp_library')
    .select('item_id,data,deleted,updated_at')
    .eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  const remote = new Map((data as LibraryRow[]).map((r) => [r.item_id, r]));
  const m = profileMeta(profileId);
  const items = { ...useLibrary.getState().items };
  let dirty = false;

  for (const r of remote.values()) {
    const lt = Math.max(m.items[r.item_id] ?? 0, m.tombstones[r.item_id] ?? 0);
    if (r.updated_at <= lt) continue;
    if (r.deleted || !r.data) {
      if (items[r.item_id]) (delete items[r.item_id], (dirty = true));
      m.tombstones[r.item_id] = r.updated_at;
      delete m.items[r.item_id];
    } else {
      items[r.item_id] = r.data;
      dirty = true;
      m.items[r.item_id] = r.updated_at;
      delete m.tombstones[r.item_id];
    }
  }
  if (dirty) untracked(() => useLibrary.setState({ items }));

  const push: object[] = [];
  for (const [id, item] of Object.entries(items)) {
    // Items saved before sync existed get their own timestamps as a stand-in.
    const lt = (m.items[id] ??= item.state.lastWatched ?? item.addedAt ?? 1);
    const r = remote.get(id);
    if (!r || lt > r.updated_at) push.push({ item_id: id, data: item, deleted: false, updated_at: lt });
  }
  for (const [id, t] of Object.entries(m.tombstones)) {
    const r = remote.get(id);
    if (r && !r.deleted && t > r.updated_at) push.push({ item_id: id, data: null, deleted: true, updated_at: t });
  }
  saveMeta();
  await upsert(
    sb,
    'mp_library',
    push.map((r) => ({ ...r, user_id: userId, profile_id: profileId })),
    'user_id,profile_id,item_id',
  );
}

async function syncDocuments(sb: SupabaseClient, userId: string, profileId: number) {
  const owner = addonsOwner(profileId);
  const { data, error } = await sb
    .from('mp_profile_data')
    .select('profile_id,kind,data,updated_at')
    .in('profile_id', [...new Set([profileId, owner])]);
  if (error) throw new Error(error.message);
  const rows = data as DataRow[];
  const push: DataRow[] = [];

  // Settings: the whole document, newest wins.
  const sm = profileMeta(profileId);
  const rs = rows.find((r) => r.profile_id === profileId && r.kind === 'settings');
  if (rs && rs.updated_at > sm.settingsAt) {
    untracked(() => useSettings.setState({ ...DEFAULT_SETTINGS, ...(rs.data as Partial<Settings>) }));
    sm.settingsAt = rs.updated_at;
  } else if (!rs || sm.settingsAt > rs.updated_at) {
    push.push({ profile_id: profileId, kind: 'settings', data: settingsData(useSettings.getState()), updated_at: sm.settingsAt || 1 });
  }

  // Addons: the owner's list (Main's, for profiles that share it).
  const am = profileMeta(owner);
  const ra = rows.find((r) => r.profile_id === owner && r.kind === 'addons');
  if (ra && ra.updated_at > am.addonsAt && Array.isArray(ra.data) && ra.data.length) {
    untracked(() => useAddons.setState({ addons: ra.data as ReturnType<typeof useAddons.getState>['addons'] }));
    am.addonsAt = ra.updated_at;
  } else if (!ra || am.addonsAt > ra.updated_at) {
    push.push({ profile_id: owner, kind: 'addons', data: useAddons.getState().addons, updated_at: am.addonsAt || 1 });
  }

  saveMeta();
  await upsert(sb, 'mp_profile_data', push.map((r) => ({ ...r, user_id: userId })), 'user_id,profile_id,kind');
}

/** One full sync pass: profiles, then the active profile's data. */
export async function syncAll(sb: SupabaseClient, userId: string) {
  await syncProfiles(sb, userId);
  const profileId = useProfiles.getState().activeId;
  await syncLibrary(sb, userId, profileId);
  await syncDocuments(sb, userId, profileId);
  loadMeta().lastSyncedAt = now();
  saveMeta();
}
