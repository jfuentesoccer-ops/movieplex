import { installUpdate, useUpdates } from '../lib/updates';

/** Offers a downloaded update (or, where it can't install itself, the download page). */
export function UpdateBanner() {
  const { update, dismissed } = useUpdates();
  if (!update?.version || dismissed === update.version) return null;
  if (update.state !== 'ready' && !(update.state === 'available' && update.page)) return null;
  const later = () => useUpdates.setState({ dismissed: update.version! });
  return (
    <div className="update-banner" role="status">
      <div>
        <div className="strong">MoviePlex {update.version} is {update.state === 'ready' ? 'ready to install' : 'available'}</div>
        <div className="muted small">
          {update.state === 'ready' ? 'MoviePlex restarts to finish updating.' : `You have ${update.current}.`}
        </div>
      </div>
      <div className="update-actions">
        <button className="btn small" onClick={later}>
          Later
        </button>
        {update.state === 'ready' ? (
          <button className="btn small primary" onClick={installUpdate}>
            Restart now
          </button>
        ) : (
          <button className="btn small primary" onClick={() => window.open(update.page, '_blank')}>
            Download
          </button>
        )}
      </div>
    </div>
  );
}
