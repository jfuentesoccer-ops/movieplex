import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Profiles live on this device. Each profile has its own library, watch history and
// settings; addons are either the profile's own or shared from the main profile.

export type AddonMode = 'own' | 'shared';

export type Profile = {
  id: number;
  name: string;
  color: string;
  addonMode: AddonMode;
  /** Salted SHA-256 of a 4-digit PIN. */
  pin?: { salt: string; hash: string };
};

export const MAX_PROFILES = 6;
export const PRIMARY_ID = 1;
export const AVATAR_COLORS = ['#8b5cf6', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:11470';

type ProfilesState = {
  profiles: Profile[];
  activeId: number;
  /** Skip "Who's watching?" when there's nothing to choose. */
  rememberLast: boolean;
  /** Device-wide: the Stremio-compatible streaming server used for torrents. */
  streamingServerUrl: string;
  /** A profile was chosen in this app session (not persisted). */
  chosen: boolean;
  add: (profile: Omit<Profile, 'id'>) => Profile;
  update: (id: number, patch: Partial<Omit<Profile, 'id'>>) => void;
  remove: (id: number) => void;
  setActive: (id: number) => void;
  setRememberLast: (v: boolean) => void;
  setStreamingServerUrl: (url: string) => void;
};

/** The server address used to live in settings; carry a customised one over. */
function legacyServerUrl(): string {
  try {
    return JSON.parse(localStorage.getItem('movieplex.settings') ?? '{}')?.state?.streamingServerUrl || DEFAULT_SERVER_URL;
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

export const useProfiles = create<ProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [{ id: PRIMARY_ID, name: 'Main', color: AVATAR_COLORS[0], addonMode: 'own' }],
      activeId: PRIMARY_ID,
      rememberLast: true,
      streamingServerUrl: legacyServerUrl(),
      chosen: false,

      add: (profile) => {
        const used = new Set(get().profiles.map((p) => p.id));
        let id = PRIMARY_ID + 1;
        while (used.has(id)) id++;
        const created = { ...profile, id };
        set((s) => ({ profiles: [...s.profiles, created] }));
        return created;
      },
      update: (id, patch) =>
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) =>
        set((s) => ({ profiles: id === PRIMARY_ID ? s.profiles : s.profiles.filter((p) => p.id !== id) })),
      setActive: (id) => set({ activeId: id, chosen: true }),
      setRememberLast: (rememberLast) => set({ rememberLast }),
      setStreamingServerUrl: (streamingServerUrl) => set({ streamingServerUrl }),
    }),
    {
      name: 'movieplex.profiles',
      version: 1,
      partialize: ({ profiles, activeId, rememberLast, streamingServerUrl }) => ({
        profiles,
        activeId,
        rememberLast,
        streamingServerUrl,
      }),
    },
  ),
);

export function activeProfile(): Profile {
  const s = useProfiles.getState();
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0];
}

/** Whether to ask "Who's watching?" at launch. */
export function needsPicker(s: Pick<ProfilesState, 'profiles' | 'rememberLast'>) {
  return s.profiles.length > 1 || s.profiles.some((p) => p.pin) || !s.rememberLast;
}

/** Black or white initial, whichever reads better on the avatar color. */
export function avatarTextColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111111' : '#ffffff';
}

// A session that starts without the picker has effectively chosen its profile, so adding a
// second profile (or a PIN) mid-session doesn't send the user to "Who's watching?".
if (!needsPicker(useProfiles.getState())) useProfiles.setState({ chosen: true });
