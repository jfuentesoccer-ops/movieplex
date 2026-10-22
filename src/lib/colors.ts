// Appearance is two choices — a mode and an accent color. The full palette
// (see the :root block in styles.css) is derived from them by buildPalette().

export type Mode = 'dark' | 'light' | 'black';

export type Appearance = {
  mode: Mode;
  /** An ACCENTS id, or a "#rrggbb" custom color. */
  accent: string;
};

export const DEFAULT_APPEARANCE: Appearance = { mode: 'dark', accent: 'violet' };

export const MODES: { id: Mode; name: string }[] = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' },
  { id: 'black', name: 'Black' },
];

type Accent = { id: string; name: string; from: string; to: string; light?: { from: string; to: string } };

export const ACCENTS: Accent[] = [
  { id: 'violet', name: 'Violet', from: '#8b5cf6', to: '#ec4899' },
  { id: 'blue', name: 'Blue', from: '#3b82f6', to: '#06b6d4' },
  { id: 'teal', name: 'Teal', from: '#14b8a6', to: '#3b82f6' },
  { id: 'green', name: 'Green', from: '#22c55e', to: '#14b8a6' },
  { id: 'amber', name: 'Amber', from: '#f59e0b', to: '#ef4444' },
  { id: 'red', name: 'Red', from: '#ef4444', to: '#f97316' },
  { id: 'pink', name: 'Pink', from: '#ec4899', to: '#8b5cf6' },
  { id: 'mono', name: 'Mono', from: '#e5e5e5', to: '#a3a3a3', light: { from: '#27272a', to: '#52525b' } },
];

type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  surface4: string;
  text: string;
  text2: string;
  muted: string;
  accent: string;
  accentSoft: string;
  gradFrom: string;
  gradTo: string;
  onAccent: string;
  danger: string;
  success: string;
};

// ---------- Color math ----------
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) =>
  '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

function mix(a: string, b: string, t: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rotates the hue of a color, used to pair a custom accent with a gradient partner. */
function rotateHue(hex: string, degrees: number) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return hex;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + degrees + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

export const isCustomAccent = (accent: string) => accent.startsWith('#');

/** The two gradient colors for an accent choice. */
export function accentColors(accent: string, mode: Mode): { from: string; to: string } {
  if (isCustomAccent(accent)) return { from: accent, to: rotateHue(accent, -30) };
  const preset = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0];
  return mode === 'light' && preset.light ? preset.light : preset;
}

export function buildPalette({ mode, accent }: Appearance): Palette {
  const { from, to } = accentColors(accent, mode);
  // Black or white, whichever reads better on both ends of the button gradient.
  const onAccent =
    Math.min(contrast('#ffffff', from), contrast('#ffffff', to)) >= Math.min(contrast('#111111', from), contrast('#111111', to))
      ? '#ffffff'
      : '#111111';

  if (mode === 'light') {
    const text = '#17161c';
    const bg = mix('#f6f6f9', from, 0.025);
    const solid = luminance(from) > 0.5 ? mix(from, '#000000', 0.55) : mix(from, '#000000', 0.08);
    return {
      bg, surface: '#ffffff', surface2: mix(bg, text, 0.04), surface3: mix(bg, text, 0.09), surface4: mix(bg, text, 0.14),
      text, text2: '#3b3946', muted: '#6b6878',
      accent: solid, accentSoft: mix(solid, '#000000', 0.25), gradFrom: from, gradTo: to, onAccent,
      danger: '#d1243f', success: '#15995e',
    };
  }

  const text = '#f4f3f8';
  const bg = mode === 'black' ? '#000000' : mix('#0a0a0d', from, 0.035);
  const surfaces =
    mode === 'black'
      ? { surface: '#0b0b0b', surface2: '#141414', surface3: '#1e1e1e', surface4: '#2a2a2a' }
      : { surface: mix(bg, text, 0.05), surface2: mix(bg, text, 0.09), surface3: mix(bg, text, 0.15), surface4: mix(bg, text, 0.21) };
  const solid = mix(from, '#ffffff', 0.12);
  return {
    bg, ...surfaces,
    text, text2: '#d6d4de', muted: '#a19fae',
    accent: solid, accentSoft: mix(solid, '#ffffff', 0.45), gradFrom: from, gradTo: to, onAccent,
    danger: '#ff5c7a', success: '#3ddc97',
  };
}

const triplet = (hex: string) => rgb(hex).join(' ');

export function applyAppearance(appearance: Appearance) {
  const p = buildPalette(appearance);
  const light = appearance.mode === 'light';
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--bg-rgb': triplet(p.bg),
    '--surface': p.surface,
    '--surface-rgb': triplet(p.surface),
    '--surface-2': p.surface2,
    '--surface-3': p.surface3,
    '--surface-4': p.surface4,
    // Overlays (hover tints, borders) are drawn in the text color.
    '--fg-rgb': triplet(p.text),
    '--border': `rgb(${triplet(p.text)} / ${light ? 0.1 : 0.08})`,
    '--text': p.text,
    '--text-2': p.text2,
    '--muted': p.muted,
    '--accent': p.accent,
    '--accent-rgb': triplet(p.accent),
    '--accent-soft': p.accentSoft,
    '--grad-from': p.gradFrom,
    '--grad-to': p.gradTo,
    '--on-accent': p.onAccent,
    '--danger': p.danger,
    '--danger-text': light ? mix(p.danger, '#000000', 0.15) : mix(p.danger, '#ffffff', 0.3),
    '--success': p.success,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = light ? 'light' : 'dark';
  root.dataset.scheme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

/** Maps colors saved by the earlier full color editor onto the simpler model. */
export function appearanceFromPalette(colors: { bg?: string; gradFrom?: string }): Appearance {
  const bg = colors.bg ?? '#0b0a12';
  const mode: Mode = bg === '#000000' ? 'black' : luminance(bg) > 0.35 ? 'light' : 'dark';
  const from = colors.gradFrom?.toLowerCase();
  const preset = ACCENTS.find((a) => a.from === from || a.light?.from === from);
  return { mode, accent: preset?.id ?? (from && /^#[0-9a-f]{6}$/.test(from) ? from : 'violet') };
}
