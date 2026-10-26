/**
 * Console (fixed-width / monospace) font detection and formatting for the
 * integrated terminal.
 */

export const TERMINAL_FONT_CHANGED_EVENT = 'awapi:terminal-font-changed';

/**
 * Default terminal font stack. Includes standard platform console fonts plus
 * common Nerd Font / Powerline families so prompt glyphs (e.g. Oh My Posh)
 * render out of the box when installed.
 */
export const DEFAULT_TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, Consolas, "Cascadia Mono", "Cascadia Mono PL", "CaskaydiaCove Nerd Font", "Cascadia Code NF", "MesloLGS NF", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Cousine Nerd Font", "Hack Nerd Font", "DejaVu Sans Mono", "Courier New", monospace';

/**
 * Curated candidate console, programming, Nerd Font, and Powerline families
 * checked alongside any fonts returned by `window.queryLocalFonts()`.
 */
export const CANDIDATE_CONSOLE_FONTS: readonly string[] = [
  // Standard OS console fonts
  'Cascadia Mono',
  'Cascadia Code',
  'Consolas',
  'Lucida Console',
  'Lucida Sans Typewriter',
  'Courier New',
  'Menlo',
  'Monaco',
  'SF Mono',
  'Andale Mono',
  'DejaVu Sans Mono',
  'Ubuntu Mono',
  'Liberation Mono',
  'Noto Sans Mono',
  'Droid Sans Mono',
  'FreeMono',
  // Popular programming console fonts
  'JetBrains Mono',
  'Fira Code',
  'Fira Mono',
  'Source Code Pro',
  'Hack',
  'Inconsolata',
  'Iosevka',
  'IBM Plex Mono',
  'Roboto Mono',
  'Space Mono',
  'PT Mono',
  'Anonymous Pro',
  'Cousine',
  'Victor Mono',
  'Geist Mono',
  'CommitMono',
  'Monaspace Neon',
  'Monaspace Argon',
  'Monaspace Xenon',
  'Monaspace Radon',
  'Monaspace Krypton',
  'Intel One Mono',
  '0xProto',
  'Agave',
  'Mononoki',
  'Fantasque Sans Mono',
  // Nerd Fonts & Powerline fonts (Oh My Posh / Starship / Powerlevel10k)
  'Cascadia Mono PL',
  'Cascadia Code PL',
  'Cascadia Mono NF',
  'Cascadia Code NF',
  'CaskaydiaCove Nerd Font',
  'CaskaydiaCove Nerd Font Mono',
  'CaskaydiaCove NF',
  'CaskaydiaMono Nerd Font',
  'CaskaydiaMono Nerd Font Mono',
  'CaskaydiaMono NF',
  'MesloLGS NF',
  'MesloLGS Nerd Font',
  'MesloLGS Nerd Font Mono',
  'MesloLGM Nerd Font',
  'MesloLGM NF',
  'MesloLGL Nerd Font',
  'Meslo LG S for Powerline',
  'Meslo LG M for Powerline',
  'Meslo LG L for Powerline',
  'Menlo for Powerline',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono Nerd Font Mono',
  'JetBrainsMono NF',
  'FiraCode Nerd Font',
  'FiraCode Nerd Font Mono',
  'FiraCode NF',
  'FiraMono Nerd Font',
  'Hack Nerd Font',
  'Hack Nerd Font Mono',
  'Hack NF',
  'SauceCodePro Nerd Font',
  'SauceCodePro Nerd Font Mono',
  'SauceCodePro NF',
  'Cousine Nerd Font',
  'Cousine Nerd Font Mono',
  'Cousine NF',
  'UbuntuMono Nerd Font',
  'UbuntuMono Nerd Font Mono',
  'UbuntuMono NF',
  'DejaVuSansM Nerd Font',
  'DejaVuSansM Nerd Font Mono',
  'DejaVuSansM NF',
  'Inconsolata Nerd Font',
  'Inconsolata NF',
  'Iosevka Nerd Font',
  'Iosevka Nerd Font Mono',
  'Iosevka NF',
  'RobotoMono Nerd Font',
  'RobotoMono NF',
  'BlexMono Nerd Font',
  'VictorMono Nerd Font',
  'Mononoki Nerd Font',
  'Agave Nerd Font',
  '0xProto Nerd Font',
  'AnonymicePro Nerd Font',
];

