import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MetaPreview, PosterShape } from '../addons/types';
import { profileStorage } from './profileScope';

export type LibraryItem = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: PosterShape;
  background?: string;
  logo?: string;
  /** In the user's library (vs. only tracked for Continue Watching). */
  inLibrary: boolean;
  addedAt: number;
  state: {
    /** Last played video (episode id for series). */
    videoId?: string;
    timeOffset: number;
    duration: number;
    lastWatched?: number;
    /** Video ids that were watched to the end. */
    watched: string[];
    /** Hidden from Continue Watching by the user. */
    dismissed?: boolean;
  };
};

type LibraryState = {
  items: Record<string, LibraryItem>;
  toggle: (meta: MetaPreview) => void;
  add: (meta: MetaPreview) => void;
  remove: (id: string) => void;
  updateProgress: (
    meta: MetaPreview,
    videoId: string,
    timeOffset: number,
    duration: number,
  ) => void;
  setWatched: (meta: MetaPreview, videoId: string, watched: boolean) => void;
  dismissContinue: (id: string) => void;
  clearHistory: () => void;
  clearAll: () => void;
};

const WATCHED_RATIO = 0.9;

function fromMeta(meta: MetaPreview, existing?: LibraryItem): LibraryItem {
  return {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster ?? existing?.poster,
    posterShape: meta.posterShape ?? existing?.posterShape,
    background: meta.background ?? existing?.background,
    logo: meta.logo ?? existing?.logo,
    inLibrary: existing?.inLibrary ?? false,
    addedAt: existing?.addedAt ?? Date.now(),
    state: existing?.state ?? { timeOffset: 0, duration: 0, watched: [] },
  };
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      items: {},

      toggle: (meta) => {
        const item = get().items[meta.id];
        if (item?.inLibrary) get().remove(meta.id);
        else get().add(meta);
      },

      add: (meta) =>
        set((s) => ({
          items: {
            ...s.items,
            [meta.id]: { ...fromMeta(meta, s.items[meta.id]), inLibrary: true, addedAt: Date.now() },
          },
        })),

      remove: (id) =>
        set((s) => {
          const item = s.items[id];
          if (!item) return s;
          const items = { ...s.items };
          // Keep watch history so Continue Watching and watched marks survive.
          if (item.state.lastWatched) items[id] = { ...item, inLibrary: false };
          else delete items[id];
          return { items };
        }),

      updateProgress: (meta, videoId, timeOffset, duration) =>
        set((s) => {
          const base = fromMeta(meta, s.items[meta.id]);
          const finished = duration > 0 && timeOffset / duration >= WATCHED_RATIO;
          const watched = finished
            ? [...new Set([...base.state.watched, videoId])]
            : base.state.watched;
          return {
            items: {
              ...s.items,
              [meta.id]: {
                ...base,
                state: {
                  videoId,
                  timeOffset: finished ? 0 : timeOffset,
                  duration,
                  lastWatched: Date.now(),
                  watched,
                  dismissed: false,
                },
              },
            },
          };
        }),

      setWatched: (meta, videoId, watched) =>
        set((s) => {
          const base = fromMeta(meta, s.items[meta.id]);
          const list = watched
            ? [...new Set([...base.state.watched, videoId])]
            : base.state.watched.filter((v) => v !== videoId);
          return {
            items: {
              ...s.items,
              [meta.id]: {
                ...base,
                state: { ...base.state, watched: list, lastWatched: base.state.lastWatched ?? Date.now() },
              },
            },
          };
        }),

      dismissContinue: (id) =>
        set((s) => {
          const item = s.items[id];
          if (!item) return s;
          return { items: { ...s.items, [id]: { ...item, state: { ...item.state, dismissed: true } } } };
        }),

      clearHistory: () =>
        set((s) => {
          const items: Record<string, LibraryItem> = {};
          for (const [id, item] of Object.entries(s.items)) {
            if (item.inLibrary)
              items[id] = { ...item, state: { timeOffset: 0, duration: 0, watched: [] } };
          }
          return { items };
        }),

      clearAll: () => set({ items: {} }),
    }),
    { name: 'movieplex.library', version: 1, storage: profileStorage },
  ),
);

export function continueWatching(items: Record<string, LibraryItem>): LibraryItem[] {
  return Object.values(items)
    .filter((i) => i.state.lastWatched && i.state.timeOffset > 0 && !i.state.dismissed)
    .sort((a, b) => (b.state.lastWatched ?? 0) - (a.state.lastWatched ?? 0));
}

export function itemToMeta(item: LibraryItem): MetaPreview {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    poster: item.poster,
    posterShape: item.posterShape,
    background: item.background,
    logo: item.logo,
  };
}
