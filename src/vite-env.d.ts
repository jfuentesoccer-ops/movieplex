/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL for accounts and sync (optional; see README › Accounts). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

/** package.json version, set by vite.config.ts. */
declare const __APP_VERSION__: string;
