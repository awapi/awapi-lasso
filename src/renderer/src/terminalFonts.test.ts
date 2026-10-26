import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  FALLBACK_CONSOLE_FONTS,
  TERMINAL_FONT_CHANGED_EVENT,
  collapseWeightVariants,
  detectConsoleFonts,
  formatTerminalFontFamily,
  isExcludedFontFamilyName,
  isFixedWidthFont,
  notifyTerminalFontChanged,
  quoteFontFamily,
  type FontWidthMeasurer,
} from './terminalFonts';

/**
 * Builds a synthetic width measurer where `installedMono` fonts have fixed
 * glyph widths, `installedProportional` fonts have variable glyph widths, and
 * any other font falls back to the generic (`serif` or `sans-serif`).
 */
function createMockMeasurer(
  installedMono: Record<string, number>,
  installedProportional: string[] = [],
): FontWidthMeasurer {
  const monoLower = new Map(Object.entries(installedMono).map(([k, v]) => [k.toLowerCase(), v]));
  const propLower = new Set(installedProportional.map(f => f.toLowerCase()));

  return (fontCss: string, sample: string) => {
    const match = /"([^"]+)"/.exec(fontCss);
    const family = match?.[1]?.toLowerCase();
    if (family && monoLower.has(family)) {
      return monoLower.get(family)! * sample.length;
    }
    if (family && propLower.has(family)) {
      return sample.startsWith('i') ? 120 : sample.startsWith('W') ? 520 : 280;
    }
    const isSerif = fontCss.trim().endsWith('serif') && !fontCss.trim().endsWith('sans-serif');
    if (sample.startsWith('i')) return isSerif ? 140 : 130;
    if (sample.startsWith('W')) return isSerif ? 610 : 590;
    return isSerif ? 310 : 300;
  };
}

describe('terminalFonts', () => {
  it('quotes and formats terminal font families with the default fallback stack', () => {
    expect(quoteFontFamily('  MesloLGS NF  ')).toBe('"MesloLGS NF"');
    expect(quoteFontFamily('')).toBe('');
    expect(formatTerminalFontFamily(null)).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(formatTerminalFontFamily('')).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(formatTerminalFontFamily('Cousine Nerd Font')).toBe(
      `"Cousine Nerd Font", ${DEFAULT_TERMINAL_FONT_FAMILY}`,
    );
  });

  it('excludes proportional Nerd Font variants, symbol fonts, CJK document fonts, and hidden fonts', () => {
    expect(isExcludedFontFamilyName('Cousine Nerd Font Propo')).toBe(true);
    expect(isExcludedFontFamilyName('Wingdings')).toBe(true);
    expect(isExcludedFontFamilyName('Segoe MDL2 Assets')).toBe(true);
    expect(isExcludedFontFamilyName('Segoe Fluent Icons')).toBe(true);
    expect(isExcludedFontFamilyName('SimSun')).toBe(true);
    expect(isExcludedFontFamilyName('MingLiU-ExtB')).toBe(true);
    expect(isExcludedFontFamilyName('@MS Gothic')).toBe(true);
    expect(isExcludedFontFamilyName('.SF NS Mono')).toBe(true);
    expect(isExcludedFontFamilyName('monospace')).toBe(true);

    expect(isExcludedFontFamilyName('Cascadia Mono')).toBe(false);
    expect(isExcludedFontFamilyName('MesloLGS NF')).toBe(false);
    expect(isExcludedFontFamilyName('Cousine Nerd Font')).toBe(false);
  });

  it('identifies installed fixed-width fonts and rejects proportional or uninstalled fonts', () => {
    const measure = createMockMeasurer(
      { 'Cascadia Mono': 42, 'MesloLGS NF': 44, 'Cousine Nerd Font Propo': 44 },
      ['Arial', 'Segoe UI'],
    );

    expect(isFixedWidthFont('Cascadia Mono', measure)).toBe(true);
    expect(isFixedWidthFont('MesloLGS NF', measure)).toBe(true);
    expect(isFixedWidthFont('Arial', measure)).toBe(false);
    expect(isFixedWidthFont('Segoe UI', measure)).toBe(false);
    expect(isFixedWidthFont('Not Installed Mono', measure)).toBe(false);
    expect(isFixedWidthFont('Cousine Nerd Font Propo', measure)).toBe(false);
  });

  it('collapses weight variants when the base family exists and sorts alphabetically', () => {
    const collapsed = collapseWeightVariants([
      'Source Code Pro',
      'Source Code Pro Light',
      'Source Code Pro SemiBold',
      'Cascadia Code ExtraLight',
      'Cascadia Code',
      'Consolas',
      'Ubuntu Mono',
      'Ubuntu Mono Medium',
    ]);
    expect(collapsed).toEqual(['Cascadia Code', 'Consolas', 'Source Code Pro', 'Ubuntu Mono']);
  });

  it('detects only installed console fonts from candidate + local font lists', async () => {
    const measureWidth = createMockMeasurer(
      {
        Consolas: 40,
        'Cascadia Code': 42,
        'Cascadia Code SemiBold': 42,
        'Custom Console NF': 43,
        SimSun: 36,
      },
      ['Arial', 'Times New Roman'],
    );
    const queryLocalFonts = vi.fn(async () => [
      { family: 'Arial' },
      { family: 'Custom Console NF' },
      { family: 'Cascadia Code' },
      { family: 'Cascadia Code SemiBold' },
      { family: 'SimSun' },
      { family: 'Cousine Nerd Font Propo' },
    ]);

    const fonts = await detectConsoleFonts({ measureWidth, queryLocalFonts });
    expect(fonts).toEqual(['Cascadia Code', 'Consolas', 'Custom Console NF']);
  });

  it('falls back gracefully when Canvas measurement is unavailable', async () => {
    const fonts = await detectConsoleFonts({ measureWidth: null, queryLocalFonts: null });
    expect(fonts).toEqual([...FALLBACK_CONSOLE_FONTS]);
  });

  it('dispatches the terminal font change event', () => {
    const handler = vi.fn();
    window.addEventListener(TERMINAL_FONT_CHANGED_EVENT, handler);
    notifyTerminalFontChanged('MesloLGS NF');
    window.removeEventListener(TERMINAL_FONT_CHANGED_EVENT, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe('MesloLGS NF');
  });
});
