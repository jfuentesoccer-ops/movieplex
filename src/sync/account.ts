import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { syncAll, startTracking } from './engine';
import { loadMeta } from './meta';

// Optional MoviePlex accounts (Supabase). Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// the app stays local-only and none of this loads.

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const accountsConfigured = !!URL && !!KEY && !URL.includes('your-project-ref');

const PERIODIC_MS = 2 * 60 * 1000;
const FOCUS_MIN_GAP_MS = 30 * 1000;

type AccountState = {
  ready: boolean;
  user: { id: string; email: string } | null;
  status: 'idle' | 'syncing' | 'error';
  error?: string;
  lastSyncedAt?: number;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
};

let clientPromise: Promise<SupabaseClient> | null = null;

function client(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'movieplex.auth', detectSessionInUrl: false },
    }),
  );
  return clientPromise;
}

let running: Promise<void> | null = null;
let again = false;

export const useAccount = create<AccountState>((set, get) => ({
  ready: !accountsConfigured,
  user: null,
  status: 'idle',
  lastSyncedAt: loadMeta().lastSyncedAt,

  signIn: async (email, password) => {
    const sb = await client();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },

  signUp: async (email, password) => {
    const sb = await client();
    const { data, error } = await sb.auth.signUp({ email, password });
    // With "Confirm email" on, there's no session until the emailed link is opened.
    return { error: error ? error.message : null, needsConfirmation: !error && !data.session };
  },

  signOut: async () => {
    const sb = await client();
    await sb.auth.signOut();
    // Local data stays on this device; it keeps working offline and merges on next sign-in.
    set({ user: null, status: 'idle', error: undefined });
  },

  syncNow: async () => {
    const user = get().user;
    if (!user) return;
    if (running) {
      again = true;
      return running;
    }
    set({ status: 'syncing', error: undefined });
    running = (async () => {
      try {
        await syncAll(await client(), user.id);
        set({ status: 'idle', lastSyncedAt: loadMeta().lastSyncedAt });
      } catch (err) {
        set({ status: 'error', error: (err as Error).message });
      } finally {
        running = null;
        if (again) {
          again = false;
          void get().syncNow();
        }
      }
    })();
    return running;
  },
}));

let lastFocusSync = 0;

/** Starts change tracking and, when accounts are configured, restores the session and syncs. */
export function initAccount() {
  const sync = () => void useAccount.getState().syncNow();
  startTracking(sync);
  if (!accountsConfigured) return;

  client().then((sb) => {
    sb.auth.onAuthStateChange((event, session) => {
      const user = session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null;
      useAccount.setState({ user, ready: true });
      if (user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(sync, 0);
    });
  });

  setInterval(sync, PERIODIC_MS);
  window.addEventListener('focus', () => {
    if (Date.now() - lastFocusSync < FOCUS_MIN_GAP_MS) return;
    lastFocusSync = Date.now();
    sync();
  });
}
