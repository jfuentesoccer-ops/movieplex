import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPin, isValidPin, verifyPin } from '../lib/pin';
import { accountsConfigured, useAccount } from '../sync/account';
import {
  AVATAR_COLORS,
  avatarTextColor,
  MAX_PROFILES,
  PRIMARY_ID,
  Profile,
  useProfiles,
} from '../store/profiles';
import { activateProfile, deleteProfile, setAddonMode } from '../store/switchProfile';
import { toast } from '../store/toast';
import { Modal, Toggle } from './Common';
import { Icon } from './Icon';
import { Logo } from './Logo';

export function Avatar({ profile, size = 38 }: { profile: Pick<Profile, 'name' | 'color'>; size?: number }) {
  return (
    <span
      className="profile-avatar"
      style={{
        width: size,
        height: size,
        background: profile.color,
        color: avatarTextColor(profile.color),
        fontSize: size * 0.44,
      }}
      aria-hidden="true"
    >
      {(profile.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** Switches to a profile, asking for its PIN first when it has one. */
export function useProfileSwitch(onSwitched?: () => void) {
  const [locked, setLocked] = useState<Profile | null>(null);
  const select = (profile: Profile) => {
    const { activeId, chosen } = useProfiles.getState();
    const alreadyUnlocked = profile.id === activeId && chosen;
    if (profile.pin && !alreadyUnlocked) return setLocked(profile);
    activateProfile(profile.id);
    onSwitched?.();
  };
  const prompt = locked && (
    <PinPrompt
      profile={locked}
      onCancel={() => setLocked(null)}
      onUnlock={() => {
        activateProfile(locked.id);
        setLocked(null);
        onSwitched?.();
      }}
    />
  );
  return { select, prompt };
}

export function PinPrompt({
  profile,
  onUnlock,
  onCancel,
}: {
  profile: Profile;
  onUnlock: () => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (pin.length !== 4 || !profile.pin) return;
    verifyPin(pin, profile.pin).then((ok) => {
      if (ok) onUnlock();
      else {
        setError(true);
        setPin('');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <Modal title={null} onClose={onCancel}>
      <div className="pin-prompt">
        <Avatar profile={profile} size={64} />
        <h3>Enter PIN for {profile.name}</h3>
        <PinInput value={pin} onChange={(v) => (setError(false), setPin(v))} autoFocus />
        <p className={`error-text pin-error ${error ? 'visible' : ''}`}>Wrong PIN. Try again.</p>
      </div>
    </Modal>
  );
}

/** Four dots backed by a single numeric input. */
function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="pin-input" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        aria-label="PIN"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      />
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`pin-dot ${i < value.length ? 'filled' : ''} ${i === value.length ? 'current' : ''}`} />
      ))}
    </div>
  );
}

/** Full-screen "Who's watching?" shown at launch when there's a choice to make. */
export function ProfilePicker() {
  const profiles = useProfiles((s) => s.profiles);
  const { select, prompt } = useProfileSwitch(() => {
    window.location.hash = '#/';
  });
  const [creating, setCreating] = useState(false);

  return (
    <div className="profile-picker">
      <div className="profile-picker-logo">
        <Logo />
      </div>
      <h1>Who’s watching?</h1>
      <div className="profile-tiles">
        {profiles.map((p) => (
          <button key={p.id} className="profile-tile" onClick={() => select(p)}>
            <span className="profile-tile-avatar">
              <Avatar profile={p} size={112} />
              {p.pin && (
                <span className="profile-lock" title="Locked with a PIN">
                  <Icon name="lock" size={14} />
                </span>
              )}
            </span>
            <span className="profile-tile-name">{p.name}</span>
          </button>
        ))}
        {profiles.length < MAX_PROFILES && (
          <button className="profile-tile add" onClick={() => setCreating(true)}>
            <span className="profile-add-circle">
              <Icon name="plus" size={40} />
            </span>
            <span className="profile-tile-name">Add profile</span>
          </button>
        )}
      </div>
      {creating && <ProfileEditor onClose={() => setCreating(false)} />}
      {prompt}
    </div>
  );
}

/** Create (no profile) or edit a profile. */
export function ProfileEditor({ profile, onClose }: { profile?: Profile; onClose: () => void }) {
  const { profiles, activeId, add, update } = useProfiles();
  const isPrimary = profile?.id === PRIMARY_ID;
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? AVATAR_COLORS[profiles.length % AVATAR_COLORS.length]);
  const [addonMode, setMode] = useState(profile?.addonMode ?? 'shared');
  const [usePin, setUsePin] = useState(!!profile?.pin);
  const [pin, setPin] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changingPin = usePin && (!profile?.pin || pin.length > 0);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || `Profile ${profile?.id ?? profiles.length + 1}`;
    if (usePin && changingPin && !isValidPin(pin)) return toast('Enter a 4-digit PIN', 'error');
    const pinValue = !usePin ? undefined : changingPin ? await createPin(pin) : profile?.pin;
    if (profile) {
      update(profile.id, { name: finalName, color, pin: pinValue });
      if (!isPrimary && addonMode !== profile.addonMode) setAddonMode(profile.id, addonMode);
    } else {
      const created = add({ name: finalName, color, addonMode, pin: pinValue });
      toast(`${created.name} created`, 'success');
    }
    onClose();
  };

  return (
    <Modal title={profile ? 'Edit profile' : 'Add profile'} onClose={onClose}>
      <form className="stack profile-editor" onSubmit={save}>
        <div className="profile-editor-head">
          <Avatar profile={{ name: name || '?', color }} size={72} />
          <input
            className="input"
            placeholder="Name"
            value={name}
            maxLength={24}
            autoFocus={!profile}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <div className="field-label">Color</div>
          <div className="accent-swatches">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                className={`accent-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        {!isPrimary && (
          <div>
            <div className="field-label">Addons</div>
            <div className="radio-cards">
              <label className={`radio-card ${addonMode === 'shared' ? 'active' : ''}`}>
                <input type="radio" checked={addonMode === 'shared'} onChange={() => setMode('shared')} />
                <span className="strong">Use Main’s addons</span>
                <span className="muted small">Same addons as the main profile. Only Main can change them.</span>
              </label>
              <label className={`radio-card ${addonMode === 'own' ? 'active' : ''}`}>
                <input type="radio" checked={addonMode === 'own'} onChange={() => setMode('own')} />
                <span className="strong">Own addons</span>
                <span className="muted small">A separate addon list this profile manages itself.</span>
              </label>
            </div>
          </div>
        )}

        <div className="option compact">
          <div>
            <div className="option-label">Lock with a PIN</div>
            <div className="muted small">Ask for a 4-digit PIN before opening this profile.</div>
          </div>
          <Toggle checked={usePin} onChange={setUsePin} />
        </div>
        {usePin && (
          <div className="pin-setup">
            <span className="muted small">{profile?.pin ? 'New PIN (leave empty to keep the current one)' : 'PIN'}</span>
            <PinInput value={pin} onChange={setPin} />
          </div>
        )}

        <div className="row-gap end">
          {profile && !isPrimary && (
            <button
              type="button"
              className="btn danger"
              disabled={profile.id === activeId}
              title={profile.id === activeId ? 'Switch to another profile to delete this one' : undefined}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                deleteProfile(profile.id);
                toast(`${profile.name} deleted`);
                onClose();
              }}
            >
              {confirmDelete ? 'Delete library & history too?' : 'Delete profile'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn glass" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {profile ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Top-bar avatar with a menu to switch or manage profiles. */
export function ProfileMenu({ onManage }: { onManage: () => void }) {
  const { profiles, activeId } = useProfiles();
  const account = useAccount((s) => s.user);
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { select, prompt } = useProfileSwitch(() => {
    setOpen(false);
    window.location.hash = '#/';
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      <button className="profile-menu-button" onClick={() => setOpen(!open)} title={`${active.name} — switch profile`}>
        <Avatar profile={active} size={38} />
      </button>
      {open && (
        <div className="profile-dropdown">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`profile-dropdown-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => (p.id === activeId ? setOpen(false) : select(p))}
            >
              <Avatar profile={p} size={30} />
              <span className="profile-dropdown-name">{p.name}</span>
              {p.pin && p.id !== activeId && <Icon name="lock" size={14} />}
              {p.id === activeId && <Icon name="check" size={16} />}
            </button>
          ))}
          <div className="profile-dropdown-sep" />
          {accountsConfigured && (
            <div className="profile-dropdown-account muted small">
              {account ? `Signed in as ${account.email}` : 'Not signed in'}
            </div>
          )}
          <button
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <span className="profile-dropdown-icon">
              <Icon name="settings" size={18} />
            </span>
            Manage profiles
          </button>
        </div>
      )}
      {prompt}
    </div>
  );
}
