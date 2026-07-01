/** Accent color presets + applying a custom accent over the theme defaults. */

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue', label: 'Blue', hex: '#4f9cf9' },
  { id: 'teal', label: 'Teal', hex: '#28b6a6' },
  { id: 'green', label: 'Green', hex: '#46b35e' },
  { id: 'violet', label: 'Violet', hex: '#9b7bf0' },
  { id: 'amber', label: 'Amber', hex: '#e0a020' },
  { id: 'rose', label: 'Rose', hex: '#e5679a' },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Override the theme's accent variables on :root. Passing null removes the
 * override so the per-theme default applies again.
 */
export function applyAccent(hex: string | null): void {
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-fg');
    root.style.removeProperty('--accent-soft');
    return;
  }
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-fg', lum > 0.6 ? '#10141c' : '#ffffff');
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.18)`);
}
