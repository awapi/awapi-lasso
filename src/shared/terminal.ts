/**
 * Types shared by the main process, preload bridge, and renderer for the
 * external-terminal launcher and the integrated terminal.
 */

/** A terminal application or shell the user can pick in Preferences. */
export interface TerminalChoice {
  /** Stable id stored in settings (e.g. "windows-terminal", "pwsh"). */
  id: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Executable or app the choice resolves to on this machine. */
  detail: string;
}

/** Choices available on the current machine, returned by `terminal:getChoices`. */
export interface TerminalChoices {
  platform: string;
  externalTerminals: TerminalChoice[];
  shells: TerminalChoice[];
  /** Label of what "Automatic" resolves to for each setting. */
  autoExternalTerminal: string | null;
  autoShell: string | null;
}

/**
 * Stored preference value. `null`/missing = automatic; a value matching a
 * `TerminalChoice.id` selects that choice; any other string is treated as a
 * custom executable path (or, on macOS for external terminals, an app name).
 */
export type TerminalPreference = string | null;

export interface PtyCreateOptions {
  /** File or folder to start in. Files resolve to their parent folder; null = home folder. */
  cwd: string | null;
  cols: number;
  rows: number;
}

export type PtyCreateResult =
  | { ok: true; id: number; cwd: string; shell: string }
  | { ok: false; error: string };

export interface PtyDataEvent {
  id: number;
  data: string;
}

export interface PtyExitEvent {
  id: number;
  exitCode: number;
}
