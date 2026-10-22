import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clearAddonCache, fetchManifest, normalizeTransportUrl } from '../addons/client';
import { DEFAULT_ADDONS } from '../addons/defaults';
import type { AddonDescriptor, Manifest } from '../addons/types';
import { untracked } from '../sync/tracking';
import { addonsReadOnly, profileStorage } from './profileScope';

type AddonsState = {
  addons: AddonDescriptor[];
  install: (transportUrl: string, manifest?: Manifest) => Promise<AddonDescriptor>;
  uninstall: (transportUrl: string) => void;
  move: (transportUrl: string, delta: -1 | 1) => void;
  refreshManifests: () => Promise<void>;
  resetToDefaults: () => void;
  isInstalled: (transportUrl: string) => boolean;
};

export const useAddons = create<AddonsState>()(
  persist(
    (set, get) => ({
      addons: DEFAULT_ADDONS,

      install: async (input, manifest) => {
        if (addonsReadOnly()) throw new Error('This profile uses the main profile’s addons.');
        const transportUrl = normalizeTransportUrl(input);
        const m = manifest ?? (await fetchManifest(transportUrl));
        const official = DEFAULT_ADDONS.find((d) => d.manifest.id === m.id)?.flags;
        const descriptor: AddonDescriptor = {
          transportUrl,
          transportName: 'http',
          manifest: m,
          flags: official ?? { official: false, protected: false },
        };
        set((s) => {
          // Re-installing an addon with the same id (e.g. after reconfiguring) replaces it in place.
          const idx = s.addons.findIndex((a) => a.manifest.id === m.id || a.transportUrl === transportUrl);
          const addons = [...s.addons];
          if (idx >= 0) addons[idx] = descriptor;
          else addons.push(descriptor);
          return { addons };
        });
        clearAddonCache();
        return descriptor;
      },

      uninstall: (transportUrl) => {
        if (addonsReadOnly()) return;
        set((s) => ({
          addons: s.addons.filter((a) => a.transportUrl !== transportUrl || a.flags?.protected),
        }));
        clearAddonCache();
      },

      move: (transportUrl, delta) =>
        set((s) => {
          if (addonsReadOnly()) return s;
          const idx = s.addons.findIndex((a) => a.transportUrl === transportUrl);
          const to = idx + delta;
          if (idx < 0 || to < 0 || to >= s.addons.length) return s;
          const addons = [...s.addons];
          [addons[idx], addons[to]] = [addons[to], addons[idx]];
          return { addons };
        }),

      refreshManifests: async () => {
        const current = get().addons;
        const updated = await Promise.all(
          current.map(async (a) => {
            try {
              return { ...a, manifest: await fetchManifest(a.transportUrl) };
            } catch {
              return a;
            }
          }),
        );
        // Keep any installs/uninstalls that happened while we were fetching. A manifest refresh
        // isn't a user change, so it mustn't overwrite newer addon lists from other devices.
        untracked(() =>
          set((s) => ({
            addons: s.addons.map((a) => updated.find((u) => u.transportUrl === a.transportUrl) ?? a),
          })),
        );
      },

      resetToDefaults: () => {
        if (addonsReadOnly()) return;
        set({ addons: DEFAULT_ADDONS });
        clearAddonCache();
      },

      isInstalled: (transportUrl) =>
        get().addons.some((a) => a.transportUrl === normalizeTransportUrl(transportUrl)),
    }),
    { name: 'movieplex.addons', version: 1, storage: profileStorage, partialize: (s) => ({ addons: s.addons }) },
  ),
);
