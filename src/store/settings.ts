import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Appearance, appearanceFromPalette, DEFAULT_APPEARANCE } from '../lib/colors';
import { profileStorage } from './profileScope';

export type Settings = {
  // Interface
  appearance: Appearance;
  showHero: boolean;
  hideSpoilers: boolean;
  // Player
  autoplayNext: boolean;
  skipButtons: boolean;
  autoSkipIntro: boolean;
  subtitleLanguage: string; // ISO 639-2, or '' for off
  audioLanguage: string; // ISO 639-2, or '' for the file's default track
  subtitleSize: number; // percent
  subtitleColor: string;
  subtitleBackground: number; // 0..1 opacity
  seekStep: number; // seconds
  playbackSpeed: number;
};

type SettingsState = Settings & {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
};

export const DEFAULT_SETTINGS: Settings = {
  appearance: DEFAULT_APPEARANCE,
  showHero: true,
  hideSpoilers: false,
  autoplayNext: true,
  skipButtons: true,
  autoSkipIntro: false,
  subtitleLanguage: 'eng',
  audioLanguage: '',
  subtitleSize: 100,
  subtitleColor: '#ffffff',
  subtitleBackground: 0.5,
  seekStep: 10,
  playbackSpeed: 1,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'movieplex.settings',
      storage: profileStorage,
      version: 4,
      // Earlier versions stored a theme id (v1) or a full palette (v2); both map onto mode + accent.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<Settings> & {
          streamingServerUrl?: string;
          theme?: string;
          colors?: { bg?: string; gradFrom?: string };
        };
        if (version < 3) {
          if (state.colors) state.appearance = appearanceFromPalette(state.colors);
          else if (state.theme)
            state.appearance = {
              mode: state.theme === 'amoled' ? 'black' : ['daylight', 'arctic', 'paper'].includes(state.theme) ? 'light' : 'dark',
              accent: 'violet',
            };
          delete state.colors;
          delete state.theme;
        }
        // v4: the streaming server address moved to device-wide settings (store/profiles.ts).
        delete state.streamingServerUrl;
        return state as Settings;
      },
    },
  ),
);
