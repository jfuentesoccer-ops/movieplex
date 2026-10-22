import { untracked } from '../sync/tracking';
import { useAddons } from './addons';
import { useLibrary } from './library';
import { ADDONS_KEY, scopedKey, SCOPED_KEYS } from './profileScope';
import { PRIMARY_ID, useProfiles } from './profiles';
import { useSettings } from './settings';

const SCOPED_STORES = [useAddons, useLibrary, useSettings];

/**
 * Points every per-profile store at the given profile's data: stored data is loaded,
 * and a profile without any yet starts from defaults.
 */
export function activateProfile(id: number) {
  // Loading another profile's data isn't an edit, so sync mustn't treat it as one.
  untracked(() => {
    useProfiles.getState().setActive(id);
    for (const store of SCOPED_STORES) {
      const name = store.persist.getOptions().name!;
      if (localStorage.getItem(scopedKey(name)) !== null) store.persist.rehydrate();
      // Replacing with the initial state also writes it to the new profile's key.
      else (store.setState as (s: unknown, replace: true) => void)(store.getInitialState(), true);
    }
  });
}

/** Switching a profile to its own addons starts it from a copy of the main profile's list. */
export function setAddonMode(id: number, mode: 'own' | 'shared') {
  const own = `${ADDONS_KEY}.p${id}`;
  if (mode === 'own' && localStorage.getItem(own) === null) {
    const main = localStorage.getItem(ADDONS_KEY);
    if (main !== null) localStorage.setItem(own, main);
  }
  useProfiles.getState().update(id, { addonMode: mode });
  if (useProfiles.getState().activeId === id) activateProfile(id);
}

/** Deletes a secondary profile and everything stored for it. */
export function deleteProfile(id: number) {
  const s = useProfiles.getState();
  if (id === PRIMARY_ID || id === s.activeId) return;
  for (const key of SCOPED_KEYS) localStorage.removeItem(`${key}.p${id}`);
  s.remove(id);
}

/** Renumbers a secondary profile's stored data (used when an account already has that id). */
export function moveProfileData(from: number, to: number) {
  if (from === PRIMARY_ID || to === PRIMARY_ID) return;
  for (const key of SCOPED_KEYS) {
    const value = localStorage.getItem(`${key}.p${from}`);
    if (value !== null) localStorage.setItem(`${key}.p${to}`, value);
    localStorage.removeItem(`${key}.p${from}`);
  }
}
