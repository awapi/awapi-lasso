/** Keyboard rules for the integrated terminal. */

export type TerminalPlatform = 'mac' | 'windows' | 'linux';

export type TerminalKeyAction = 'copy' | 'paste' | 'toggle-panel' | 'new-terminal' | null;

export interface TerminalKeyEvent {
  type: string;
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function detectTerminalPlatform(userAgent: string): TerminalPlatform {
  if (/Mac|iPhone|iPad/i.test(userAgent)) return 'mac';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'linux';
}

function isCtrlBackquote(e: TerminalKeyEvent): boolean {
  return e.type === 'keydown' && e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote';
}

/** Ctrl+` toggles the terminal panel on every platform (as in VS Code). */
export function isToggleTerminalShortcut(e: TerminalKeyEvent): boolean {
  return isCtrlBackquote(e) && !e.shiftKey;
}

/** Ctrl+Shift+` opens a new integrated terminal on every platform (as in VS Code). */
export function isNewTerminalShortcut(e: TerminalKeyEvent): boolean {
  return isCtrlBackquote(e) && e.shiftKey;
}

/**
 * Decides what the terminal should do with a key event instead of sending it
 * to the shell. Returns null to let xterm handle it normally.
 *
 * - macOS: Cmd+C / Cmd+V go through the Edit menu, so nothing extra is needed.
 * - Windows/Linux: Ctrl+Shift+C / Ctrl+Shift+V copy and paste. Ctrl+C copies
 *   only when text is selected (otherwise it interrupts the shell, as in
 *   Windows Terminal). Ctrl+V pastes on Windows; on Linux it stays a control key.
 */
export function getTerminalKeyAction(
  e: TerminalKeyEvent,
  platform: TerminalPlatform,
  hasSelection: boolean,
): TerminalKeyAction {
  if (e.type !== 'keydown') return null;
  if (isToggleTerminalShortcut(e)) return 'toggle-panel';
  if (isNewTerminalShortcut(e)) return 'new-terminal';
  if (platform === 'mac' || !e.ctrlKey || e.metaKey || e.altKey) return null;

  const key = e.key.toLowerCase();
  if (e.shiftKey && key === 'c') return hasSelection ? 'copy' : null;
  if (e.shiftKey && key === 'v') return 'paste';
  if (!e.shiftKey && key === 'c' && hasSelection) return 'copy';
  if (!e.shiftKey && key === 'v' && platform === 'windows') return 'paste';
  return null;
}
