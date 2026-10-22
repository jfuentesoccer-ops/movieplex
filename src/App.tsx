import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toasts } from './components/Common';
import { BottomNav, SideNav, TopBar } from './components/Nav';
import { ProfilePicker } from './components/Profiles';
import { UpdateBanner } from './components/UpdateBanner';
import Addons from './pages/Addons';
import Board from './pages/Board';
import Calendar from './pages/Calendar';
import Detail from './pages/Detail';
import Discover from './pages/Discover';
import Library from './pages/Library';
import NotFound from './pages/NotFound';
import Search from './pages/Search';
import Settings from './pages/Settings';
import { desktop } from './lib/desktop';
import { useAddons } from './store/addons';
import { needsPicker, useProfiles } from './store/profiles';

// The player pulls in hls.js, so it is loaded on demand.
const Player = lazy(() => import('./pages/Player'));

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const refreshManifests = useAddons((s) => s.refreshManifests);
  const activeId = useProfiles((s) => s.activeId);
  const showPicker = useProfiles((s) => !s.chosen && needsPicker(s));
  const isPlayer = location.pathname.startsWith('/player');

  useEffect(() => {
    refreshManifests();
  }, [refreshManifests, activeId]);

  // Desktop app: menu items and movieplex:// deep links arrive as routes.
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.classList.add('desktop', `platform-${desktop.platform}`);
    const off = desktop.onNavigate((route) => navigate(route));
    desktop.ready();
    return off;
  }, [navigate]);

  useEffect(() => {
    if (!isPlayer) window.scrollTo(0, 0);
  }, [location.pathname, isPlayer]);

  // "Who's watching?" comes first, so nothing loads for the wrong profile.
  if (showPicker) {
    return (
      <>
        <ProfilePicker />
        <Toasts />
      </>
    );
  }

  if (isPlayer) {
    return (
      <>
        <Suspense fallback={<div className="player" />}>
          <Routes>
            <Route path="/player/:stream/:type/:id/:videoId?" element={<Player />} />
          </Routes>
        </Suspense>
        <Toasts />
      </>
    );
  }

  return (
    <div className="app">
      <SideNav />
      <div className="shell">
        <TopBar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/discover/:transportUrl?/:type?/:catalogId?" element={<Discover />} />
            <Route path="/library/:type?" element={<Library />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/search" element={<Search />} />
            <Route path="/detail/:type/:id/:videoId?" element={<Detail />} />
            <Route path="/addons/:filter?" element={<Addons />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <BottomNav />
      <UpdateBanner />
      <Toasts />
    </div>
  );
}
