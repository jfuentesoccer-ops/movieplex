import { FormEvent, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from './Icon';
import { Logo } from './Logo';
import { ProfileMenu } from './Profiles';

const LINKS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Board', icon: 'home', end: true },
  { to: '/discover', label: 'Discover', icon: 'discover' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/addons', label: 'Addons', icon: 'addons' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function SideNav() {
  return (
    <nav className="side-nav" aria-label="Main">
      <div className="side-nav-logo">
        <Logo compact />
      </div>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className="side-nav-link" title={l.label}>
          <Icon name={l.icon} size={22} />
          <span>{l.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const items = LINKS.filter((l) => l.to !== '/calendar');
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className="bottom-nav-link">
          <Icon name={l.icon} size={22} />
          <span>{l.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearch = location.pathname === '/search';
  const [q, setQ] = useState(onSearch ? params.get('q') ?? '' : '');

  const urlQuery = params.get('q') ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!onSearch) setQ('');
    // Follow the URL (back/forward, links) unless the user is typing.
    else if (document.activeElement !== inputRef.current) setQ(urlQuery);
  }, [onSearch, urlQuery]);

  // Live search while typing on the search page.
  useEffect(() => {
    if (!onSearch) return;
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q.trim())
        navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace: true });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`/search?q=${encodeURIComponent(query)}`, { replace: onSearch });
  };

  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <Logo />
      </div>
      <form className="search-box" onSubmit={submit} role="search">
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => !onSearch && navigate('/search')}
          placeholder="Search movies & series"
          aria-label="Search"
        />
        {q && (
          <button type="button" className="icon-btn ghost" onClick={() => setQ('')} aria-label="Clear">
            <Icon name="close" size={16} />
          </button>
        )}
      </form>
      <div className="top-bar-actions">
        <NavLink to="/addons" className="icon-btn" title="Addons">
          <Icon name="addons" />
        </NavLink>
        <ProfileMenu onManage={() => navigate('/settings?section=profiles')} />
      </div>
    </header>
  );
}