/** Fallback list used when Canvas 2D measurement is unavailable (e.g. JSDOM). */
export const FALLBACK_CONSOLE_FONTS: readonly string[] = [
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Courier New',
  'DejaVu Sans Mono',
  'Fira Code',
  'JetBrains Mono',
  'Menlo',
  'MesloLGS NF',
  'Monaco',
  'Source Code Pro',
  'Ubuntu Mono',
];

export type FontWidthMeasurer = (fontCss: string, sample: string) => number;

export interface LocalFontFace {
  family: string;
}

export interface DetectConsoleFontsDeps {
  measureWidth?: FontWidthMeasurer | null;
  queryLocalFonts?: (() => Promise<LocalFontFace[]>) | null;
}

const GENERIC_FAMILIES = new Set([
  'monospace',
  'serif',
  'sans-serif',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'ui-rounded',
]);

const EXCLUDED_FAMILY_PATTERNS: readonly RegExp[] = [
  // Hidden / vertical-writing system fonts
  /^[.@]/,
  // Nerd Fonts proportional variants
  /\bpropo$/i,
  // Standalone symbol-only fallback font
  /^symbols nerd font/i,
  // Symbol, icon, dingbat, emoji, math, and novelty non-console fonts
  /^(wingdings|webdings|symbol|marlett|bookshelf symbol|ms outlook|ms reference|mt extra|hololens mdl2|segoe mdl2|segoe fluent|segoe ui emoji|segoe ui symbol|apple color emoji|apple symbols|noto color emoji|twemoji|fontawesome|font awesome|material icons|material symbols|ionicons|feather|octicons|codicon|digital-7|lcdmono|swgamekeys)/i,
  /\b(emoji|dingbats|wingdings|webdings|braille|musical|math|barcode|ornaments|icons)\b/i,
  // Windows CJK document fonts whose Latin glyphs are half-width
  /^(mingliu|pmingliu|simsun|nsimsun|simhei|fangsong|kaiti|dfkai|ms gothic|ms pgothic|ms ui gothic|ms mincho|ms pmincho|yu gothic|yu mincho|meiryo|batang|dotum|gulim|gungsuh|malgun)/i,
  /-ext[bg]$/i,
];

const WEIGHT_SUFFIX_RE =
  /^(.+?)\s+(?:Thin|Extra\s*Light|Ultra\s*Light|Semi\s*Light|Demi\s*Light|Light|Book|Regular|Medium|Semi\s*Bold|Demi\s*Bold|Extra\s*Bold|Ultra\s*Bold|Bold|Black|Heavy)$/i;

const NARROW_SAMPLE = 'iiiiiiiiii';
const WIDE_SAMPLE = 'WWWWWWWWWW';
const DIGITS_SAMPLE = '0123456789';
const TOLERANCE = 0.5;

