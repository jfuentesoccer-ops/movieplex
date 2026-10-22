// The logo artwork (public/logo-*.png) is white on transparent and is used as a CSS mask,
// so it takes the current text color: white in dark mode, near-black in light mode.

/** The M mark on its own. */
export function LogoMark({ height = 24 }: { height?: number }) {
  return <span className="logo-art mark" role="img" aria-label="MoviePlex" style={{ height }} />;
}

/** The mark with the wordmark to its right; `compact` shows only the mark. */
export function Logo({ compact }: { compact?: boolean }) {
  if (compact) return <LogoMark />;
  return (
    <span className="logo" role="img" aria-label="MoviePlex">
      <span className="logo-art mark" />
      <span className="logo-art word" />
    </span>
  );
}
