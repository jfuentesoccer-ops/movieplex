import { FormEvent, useEffect, useState } from 'react';
import { accountsConfigured, useAccount } from '../sync/account';
import { Spinner } from './Common';
import { Icon } from './Icon';

function timeAgo(ms?: number) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

export function SyncStatus() {
  const { status, error, lastSyncedAt } = useAccount();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  if (status === 'syncing')
    return (
      <span className="status checking">
        <Spinner size={14} /> Syncing…
      </span>
    );
  if (status === 'error')
    return (
      <span className="status offline" title={error}>
        <span className="dot" /> Sync failed{error ? `: ${error}` : ''}
      </span>
    );
  return (
    <span className="status online">
      <span className="dot" /> Synced {timeAgo(lastSyncedAt)}
    </span>
  );
}

/** Settings › Account: sign in / create account, or the signed-in account with sync status. */
export function AccountPanel() {
  const { ready, user, signIn, signUp, signOut, syncNow, status } = useAccount();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  if (!accountsConfigured) {
    return (
      <div className="account-panel">
        <p className="muted">
          Accounts aren’t set up in this build, so everything stays on this device. To turn on sign-in and sync,
          add a Supabase project (see README › Building from source).
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="account-panel center pad">
        <Spinner />
      </div>
    );
  }

  if (user) {
    return (
      <div className="account-panel">
        <div className="account-row">
          <div className="account-icon">
            <Icon name="user" size={22} />
          </div>
          <div className="account-text">
            <div className="strong">{user.email}</div>
            <SyncStatus />
          </div>
          <button className="btn small glass" disabled={status === 'syncing'} onClick={() => syncNow()}>
            <Icon name="refresh" size={16} /> Sync now
          </button>
          <button className="btn small glass" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
        <p className="muted small">
          Profiles, libraries, watch progress, settings and addons sync across devices signed in to this account.
          Signing out keeps everything on this device.
        </p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setMessage({ kind: 'error', text: 'Enter your email and password.' });
      return;
    }
    // New passwords: at least 8 characters with a letter and a number (matches the Supabase
    // Auth settings in the README; sign-in still accepts older, shorter passwords).
    if (mode === 'signup' && (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))) {
      setMessage({ kind: 'error', text: 'Use a password of at least 8 characters with a letter and a number.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    if (mode === 'signin') {
      const error = await signIn(email.trim(), password);
      if (error) setMessage({ kind: 'error', text: error });
    } else {
      const { error, needsConfirmation } = await signUp(email.trim(), password);
      if (error) setMessage({ kind: 'error', text: error });
      else if (needsConfirmation) {
        setMessage({ kind: 'info', text: 'Check your email and open the confirmation link, then sign in here.' });
        setMode('signin');
      }
    }
    setBusy(false);
  };

  return (
    <form className="account-panel account-form" onSubmit={submit}>
      <div className="segmented">
        <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
          Sign in
        </button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
          Create account
        </button>
      </div>
      <input
        className="input"
        type="email"
        placeholder="Email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="input"
        type="password"
        placeholder="Password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {message && <p className={message.kind === 'error' ? 'error-text' : 'muted small'}>{message.text}</p>}
      <div className="row-gap">
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner size={16} /> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <span className="muted small">Sync your profiles, library and settings across devices.</span>
      </div>
    </form>
  );
}
