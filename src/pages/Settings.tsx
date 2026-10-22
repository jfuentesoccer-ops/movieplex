import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccountPanel } from '../components/Account';
import { Select, Spinner, Toggle } from '../components/Common';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { Avatar, ProfileEditor } from '../components/Profiles';
import { languageName, SUBTITLE_LANGUAGE_OPTIONS } from '../lib/languages';
import { ACCENTS, accentColors, isCustomAccent, MODES } from '../lib/colors';
import { checkServer } from '../lib/streamingServer';
import { useAddons } from '../store/addons';
import { addonsReadOnly } from '../store/profileScope';
import { DEFAULT_SERVER_URL, MAX_PROFILES, Profile, PRIMARY_ID, useProfiles } from '../store/profiles';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';
import { APP_VERSION, checkForUpdates, installUpdate, useUpdates } from '../lib/updates';

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="settings-section" id={id}>
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Option({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="option">
      <div>
        <div className="option-label">{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="option-control">{children}</div>
    </div>
  );
}

const SECTIONS = [
  ['account', 'Account'],
  ['profiles', 'Profiles'],
  ['appearance', 'Appearance'],
  ['interface', 'Interface'],
  ['player', 'Player'],
  ['server', 'Streaming'],
  ['data', 'Data'],
  ['about', 'About'],
] as const;

export default function Settings() {
  const s = useSettings();
  const resetAddons = useAddons((a) => a.resetToDefaults);
  const { clearHistory, clearAll } = useLibrary();
  const device = useProfiles();
  const activeProfile = device.profiles.find((p) => p.id === device.activeId);
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [serverUrl, setServerUrl] = useState(device.streamingServerUrl);
  const [server, setServer] = useState<'checking' | 'online' | 'offline'>('checking');
  const [params] = useSearchParams();

  // e.g. #/settings?section=profiles from the profile menu.
  useEffect(() => {
    const section = params.get('section');
    if (section) document.getElementById(section)?.scrollIntoView();
  }, [params]);

  const check = useCallback(async (url: string) => {
    setServer('checking');
    setServer((await checkServer(url)) ? 'online' : 'offline');
  }, []);

  useEffect(() => {
    check(device.streamingServerUrl);
  }, [check, device.streamingServerUrl]);

  return (
    <div className="page settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="settings-body">
          <Section title="Account" id="account">
            <AccountPanel />
          </Section>

          <Section title="Profiles" id="profiles">
            <div className="profile-list">
              {device.profiles.map((p) => (
                <div key={p.id} className="profile-row">
                  <Avatar profile={p} size={44} />
                  <div className="profile-row-text">
                    <div className="strong">
                      {p.name}
                      {p.id === device.activeId && <span className="badge">Current</span>}
                    </div>
                    <div className="muted small">
                      {[
                        p.id === PRIMARY_ID ? 'Main profile · owns the addons' : p.addonMode === 'shared' ? 'Uses Main’s addons' : 'Own addons',
                        p.pin ? 'PIN lock' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <button className="btn small glass" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
            <div className="profile-actions">
              <button
                className="btn small glass"
                disabled={device.profiles.length >= MAX_PROFILES}
                onClick={() => setEditing('new')}
              >
                <Icon name="plus" size={16} /> Add profile
              </button>
              <span className="muted small">
                Up to {MAX_PROFILES} profiles, each with its own library, watch history and settings.
              </span>
            </div>
            <Option label="Ask who’s watching on launch" hint="Always shown when there’s more than one profile or a PIN.">
              <Toggle checked={!device.rememberLast} onChange={(v) => device.setRememberLast(!v)} />
            </Option>
            {editing && (
              <ProfileEditor profile={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
            )}
          </Section>

          <Section title="Appearance" id="appearance">
            <Option label="Mode">
              <div className="segmented" role="radiogroup" aria-label="Mode">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={s.appearance.mode === m.id}
                    className={s.appearance.mode === m.id ? 'active' : ''}
                    onClick={() => s.set('appearance', { ...s.appearance, mode: m.id })}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </Option>
            <Option label="Accent color" hint="Buttons, highlights and progress bars.">
              <div className="accent-swatches" role="radiogroup" aria-label="Accent color">
                {ACCENTS.map((a) => {
                  const { from, to } = accentColors(a.id, s.appearance.mode);
                  const active = s.appearance.accent === a.id;
                  return (
                    <button
                      key={a.id}
                      role="radio"
                      aria-checked={active}
                      aria-label={a.name}
                      title={a.name}
                      className={`accent-swatch ${active ? 'active' : ''}`}
                      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                      onClick={() => s.set('appearance', { ...s.appearance, accent: a.id })}
                    />
                  );
                })}
                <label
                  className={`accent-swatch custom ${isCustomAccent(s.appearance.accent) ? 'active' : ''}`}
                  title="Custom color"
                  style={
                    isCustomAccent(s.appearance.accent)
                      ? { background: `linear-gradient(135deg, ${accentColors(s.appearance.accent, s.appearance.mode).from}, ${accentColors(s.appearance.accent, s.appearance.mode).to})` }
                      : undefined
                  }
                >
                  <input
                    type="color"
                    aria-label="Custom accent color"
                    value={isCustomAccent(s.appearance.accent) ? s.appearance.accent : '#8b5cf6'}
                    onChange={(e) => s.set('appearance', { ...s.appearance, accent: e.target.value })}
                  />
                  {!isCustomAccent(s.appearance.accent) && <Icon name="plus" size={16} />}
                </label>
              </div>
            </Option>
          </Section>

          <Section title="Interface" id="interface">
            <Option label="Featured hero on Board" hint="Show the rotating spotlight at the top of the Board.">
              <Toggle checked={s.showHero} onChange={(v) => s.set('showHero', v)} />
            </Option>
            <Option label="Hide spoilers" hint="Blur thumbnails and summaries of unwatched episodes.">
              <Toggle checked={s.hideSpoilers} onChange={(v) => s.set('hideSpoilers', v)} />
            </Option>
            <Option label="Language">
              <Select value="en" onChange={() => undefined} options={[{ value: 'en', label: 'English' }]} />
            </Option>
          </Section>

          <Section title="Player" id="player">
            <Option label="Auto-play next episode" hint="Uses a stream from the same source when available.">
              <Toggle checked={s.autoplayNext} onChange={(v) => s.set('autoplayNext', v)} />
            </Option>
            <Option
              label="Skip intro buttons"
              hint="Shows Skip Intro and Skip Recap, and offers the next episode when the credits start. Timings come from IntroDB."
            >
              <Toggle checked={s.skipButtons} onChange={(v) => s.set('skipButtons', v)} />
            </Option>
            <Option label="Skip intros automatically" hint="Jumps past intros and recaps without asking.">
              <Toggle checked={s.autoSkipIntro} onChange={(v) => s.set('autoSkipIntro', v)} />
            </Option>
            <Option label="Preferred audio language" hint="Used when a stream has more than one audio track.">
              <Select
                value={s.audioLanguage}
                onChange={(v) => s.set('audioLanguage', v)}
                options={[
                  { value: '', label: 'Original (the file’s default)' },
                  ...SUBTITLE_LANGUAGE_OPTIONS.filter((c) => c !== 'pob').map((c) => ({ value: c, label: languageName(c) })),
                ]}
              />
            </Option>
            <Option label="Default subtitle language">
              <Select
                value={s.subtitleLanguage}
                onChange={(v) => s.set('subtitleLanguage', v)}
                options={[
                  { value: '', label: 'Off' },
                  ...SUBTITLE_LANGUAGE_OPTIONS.map((c) => ({ value: c, label: languageName(c) })),
                ]}
              />
            </Option>
            <Option label="Subtitle size">
              <div className="range-row">
                <input
                  type="range"
                  min={50}
                  max={250}
                  step={10}
                  value={s.subtitleSize}
                  onChange={(e) => s.set('subtitleSize', +e.target.value)}
                />
                <span className="mono">{s.subtitleSize}%</span>
              </div>
            </Option>
            <Option label="Subtitle color">
              <div className="swatches">
                {['#ffffff', '#ffe14d', '#7df9ff', '#a0ff8a'].map((c) => (
                  <button
                    key={c}
                    className={`swatch ${s.subtitleColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => s.set('subtitleColor', c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </Option>
            <Option label="Subtitle background">
              <div className="range-row">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={s.subtitleBackground}
                  onChange={(e) => s.set('subtitleBackground', +e.target.value)}
                />
                <span className="mono">{Math.round(s.subtitleBackground * 100)}%</span>
              </div>
            </Option>
            <div className="subtitle-preview">
              <span
                style={{
                  color: s.subtitleColor,
                  background: `rgba(0,0,0,${s.subtitleBackground})`,
                  fontSize: `${22 * (s.subtitleSize / 100)}px`,
                }}
              >
                This is how subtitles will look.
              </span>
            </div>
            <Option label="Seek step">
              <Select
                value={String(s.seekStep)}
                onChange={(v) => s.set('seekStep', +v)}
                options={[5, 10, 15, 30].map((n) => ({ value: String(n), label: `${n} seconds` }))}
              />
            </Option>
            <Option label="Default playback speed">
              <Select
                value={String(s.playbackSpeed)}
                onChange={(v) => s.set('playbackSpeed', +v)}
                options={[0.75, 1, 1.25, 1.5].map((n) => ({ value: String(n), label: n === 1 ? 'Normal' : `${n}×` }))}
              />
            </Option>
            <div className="muted small shortcuts">
              Shortcuts: <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> seek · <kbd>↑</kbd>/<kbd>↓</kbd> volume ·{' '}
              <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute · <kbd>S</kbd> skip intro · <kbd>G</kbd>/<kbd>H</kbd> subtitle delay
            </div>
          </Section>

          <Section title="Streaming server" id="server">
            <Option
              label="Server address"
              hint="Torrent streams play through a Stremio-compatible streaming server (e.g. Stremio Service)."
            >
              <form
                className="row-gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  device.setStreamingServerUrl(serverUrl.trim().replace(/\/$/, ''));
                  check(serverUrl.trim());
                }}
              >
                <input className="input small" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
                <button className="btn small glass">Save</button>
              </form>
            </Option>
            <Option label="Status">
              <span className={`status ${server}`}>
                {server === 'checking' ? <Spinner size={14} /> : <span className="dot" />}
                {server === 'online' ? 'Online' : server === 'offline' ? 'Not available' : 'Checking…'}
              </span>
              <button className="icon-btn ghost" onClick={() => check(device.streamingServerUrl)} title="Check again">
                <Icon name="refresh" size={18} />
              </button>
            </Option>
            <p className="muted small server-note">Shared by all profiles on this device.</p>
            {serverUrl !== DEFAULT_SERVER_URL && (
              <button className="btn small glass" onClick={() => setServerUrl(DEFAULT_SERVER_URL)}>
                Use default address
              </button>
            )}
          </Section>

          <Section title="Data" id="data">
            <p className="muted small data-note">These apply to the current profile{activeProfile ? ` (${activeProfile.name})` : ''}.</p>
            <Option label="Clear watch history" hint="Removes progress and watched marks. Keeps your library.">
              <button
                className="btn small glass"
                onClick={() => {
                  if (confirm('Clear all watch history?')) {
                    clearHistory();
                    toast('Watch history cleared');
                  }
                }}
              >
                Clear
              </button>
            </Option>
            <Option label="Clear library" hint="Removes every title from your library and history.">
              <button
                className="btn small danger"
                onClick={() => {
                  if (confirm('Remove everything from your library?')) {
                    clearAll();
                    toast('Library cleared');
                  }
                }}
              >
                Clear
              </button>
            </Option>
            <Option
              label="Reset addons"
              hint={
                addonsReadOnly()
                  ? 'This profile uses Main’s addons, so only Main can reset them.'
                  : 'Restores Cinemeta and OpenSubtitles and removes everything else.'
              }
            >
              <button
                className="btn small danger"
                disabled={addonsReadOnly()}
                onClick={() => {
                  if (confirm('Uninstall all addons and restore the defaults?')) {
                    resetAddons();
                    toast('Addons reset');
                  }
                }}
              >
                Reset
              </button>
            </Option>
            <Option label="Reset settings">
              <button
                className="btn small glass"
                onClick={() => {
                  s.reset();
                  toast('Settings reset');
                }}
              >
                Reset
              </button>
            </Option>
          </Section>

          <Section title="About" id="about">
            <div className="about">
              <LogoMark height={34} />
              <div>
                <div className="strong">MoviePlex {APP_VERSION}</div>
                <div className="muted small">
                  A media center powered by the open Stremio addon protocol. MoviePlex doesn't host any content —
                  everything you see comes from the addons you install.
                </div>
              </div>
            </div>
            <UpdateRow />
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Update status and the matching action (desktop app only). */
function UpdateRow() {
  const update = useUpdates((s) => s.update);
  if (!update || update.state === 'disabled') return null;
  const busy = update.state === 'checking' || update.state === 'downloading';
  const status = {
    idle: 'Checks for updates automatically.',
    checking: 'Checking for updates…',
    latest: 'You have the latest version.',
    available: `Version ${update.version} is available.`,
    downloading: `Downloading version ${update.version}… ${Math.round((update.progress ?? 0) * 100)}%`,
    ready: `Version ${update.version} is ready to install.`,
    error: `Couldn't update: ${update.error}`,
  }[update.state];
  return (
    <Option label="Updates" hint={status}>
      {update.state === 'ready' ? (
        <button className="btn small primary" onClick={installUpdate}>
          Restart to update
        </button>
      ) : update.state === 'available' && update.page ? (
        <button className="btn small primary" onClick={() => window.open(update.page, '_blank')}>
          Download
        </button>
      ) : (
        <button className="btn small" disabled={busy} onClick={() => checkForUpdates()}>
          {busy ? <Spinner size={14} /> : 'Check now'}
        </button>
      )}
    </Option>
  );
}
