// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * How documents look.
 *
 * A theme is a flat object of colours, type, margins and a few switches. The
 * complete document CSS is built from it. The same function serves the PDF
 * export and the preview in the app, so the preview cannot drift away from
 * what gets printed.
 *
 * Deliberately no free positioning by drag and drop: a document built halfway
 * past DIN 5008 shows in a window envelope. Everything is adjustable that can
 * change without wrecking the layout.
 */

export type FontKey = 'sans' | 'serif' | 'humanist' | 'grotesk' | 'mono';
export type LogoPosition = 'left' | 'right' | 'none';
export type SenderLineStyle = 'rule' | 'plain' | 'none';
export type TableStyle = 'lines' | 'zebra' | 'plain';
export type AccentBar = 'none' | 'left' | 'edges';
export type TitleAlign = 'left' | 'right';
export type InfoStyle = 'table' | 'row';

export const FONT_STACKS: Record<FontKey, string> = {
  sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: '"Georgia", "Times New Roman", serif',
  humanist: '"Calibri", "Candara", "Segoe UI", sans-serif',
  grotesk: '"Arial", "Helvetica Neue", sans-serif',
  mono: '"Consolas", "Courier New", monospace'
};

export const FONT_LABELS: { value: FontKey; label: string }[] = [
  { value: 'sans', label: 'Segoe UI, ruhig und neutral' },
  { value: 'humanist', label: 'Calibri, weicher und freundlich' },
  { value: 'grotesk', label: 'Arial, sachlich und verbreitet' },
  { value: 'serif', label: 'Georgia, klassisch mit Serifen' },
  { value: 'mono', label: 'Consolas, technisch' }
];

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Theme {
  preset: string;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  lineColor: string;
  paperColor: string;
  fontFamily: FontKey;
  fontSize: number;
  lineHeight: number;
  titleSize: number;
  titleAccent: boolean;
  titleUppercase: boolean;
  margins: Margins;
  logoPosition: LogoPosition;
  logoHeight: number;
  showSenderLine: boolean;
  senderLineStyle: SenderLineStyle;
  tableStyle: TableStyle;
  tableHeaderAccent: boolean;
  totalsHighlight: boolean;
  showFooter: boolean;
  footerNote: string;
  showPageNumbers: boolean;
  /** A stripe at the margin, or bars above and below. */
  accentBar: AccentBar;
  /** Beside the date a right aligned title reads like a brand. */
  titleAlign: TitleAlign;
  /** Number and date as a table next to the address, or as a row below the title. */
  infoStyle: InfoStyle;
  /** Small glyphs in front of the contact lines in the footer. */
  footerIcons: boolean;
  /** The "place, date" line above the title, usual in a letter and dispensable on an invoice. */
  showPlaceLine: boolean;
}

/** What arrives from storage: partial, and with the old boolean accent bar. */
export type RawTheme = Partial<Omit<Theme, 'accentBar' | 'margins'>> & {
  accentBar?: AccentBar | boolean;
  margins?: Partial<Margins>;
};

export const DEFAULT_THEME: Theme = {
  preset: 'klar',
  accentColor: '#1f6feb',
  textColor: '#1a1a1a',
  mutedColor: '#5a5a5a',
  lineColor: '#d5d9df',
  paperColor: '#ffffff',
  fontFamily: 'sans',
  fontSize: 10.5,
  lineHeight: 1.45,
  titleSize: 16,
  titleAccent: true,
  titleUppercase: false,
  margins: { top: 20, right: 20, bottom: 16, left: 25 },
  logoPosition: 'right',
  logoHeight: 22,
  showSenderLine: true,
  senderLineStyle: 'rule',
  tableStyle: 'lines',
  tableHeaderAccent: false,
  totalsHighlight: true,
  showFooter: true,
  footerNote: '',
  showPageNumbers: true,
  accentBar: 'none',
  titleAlign: 'left',
  infoStyle: 'table',
  footerIcons: false,
  showPlaceLine: false
};

export interface Preset {
  label: string;
  hint: string;
  values: RawTheme;
}

/**
 * Ready made looks as a starting point. Every value can still be changed one
 * by one, and the selection then jumps to "eigen".
 */
