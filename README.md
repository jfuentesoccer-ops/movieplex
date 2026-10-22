# MoviePlex

A media center inspired by Stremio and Nuvio, built on the open Stremio addon protocol.
Any Stremio addon works: paste its `manifest.json` URL (https:// or stremio://) on the Addons page.

**Default addons:** Cinemeta (catalogs and metadata, protected) and OpenSubtitles v3 (subtitles).
No account yet: your library, watch progress, addons and settings are stored in the browser (localStorage).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` outputs a static site to `dist/`.

## Accounts and sync (Supabase)

Optional. Without it, MoviePlex works exactly as before and keeps everything on the device. With it, users can
create an account (email + password) and sync profiles, libraries, watch progress, settings and addons between
devices.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard open **SQL Editor › New query**, paste `supabase/schema.sql`, and click **Run**. It creates
   three tables (`mp_profiles`, `mp_profile_data`, `mp_library`) with row-level security so each user can only
   read and write their own rows.
3. In **Project Settings › API**, copy the **Project URL** and the **anon public** key into a new `.env.local`
   file (see `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   The anon key is meant to ship inside apps; row-level security is what protects the data. Never use the
   `service_role` key here.
4. Restart `npm run dev`, or rebuild the desktop app (`npm run dist:mac`). The key is built into the app.
5. Email confirmation: Supabase requires new users to confirm their email by default. The link opens your
   project's Site URL (**Authentication › URL Configuration**). After confirming, sign in from MoviePlex. To skip
   confirmation while testing, turn off **Authentication › Sign In / Providers › Email › Confirm email**.

How sync works: every change is stamped with its time and the newer side wins, per profile, per library title,
and per settings/addon list. Edits on two devices to different titles merge. Deletions sync too. Sync runs on
sign-in, a few seconds after changes, when the window regains focus, every 2 minutes, and from **Sync now** in
Settings › Account. Signing out keeps the data on the device.

Not included yet: password reset, and Google/Apple sign-in.

## Desktop app (Electron)

| Command | What it does |
| --- | --- |
| `npm run desktop:dev` | Vite dev server + Electron window with hot reload |
| `npm run desktop` | Builds the web app and opens it in Electron |
| `npm run dist:mac` | Builds `release/MoviePlex-<version>-arm64.dmg` and `.zip` for Apple Silicon Macs (M1 and newer) |
| `npm run dist:win` / `dist:linux` | Windows installer (NSIS) / AppImage + .deb |

- The renderer is the same build as the web app, served from a private `app://movieplex` origin.
  It runs sandboxed with context isolation and no Node.js access (see `electron/`).
- `movieplex://` deep links: `movieplex://host/path/manifest.json` opens the install dialog for
  `https://host/path/manifest.json`; `movieplex:///detail/movie/tt0111161` opens that page.
- Native menu with Go shortcuts (⌘1–5, ⌘, for Settings, ⌘F for Search) and File › Install Addon… (⇧⌘A).
- External links (addon configure pages, IMDb) open in the default browser. Window size and position are remembered.
- `npm run icons` regenerates the app icon (`build/icon.png`), the favicon and the in-app logo pieces
  (`public/logo-mark.png`, `public/logo-word.png`) from the logo artwork in `build/logo-source.webp`.
- macOS builds are unsigned (`mac.identity: null`). Locally built copies run as-is; copies downloaded
  elsewhere need right-click › Open the first time, or set up code signing and notarization before distributing.
- Torrent streams still need a separate Stremio-compatible streaming server (e.g. Stremio Service); it is not bundled.
- Audio conversion: the built-in player can't decode Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3), DTS or
  TrueHD. The desktop app checks each stream with a bundled ffmpeg and, when needed, plays it through ffmpeg: video
  copied as-is, the audio converted to stereo AAC (`electron/transcode.cjs`). Files with several audio tracks also
  get a track menu. ffmpeg only reads http(s) URLs and serves through one-time loopback links.
- ffmpeg is GPL-3.0 (from the `ffmpeg-static` package; its license is in
  `node_modules/ffmpeg-static/ffmpeg.LICENSE`). If you distribute MoviePlex, include that license and a link to
  the ffmpeg source (https://ffmpeg.org/download.html).
- Chromecast needs macOS Local Network access. The packaged app asks for it the first time you open the cast
  menu. The development copy (`desktop:dev`) can't get that permission, so casting only works in the packaged app
  on macOS.
- Casting sends the stream URL to the TV, so the TV must be able to reach it: links that need special headers or
  only work on this computer won't play. HLS streams also need CORS headers on their server.

## Updates (GitHub Releases)

The Mac app updates itself from a public GitHub repo (`electron/updater.cjs`): it checks 10 s
after launch and every 6 hours, downloads the new version in the background, verifies its SHA-256,
and offers **Restart now**. Copies only update if they were built with the repo set, so set it up
before sharing the app.

1. Create a public GitHub repo (it can be empty apart from a README) and put its name in
   `package.json` → `"movieplexUpdates": { "repo": "your-name/movieplex" }`.
2. Create a fine-grained token with **Contents: read and write** on that repo.
3. To ship a version: `GH_TOKEN=<token> npm run release -- 0.2.0 "What changed"`
   (leave out the version to bump the patch number). This builds, writes `update.json` and
   publishes the DMG, zip and `update.json` as release `v0.2.0`.

Without `GH_TOKEN` the release script only builds; upload the three files to a new release by hand.

## Features

- **Board**: a featured hero carousel, Continue Watching, and a row for every catalog from every installed addon.
- **Discover**: filter by type, catalog and genre/year, with infinite scrolling (`skip` extra).
- **Search**: searches every catalog that supports the `search` extra.
- **Library & Calendar**: saved titles; upcoming episodes come from Cinemeta's `calendar-videos` catalog.
- **Details**: artwork, logo, cast and trailer. Series get seasons and episodes with watched marks and
  spoiler blur. Streams from all stream addons are grouped by addon.
- **Player**: direct and HLS (hls.js) playback, YouTube streams, and torrents through a Stremio-compatible
  streaming server (default `http://127.0.0.1:11470`, e.g. Stremio Service).
  - Subtitles from addons, the stream itself, or a local .srt/.vtt file, with adjustable delay and size.
  - Audio and quality menus for HLS streams, and playback speed.
  - Resume and progress saving, plus next-episode autoplay: the Up next card counts down 10 seconds (from the
    start of the credits when skip-intro data knows them, otherwise to the end) and starts the next episode, with
    Play now and Cancel. The stream is picked automatically: the same binge group, else the same addon and quality,
    else the same addon, else any addon. Turn it off in Settings › Player.
  - Skip Intro / Skip Recap buttons for series episodes, an optional auto-skip, and the Up next card as soon as the
    credits start. Timings come from [IntroDB](https://introdb.app), a free community database. In a browser this
    needs the dev server's `/introdb` proxy, since IntroDB doesn't allow other sites to call it directly.
  - Keyboard shortcuts.
- **Addons**: installed, official and community lists (from Cinemeta's `addon_catalog`). Install by URL,
  configure, reorder, uninstall, or share. Deep links work: `#/addons?addon=<manifest url>`.
- **Casting**: a cast button in the player.
  - Desktop app: Chromecast built in (finds devices on your Wi-Fi, sends the selected subtitles to the TV).
  - Chrome/Edge: Chromecast through Google's Cast SDK (subtitles aren't sent in the browser).
  - Safari: AirPlay.
  - While casting, the player's controls drive the TV and watch progress keeps saving.
- **Appearance**: Settings › Appearance has a mode (Dark, Light or Black) and an accent color (eight swatches
  or a custom pick). The rest of the palette is derived from those two.
- **Profiles** (like Nuvio's): up to 6 profiles on the device, each with its own library, watch history and
  settings, a colored avatar and an optional 4-digit PIN. "Who's watching?" appears at launch when there's more
  than one profile or a PIN. The main profile owns the addons; other profiles either use Main's addons (read-only)
  or keep their own list. Switch from the avatar in the top bar; manage in Settings › Profiles.
  - Storage: the main profile uses the original `movieplex.*` localStorage keys, other profiles `movieplex.*.p<id>`.
  - PINs are stored as salted SHA-256 hashes. Like Nuvio's, they're a convenience lock, not real security.
- **Settings**: interface, player, subtitle style, streaming server status (shared by all profiles), and data
  reset.
- **Account** (optional): email sign-in with sync through Supabase. See *Accounts and sync* above.

## Layout

```
src/addons/   protocol client (manifest, catalog, meta, stream, subtitles, addon_catalog), default addons
src/store/    zustand stores persisted to localStorage (addons, library, settings)
src/lib/      subtitle parser, streaming server client, helpers
src/pages/    Board, Discover, Library, Search, Calendar, Detail, Player, Addons, Settings
```

MoviePlex hosts no content. Everything shown comes from the addons you install.

## Security

- **Accounts:** Supabase Auth (passwords stored as bcrypt hashes by Supabase). Every table has row-level
  security: a signed-in user can only read and write their own rows, and signed-out visitors can't read
  anything. Size limits and a 10,000-item cap per profile stop one account from filling the database
  (`supabase/schema.sql`).
- **Recommended Supabase settings** (Dashboard → Authentication → Providers → Email): minimum password length
  8 with letters and digits required (the app asks for the same), and *Confirm email* on once you have a custom
  SMTP sender. Leaked-password protection needs the Pro plan.
- **Desktop app:** the page runs sandboxed with context isolation and a strict Content Security Policy (only
  the app's own scripts run, so addon or subtitle content can't execute code). It can't open other sites
  inside the app or use the camera, microphone or location. `movieplex://` links can only open browsing
  pages. ffmpeg only reads http(s) stream addresses.
- **Updates** come only from this repo's GitHub releases and are checked against the SHA-256 in
  `update.json`. Keep two-factor authentication on the GitHub account that publishes them.
- **Profile PINs** are a convenience lock (like Nuvio's), not real security.

## License

MoviePlex is free software under the [GNU General Public License v3.0 or later](LICENSE).

The desktop app bundles [FFmpeg](https://ffmpeg.org) (via `ffmpeg-static`, GPL build) to convert
Dolby/DTS audio. Stremio and Nuvio were used as references for behavior; MoviePlex is not affiliated
with either.