/** Quotes a CSS font family name safely. */
export function quoteFontFamily(family: string): string {
  const trimmed = family.trim();
  if (!trimmed) return '';
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Builds the `fontFamily` string passed to xterm.js: places the user's chosen
 * console font first (if any), followed by the default fallback stack.
 */
export function formatTerminalFontFamily(preferredFont?: string | null): string {
  const quoted = preferredFont ? quoteFontFamily(preferredFont) : '';
  if (!quoted) return DEFAULT_TERMINAL_FONT_FAMILY;
  return `${quoted}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

/** Whether a font family name is a known non-console / symbol / proportional variant. */
export function isExcludedFontFamilyName(family: string): boolean {
  const trimmed = family.trim();
  if (!trimmed) return true;
  if (GENERIC_FAMILIES.has(trimmed.toLowerCase())) return true;
  return EXCLUDED_FAMILY_PATTERNS.some(re => re.test(trimmed));
}

/**
 * Checks whether `family` is installed and renders fixed-width (console)
 * ASCII glyphs by comparing narrow, wide, and digit samples against both
 * `serif` and `sans-serif` fallbacks.
 */
export function isFixedWidthFont(family: string, measureWidth: FontWidthMeasurer): boolean {
  if (isExcludedFontFamilyName(family)) return false;
  const quoted = quoteFontFamily(family);
  if (!quoted) return false;

  const baseSerifNarrow = measureWidth('72px serif', NARROW_SAMPLE);
  const baseSerifWide = measureWidth('72px serif', WIDE_SAMPLE);
  const baseSansNarrow = measureWidth('72px sans-serif', NARROW_SAMPLE);
  const baseSansWide = measureWidth('72px sans-serif', WIDE_SAMPLE);

  const serifSpec = `72px ${quoted}, serif`;
  const sansSpec = `72px ${quoted}, sans-serif`;

  const narrowSerif = measureWidth(serifSpec, NARROW_SAMPLE);
  const wideSerif = measureWidth(serifSpec, WIDE_SAMPLE);
  const digitsSerif = measureWidth(serifSpec, DIGITS_SAMPLE);

  if (narrowSerif <= 0) return false;
  if (Math.abs(narrowSerif - wideSerif) > TOLERANCE) return false;
  if (Math.abs(narrowSerif - digitsSerif) > TOLERANCE) return false;

  const narrowSans = measureWidth(sansSpec, NARROW_SAMPLE);
  const wideSans = measureWidth(sansSpec, WIDE_SAMPLE);

  if (narrowSans <= 0) return false;
  if (Math.abs(narrowSans - wideSans) > TOLERANCE) return false;
  if (Math.abs(narrowSerif - narrowSans) > TOLERANCE) return false;

  // Ensure the font actually rendered rather than falling back to both generics.
  const differsFromSerif =
    Math.abs(narrowSerif - baseSerifNarrow) > TOLERANCE ||
    Math.abs(wideSerif - baseSerifWide) > TOLERANCE;
  const differsFromSans =
    Math.abs(narrowSans - baseSansNarrow) > TOLERANCE ||
    Math.abs(wideSans - baseSansWide) > TOLERANCE;

  return differsFromSerif || differsFromSans;
}

/**
 * Removes weight-specific family entries (e.g. "Cascadia Code Light") when the
 * base family ("Cascadia Code") is also present, then sorts case-insensitively.
 */
export function collapseWeightVariants(families: Iterable<string>): string[] {
  const unique = new Map<string, string>();
  for (const raw of families) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) unique.set(key, trimmed);
  }
  const result: string[] = [];
  for (const family of unique.values()) {
    const match = WEIGHT_SUFFIX_RE.exec(family);
    if (match && unique.has(match[1].trim().toLowerCase())) {
      continue;
    }
    result.push(family);
  }
  return result.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function createDefaultMeasurer(): FontWidthMeasurer | null {
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /\bjsdom\b/i.test(navigator.userAgent)) {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return (fontCss: string, sample: string) => {
      ctx.font = fontCss;
      return ctx.measureText(sample).width;
    };
  } catch {
    return null;
  }
}

function getDefaultQueryLocalFonts(): (() => Promise<LocalFontFace[]>) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { queryLocalFonts?: () => Promise<LocalFontFace[]> };
  return typeof w.queryLocalFonts === 'function' ? () => w.queryLocalFonts!() : null;
}

/**
 * Detects installed console (fixed-width) fonts on the current machine.
 */
export async function detectConsoleFonts(deps: DetectConsoleFontsDeps = {}): Promise<string[]> {
  const measureWidth = deps.measureWidth !== undefined ? deps.measureWidth : createDefaultMeasurer();
  const queryLocalFonts =
    deps.queryLocalFonts !== undefined ? deps.queryLocalFonts : getDefaultQueryLocalFonts();

  const candidates = new Set<string>(CANDIDATE_CONSOLE_FONTS);
  let localFamilies: string[] | null = null;
  if (queryLocalFonts) {
    try {
      const faces = await queryLocalFonts();
      localFamilies = [];
      for (const face of faces) {
        if (face?.family) {
          candidates.add(face.family);
          localFamilies.push(face.family);
        }
      }
    } catch {
      // Local Font Access unavailable or denied; fall back to candidate list.
    }
  }

  if (!measureWidth) {
    const source = localFamilies ?? FALLBACK_CONSOLE_FONTS;
    return collapseWeightVariants(source.filter(f => !isExcludedFontFamilyName(f)));
  }

  const fixedWidth: string[] = [];
  for (const family of candidates) {
    if (isFixedWidthFont(family, measureWidth)) {
      fixedWidth.push(family);
    }
  }
  return collapseWeightVariants(fixedWidth);
}

/** Broadcasts a terminal font change to mounted terminal panels. */
export function notifyTerminalFontChanged(font: string | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string | null>(TERMINAL_FONT_CHANGED_EVENT, { detail: font }));
}
