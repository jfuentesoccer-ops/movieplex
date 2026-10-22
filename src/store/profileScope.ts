import { createJSONStorage } from 'zustand/middleware';
import { activeProfile, PRIMARY_ID, useProfiles } from './profiles';

// Per-profile persistence: each store keeps its usual localStorage key for the main profile
// (so existing data stays put) and a ".p<id>" suffixed key for every other profile.

export const ADDONS_KEY = 'movieplex.addons';
export const SCOPED_KEYS = [ADDONS_KEY, 'movieplex.library', 'movieplex.settings'];

export function scopedKey(name: string, profileId = useProfiles.getState().activeId) {
  const profile = useProfiles.getState().profiles.find((p) => p.id === profileId);
  // Profiles that share addons read and write the main profile's list.
  const owner = name === ADDONS_KEY && profile?.addonMode === 'shared' ? PRIMARY_ID : profileId;
  return owner === PRIMARY_ID ? name : `${name}.p${owner}`;
}

export const profileStorage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(scopedKey(name)),
  setItem: (name: string, value: string) => localStorage.setItem(scopedKey(name), value),
  removeItem: (name: string) => localStorage.removeItem(scopedKey(name)),
}));

/** True when the active profile uses the main profile's addons (it can't change them). */
export function addonsReadOnly() {
  return activeProfile().addonMode === 'shared';
}
