import { describe, it, expect } from 'vitest';
import {
  detectTerminalPlatform,
  getTerminalKeyAction,
  isNewTerminalShortcut,
  isToggleTerminalShortcut,
  type TerminalKeyEvent,
} from './terminalKeys';

function key(k: string, mods: Partial<TerminalKeyEvent> = {}): TerminalKeyEvent {
  return {
    type: 'keydown',
    key: k,
    code: k === '`' ? 'Backquote' : `Key${k.toUpperCase()}`,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe('detectTerminalPlatform', () => {
  it('maps user agents to platforms', () => {
    expect(detectTerminalPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectTerminalPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectTerminalPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
});

describe('isToggleTerminalShortcut', () => {
  it('matches Ctrl+` only', () => {
    expect(isToggleTerminalShortcut(key('`', { ctrlKey: true }))).toBe(true);
    expect(isToggleTerminalShortcut(key('`', { ctrlKey: true, type: 'keyup' }))).toBe(false);
    expect(isToggleTerminalShortcut(key('`', { metaKey: true }))).toBe(false);
    expect(isToggleTerminalShortcut(key('`', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isToggleTerminalShortcut(key('`', { ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

describe('isNewTerminalShortcut', () => {
  it('matches Ctrl+Shift+` only', () => {
    expect(isNewTerminalShortcut(key('~', { code: 'Backquote', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isNewTerminalShortcut(key('`', { ctrlKey: true }))).toBe(false);
    expect(isNewTerminalShortcut(key('`', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isNewTerminalShortcut(key('`', { ctrlKey: true, shiftKey: true, type: 'keyup' }))).toBe(false);
  });
});

describe('getTerminalKeyAction', () => {
  it('toggles the panel with Ctrl+` on every platform', () => {
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      expect(getTerminalKeyAction(key('`', { ctrlKey: true }), platform, false)).toBe('toggle-panel');
    }
  });

  it('opens a new terminal with Ctrl+Shift+` on every platform', () => {
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      expect(getTerminalKeyAction(key('`', { ctrlKey: true, shiftKey: true }), platform, true)).toBe('new-terminal');
    }
  });

  it('leaves macOS keys to the Edit menu and the shell', () => {
    expect(getTerminalKeyAction(key('c', { ctrlKey: true }), 'mac', true)).toBeNull();
    expect(getTerminalKeyAction(key('v', { metaKey: true }), 'mac', false)).toBeNull();
  });

  it('copies with Ctrl+C only when text is selected; otherwise it reaches the shell', () => {
    expect(getTerminalKeyAction(key('c', { ctrlKey: true }), 'windows', true)).toBe('copy');
    expect(getTerminalKeyAction(key('c', { ctrlKey: true }), 'windows', false)).toBeNull();
    expect(getTerminalKeyAction(key('c', { ctrlKey: true }), 'linux', true)).toBe('copy');
  });

  it('supports Ctrl+Shift+C / Ctrl+Shift+V on Windows and Linux', () => {
    expect(getTerminalKeyAction(key('C', { ctrlKey: true, shiftKey: true }), 'linux', true)).toBe('copy');
    expect(getTerminalKeyAction(key('C', { ctrlKey: true, shiftKey: true }), 'linux', false)).toBeNull();
    expect(getTerminalKeyAction(key('V', { ctrlKey: true, shiftKey: true }), 'linux', false)).toBe('paste');
    expect(getTerminalKeyAction(key('V', { ctrlKey: true, shiftKey: true }), 'windows', false)).toBe('paste');
  });

  it('pastes with Ctrl+V on Windows only', () => {
    expect(getTerminalKeyAction(key('v', { ctrlKey: true }), 'windows', false)).toBe('paste');
    expect(getTerminalKeyAction(key('v', { ctrlKey: true }), 'linux', false)).toBeNull();
  });

  it('ignores keyup, plain keys, and other modifier combinations', () => {
    expect(getTerminalKeyAction(key('c', { ctrlKey: true, type: 'keyup' }), 'windows', true)).toBeNull();
    expect(getTerminalKeyAction(key('c'), 'windows', true)).toBeNull();
    expect(getTerminalKeyAction(key('c', { ctrlKey: true, altKey: true }), 'windows', true)).toBeNull();
    expect(getTerminalKeyAction(key('d', { ctrlKey: true }), 'windows', true)).toBeNull();
  });
});
