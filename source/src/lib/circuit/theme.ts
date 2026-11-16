// Shared theme definitions for the simulator chrome and the canvas renderer.
//
// The DOM uses the CSS variables from `globals.css` (`.dark`, `.light`,
// `.pink`), but canvas strokes/fills cannot use CSS classes, so each theme
// exposes a matching palette here. `draw.ts` reads the active palette through
// `setCanvasTheme()`.

export type AppTheme = 'dark' | 'light' | 'pink';

export const APP_THEMES: { id: AppTheme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'pink', label: 'Pink' },
];

export function normalizeTheme(value: unknown): AppTheme {
  return value === 'light' || value === 'pink' ? value : 'dark';
}

export interface CanvasPalette {
  /** canvas backdrop */
  background: string;
  /** faint grid dots */
  grid: string;
  /** component outline (idle) */
  base: string;
  /** component outline (hovered) */
  hover: string;
  /** component outline / accent (selected) */
  select: string;
  /** ordinary component-value labels */
  value: string;
  /** live instrument readout text */
  readout: string;
  /** pill behind live readouts */
  readoutPill: string;
  /** pill border behind live readouts */
  readoutBorder: string;
  /** interior of symbol bodies (gates, transistors, chips…) */
  body: string;
  /** connection posts */
  post: string;
  /** bright "energised" colour: lamp/LED glow, gate output hint */
  on: string;
  /** idle logic lamp / LED */
  off: string;
  /** logic-input fill while high */
  logicHigh: string;
  /** logic-input "H 1" text */
  logicHighText: string;
  /** wire tint for positive node voltages */
  wirePositive: string;
  /** wire tint for negative node voltages */
  wireNegative: string;
  /** drag preview / marquee accent */
  accent: string;
  /** translucent marquee fill */
  marqueeFill: string;
  /** ring around a probe tip */
  probeTip: string;
  /** lead colour of the black probe */
  probeBlackLead: string;
  /** handle outline of the black probe */
  probeBlackStroke: string;
  /** halo behind animated current dots */
  dotTrail: string;
  /** animated current dots */
  dot: string;
}

const DARK: CanvasPalette = {
  background: '#101013',
  grid: '#26262b',
  base: '#d4d4d8',
  hover: '#a1a1aa',
  select: '#fbbf24',
  value: '#a1a1aa',
  readout: '#fef08a',
  readoutPill: 'rgba(9, 9, 11, 0.82)',
  readoutBorder: 'rgba(254, 240, 138, 0.45)',
  body: '#18181b',
  post: '#e4e4e7',
  on: '#fde047',
  off: '#3f3f46',
  logicHigh: '#166534',
  logicHighText: '#bbf7d0',
  wirePositive: '#6ee78c',
  wireNegative: '#f87171',
  accent: '#fbbf24',
  marqueeFill: 'rgba(251, 191, 36, 0.08)',
  probeTip: '#fafafa',
  probeBlackLead: '#a1a1aa',
  probeBlackStroke: '#52525b',
  dotTrail: 'rgba(134, 239, 172, 0.3)',
  dot: '#bef264',
};

const LIGHT: CanvasPalette = {
  background: '#f7f7f8',
  grid: '#d4d4d8',
  base: '#27272a',
  hover: '#52525b',
  select: '#b45309',
  value: '#52525b',
  readout: '#92400e',
  readoutPill: 'rgba(255, 251, 235, 0.95)',
  readoutBorder: 'rgba(180, 83, 9, 0.5)',
  body: '#ffffff',
  post: '#3f3f46',
  on: '#ca8a04',
  off: '#d4d4d8',
  logicHigh: '#86efac',
  logicHighText: '#166534',
  wirePositive: '#15803d',
  wireNegative: '#dc2626',
  accent: '#d97706',
  marqueeFill: 'rgba(217, 119, 6, 0.10)',
  probeTip: '#ffffff',
  probeBlackLead: '#52525b',
  probeBlackStroke: '#a1a1aa',
  dotTrail: 'rgba(22, 163, 74, 0.25)',
  dot: '#16a34a',
};

const PINK: CanvasPalette = {
  background: '#fff1f6',
  grid: '#f6bcd3',
  base: '#831843',
  hover: '#be185d',
  select: '#db2777',
  value: '#a34a6b',
  readout: '#9d174d',
  readoutPill: 'rgba(255, 255, 255, 0.94)',
  readoutBorder: 'rgba(219, 39, 119, 0.55)',
  body: '#ffffff',
  post: '#9d174d',
  on: '#ec4899',
  off: '#fbcfe8',
  logicHigh: '#fbcfe8',
  logicHighText: '#9d174d',
  wirePositive: '#0d9488',
  wireNegative: '#e11d48',
  accent: '#db2777',
  marqueeFill: 'rgba(219, 39, 119, 0.10)',
  probeTip: '#ffffff',
  probeBlackLead: '#52525b',
  probeBlackStroke: '#f9a8d4',
  dotTrail: 'rgba(236, 72, 153, 0.22)',
  dot: '#db2777',
};

export const CANVAS_PALETTES: Record<AppTheme, CanvasPalette> = {
  dark: DARK,
  light: LIGHT,
  pink: PINK,
};

/** Build an `rgba()` colour from a palette hex plus alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