export const PRESETS: Record<string, Preset> = {
  klar: {
    label: 'Klar',
    hint: 'Neutral und ruhig, dünne Linien, blaue Akzente',
    values: {
      accentColor: '#1f6feb', textColor: '#1a1a1a', mutedColor: '#5a5a5a', lineColor: '#d5d9df',
      fontFamily: 'sans', fontSize: 10.5, titleSize: 16, titleAccent: true, titleUppercase: false,
      tableStyle: 'lines', tableHeaderAccent: false, totalsHighlight: true, accentBar: 'none',
      senderLineStyle: 'rule'
    }
  },
  kontrast: {
    label: 'Kontrast',
    hint: 'Kräftige Kopfzeile mit farbigem Tabellenkopf',
    values: {
      accentColor: '#0f3d63', textColor: '#15181c', mutedColor: '#4a5058', lineColor: '#c9d1da',
      fontFamily: 'grotesk', fontSize: 10.5, titleSize: 18, titleAccent: true, titleUppercase: true,
      tableStyle: 'lines', tableHeaderAccent: true, totalsHighlight: true, accentBar: 'left',
      senderLineStyle: 'rule'
    }
  },
  klassisch: {
    label: 'Klassisch',
    hint: 'Serifenschrift, zurückhaltend, wirkt gedruckt',
    values: {
      accentColor: '#4a3b2a', textColor: '#20201d', mutedColor: '#5c574e', lineColor: '#ccc6ba',
      fontFamily: 'serif', fontSize: 11, titleSize: 17, titleAccent: false, titleUppercase: false,
      tableStyle: 'plain', tableHeaderAccent: false, totalsHighlight: false, accentBar: 'none',
      senderLineStyle: 'rule'
    }
  },
  werkstatt: {
    label: 'Werkstatt',
    hint: 'Zebrastreifen in der Tabelle, gut für lange Positionslisten',
    values: {
      accentColor: '#1b7f5a', textColor: '#17201c', mutedColor: '#4f5b54', lineColor: '#cfd8d2',
      fontFamily: 'humanist', fontSize: 10.5, titleSize: 16, titleAccent: true, titleUppercase: false,
      tableStyle: 'zebra', tableHeaderAccent: false, totalsHighlight: true, accentBar: 'none',
      senderLineStyle: 'rule'
    }
  },
  reduziert: {
    label: 'Reduziert',
    hint: 'Alles in Graustufen, keine Linien, viel Weißraum',
    values: {
      accentColor: '#2b2b2b', textColor: '#222222', mutedColor: '#6b6b6b', lineColor: '#e2e2e2',
      fontFamily: 'sans', fontSize: 10, titleSize: 15, titleAccent: false, titleUppercase: true,
      tableStyle: 'plain', tableHeaderAccent: false, totalsHighlight: false, accentBar: 'none',
      senderLineStyle: 'none'
    }
  },
  studio: {
    label: 'Studio',
    hint: 'Titel rechts, Balken oben und unten, Kontaktzeile mit Zeichen',
    values: {
      accentColor: '#e74e00', textColor: '#000000', mutedColor: '#767171', lineColor: '#323232',
      fontFamily: 'grotesk', fontSize: 9.5, titleSize: 19, titleAccent: true, titleUppercase: false,
      tableStyle: 'lines', tableHeaderAccent: false, totalsHighlight: true,
      accentBar: 'edges', titleAlign: 'right', infoStyle: 'row', footerIcons: true,
      showPlaceLine: true,
      senderLineStyle: 'rule', logoPosition: 'left'
    }
  }
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/** Takes only what passes as a colour. The CSS is built from this. */
export function safeColor(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(text) ? text : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeMargins(raw: Partial<Margins> | undefined): Margins {
  const margins = { ...DEFAULT_THEME.margins, ...(raw ?? {}) };

  return {
    top: clamp(margins.top, 10, 45, 20),
    right: clamp(margins.right, 10, 40, 20),
    bottom: clamp(margins.bottom, 10, 40, 16),
    left: clamp(margins.left, 15, 45, 25)
  };
}

/** The earlier boolean stays valid: true was the stripe on the left. */
function normalizeAccentBar(value: AccentBar | boolean | undefined): AccentBar {
  if (value === true) return 'left';
  return oneOf(value, ['none', 'left', 'edges'] as const, 'none');
}

/** Fills in what is missing and holds everything to a sensible range. */
export function normalizeTheme(raw?: RawTheme | null): Theme {
  const theme = { ...DEFAULT_THEME, ...(raw ?? {}) };

  return {
    preset: typeof theme.preset === 'string' ? theme.preset : 'eigen',
    accentColor: safeColor(theme.accentColor, DEFAULT_THEME.accentColor),
    textColor: safeColor(theme.textColor, DEFAULT_THEME.textColor),
    mutedColor: safeColor(theme.mutedColor, DEFAULT_THEME.mutedColor),
    lineColor: safeColor(theme.lineColor, DEFAULT_THEME.lineColor),
    paperColor: safeColor(theme.paperColor, DEFAULT_THEME.paperColor),
    fontFamily: FONT_STACKS[theme.fontFamily as FontKey] ? (theme.fontFamily as FontKey) : 'sans',
    fontSize: clamp(theme.fontSize, 8, 14, DEFAULT_THEME.fontSize),
    lineHeight: clamp(theme.lineHeight, 1.1, 2, DEFAULT_THEME.lineHeight),
    titleSize: clamp(theme.titleSize, 11, 28, DEFAULT_THEME.titleSize),
    titleAccent: Boolean(theme.titleAccent),
    titleUppercase: Boolean(theme.titleUppercase),
    margins: normalizeMargins(raw?.margins),
    logoPosition: oneOf(theme.logoPosition, ['left', 'right', 'none'] as const, 'right'),
    logoHeight: clamp(theme.logoHeight, 8, 40, DEFAULT_THEME.logoHeight),
    showSenderLine: Boolean(theme.showSenderLine),
    senderLineStyle: oneOf(theme.senderLineStyle, ['rule', 'plain', 'none'] as const, 'rule'),
    tableStyle: oneOf(theme.tableStyle, ['lines', 'zebra', 'plain'] as const, 'lines'),
    tableHeaderAccent: Boolean(theme.tableHeaderAccent),
    totalsHighlight: Boolean(theme.totalsHighlight),
    showFooter: Boolean(theme.showFooter),
    footerNote: String(theme.footerNote ?? '').slice(0, 300),
    showPageNumbers: Boolean(theme.showPageNumbers),
    accentBar: normalizeAccentBar(theme.accentBar),
    titleAlign: theme.titleAlign === 'right' ? 'right' : 'left',
    infoStyle: theme.infoStyle === 'row' ? 'row' : 'table',
    footerIcons: Boolean(theme.footerIcons),
    showPlaceLine: Boolean(theme.showPlaceLine)
  };
}

/** Applies a preset while keeping margins, logo and footer note. */
export function applyPreset(theme: RawTheme | null | undefined, presetId: string): Theme {
  const preset = PRESETS[presetId];
  if (!preset) return normalizeTheme(theme);
  return normalizeTheme({ ...theme, ...preset.values, preset: presetId });
}

/** Checks whether a theme still matches exactly one preset. */
export function detectPreset(theme: RawTheme | null | undefined): string {
  const normalized = normalizeTheme(theme) as unknown as Record<string, unknown>;

  for (const [id, preset] of Object.entries(PRESETS)) {
    const matches = Object.entries(preset.values).every(([key, value]) => normalized[key] === value);
    if (matches) return id;
  }
  return 'eigen';
}

/** The three channels of a hex colour, whether it came in short or long. */
function channelsOf(hex: unknown): [number, number, number] {
  const value = safeColor(hex, '#000000').replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value.slice(0, 6);
  const numeric = Number.parseInt(full, 16);
  return [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255];
}

/** Mixes a colour with white, for pale areas made from the accent. */
export function tint(hex: string, amount: number): string {
  const mixed = channelsOf(hex).map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Decides whether black or white text reads better on a surface. */
export function readableOn(hex: string): string {
  const linear = channelsOf(hex).map((channel) => {
    const share = channel / 255;
    return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
  }) as [number, number, number];

  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.45 ? '#1a1a1a' : '#ffffff';
}
