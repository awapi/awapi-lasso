import type { TerminalChoice, TerminalChoices, TerminalPreference } from '../shared/terminal';

/**
 * Detects terminal applications (for "Open in External Terminal") and shells
 * (for the integrated terminal) available on the current machine, and
 * resolves the user's stored preference to something launchable.
 *
 * All OS access is injected so the logic is unit-testable on any platform.
 */
export interface DetectionDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Whether anything exists at `p` (must also work for Windows app execution aliases). */
  exists: (p: string) => boolean;
  /** Reads a UTF-8 text file, or returns null if it cannot be read. */
  readFile: (p: string) => string | null;
  /** Resolves symlinks (e.g. Debian's /etc/alternatives), or returns null. */
  realpath: (p: string) => string | null;
}

/** An external terminal application and how to launch it in a folder. */
export interface ExternalTerminalSpec extends TerminalChoice {
  command: string;
  args: (cwd: string) => string[];
}

/** A shell the integrated terminal can run. */
export interface ShellSpec extends TerminalChoice {
  file: string;
  args: string[];
  env?: Record<string, string>;
}

// ── Path helpers (platform-aware without importing `path`) ───────────────────

function sep(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '\\' : '/';
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  const s = sep(platform);
  return parts
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter(Boolean)
    .join(s);
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function isAbsolutePath(platform: NodeJS.Platform, p: string): boolean {
  return platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\)/.test(p) : p.startsWith('/');
}

/** Reads an env var; case-insensitive on Windows (plain objects are not). */
export function getEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, key: string): string | undefined {
  if (platform !== 'win32') return env[key];
  const match = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

/** Finds `name` in PATH, returning its full path. Absolute names are checked directly. */
export function findOnPath(name: string, deps: DetectionDeps): string | null {
  const { platform, env, exists } = deps;
  if (isAbsolutePath(platform, name)) return exists(name) ? name : null;
  const pathVar = getEnv(env, platform, 'PATH') ?? '';
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const candidate = joinPath(platform, dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Quotes a Windows command-line argument containing spaces (paths cannot contain `"`). */
function winQuote(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

// ── External terminals ───────────────────────────────────────────────────────

const MAC_TERMINAL_APPS: Array<{ id: string; label: string; app: string }> = [
  { id: 'iterm', label: 'iTerm2', app: 'iTerm.app' },
  { id: 'warp', label: 'Warp', app: 'Warp.app' },
  { id: 'ghostty', label: 'Ghostty', app: 'Ghostty.app' },
];

/** Linux terminal emulators, with the argument each needs to start in `cwd`. */
const LINUX_TERMINALS: Array<{ id: string; label: string; args: (cwd: string) => string[] }> = [
  { id: 'x-terminal-emulator', label: 'System default (x-terminal-emulator)', args: () => [] },
  { id: 'gnome-terminal', label: 'GNOME Terminal', args: cwd => [`--working-directory=${cwd}`] },
  // Ptyxis is single-instance: without --new-window it may just focus an existing window.
  { id: 'ptyxis', label: 'Ptyxis', args: cwd => ['--new-window', `--working-directory=${cwd}`] },
  { id: 'kgx', label: 'GNOME Console', args: cwd => [`--working-directory=${cwd}`] },
  { id: 'konsole', label: 'Konsole', args: cwd => ['--workdir', cwd] },
  { id: 'xfce4-terminal', label: 'Xfce Terminal', args: cwd => [`--working-directory=${cwd}`] },
  { id: 'mate-terminal', label: 'MATE Terminal', args: cwd => [`--working-directory=${cwd}`] },
  { id: 'tilix', label: 'Tilix', args: cwd => [`--working-directory=${cwd}`] },
  { id: 'ghostty', label: 'Ghostty', args: cwd => [`--working-directory=${cwd}`] },
  { id: 'wezterm', label: 'WezTerm', args: cwd => ['start', '--cwd', cwd] },
  { id: 'alacritty', label: 'Alacritty', args: cwd => ['--working-directory', cwd] },
  { id: 'kitty', label: 'kitty', args: cwd => ['--directory', cwd] },
  { id: 'xterm', label: 'XTerm', args: () => [] },
];

function macOpenSpec(id: string, label: string, app: string): ExternalTerminalSpec {
  return { id, label, detail: app, command: 'open', args: () => ['-a', app, '.'] };
}

/** `cmd /c start "" <exe>` gives console programs their own window (as VS Code does). */
function windowsStartSpec(
  id: string,
  label: string,
  exe: string,
  extraArgs: string[],
  deps: DetectionDeps,
  launchName = exe,
): ExternalTerminalSpec {
  const cmd = getEnv(deps.env, deps.platform, 'ComSpec') || 'cmd.exe';
  return {
    id,
    label,
    detail: exe,
    command: cmd,
    args: () => ['/d', '/c', 'start', '""', winQuote(launchName), ...extraArgs],
  };
}

function findWindowsExe(deps: DetectionDeps, name: string, extraLocations: string[]): string | null {
  for (const p of extraLocations) {
    if (p && deps.exists(p)) return p;
  }
  return findOnPath(name, deps);
}

function windowsPaths(deps: DetectionDeps) {
  const e = (k: string) => getEnv(deps.env, 'win32', k);
  const systemRoot = e('SystemRoot') || e('windir') || 'C:\\Windows';
  const programFiles = e('ProgramFiles') || 'C:\\Program Files';
  const localAppData = e('LOCALAPPDATA');
  const j = (...parts: string[]) => joinPath('win32', ...parts);
  return {
    wt: findWindowsExe(deps, 'wt.exe', [localAppData ? j(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe') : '']),
    pwsh: findWindowsExe(deps, 'pwsh.exe', [
      j(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      localAppData ? j(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe') : '',
    ]),
    powershell: j(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    cmd: e('ComSpec') || j(systemRoot, 'System32', 'cmd.exe'),
    gitDir: [j(programFiles, 'Git'), j(e('ProgramFiles(x86)') || 'C:\\Program Files (x86)', 'Git')].find(d =>
      deps.exists(j(d, 'bin', 'bash.exe')),
    ),
    wsl: deps.exists(j(systemRoot, 'System32', 'wsl.exe')) ? j(systemRoot, 'System32', 'wsl.exe') : null,
  };
}

/** Lists the external terminal applications available on this machine, in "Automatic" priority order. */
export function detectExternalTerminals(deps: DetectionDeps): ExternalTerminalSpec[] {
  const { platform, env, exists } = deps;
  if (platform === 'darwin') {
    const specs = [macOpenSpec('terminal', 'Terminal', 'Terminal')];
    const home = env.HOME;
    for (const { id, label, app } of MAC_TERMINAL_APPS) {
      const found = ['/Applications', home ? `${home}/Applications` : '']
        .filter(Boolean)
        .map(dir => `${dir}/${app}`)
        .find(exists);
      if (found) specs.push(macOpenSpec(id, label, found));
    }
    return specs;
  }
  if (platform === 'win32') {
    const p = windowsPaths(deps);
    const specs: ExternalTerminalSpec[] = [];
    // `start` resolves the wt.exe app alias itself, so pass the bare name.
    if (p.wt) specs.push(windowsStartSpec('windows-terminal', 'Windows Terminal', p.wt, ['-d', '.'], deps, 'wt.exe'));
    if (p.pwsh) specs.push(windowsStartSpec('pwsh', 'PowerShell 7', p.pwsh, [], deps));
    specs.push(windowsStartSpec('powershell', 'Windows PowerShell', p.powershell, [], deps));
    specs.push(windowsStartSpec('cmd', 'Command Prompt', p.cmd, [], deps));
    if (p.gitDir) {
      specs.push(windowsStartSpec('git-bash', 'Git Bash', joinPath('win32', p.gitDir, 'git-bash.exe'), [], deps));
    }
    return specs;
  }
  return LINUX_TERMINALS.flatMap(({ id, label, args }) => {
    const found = findOnPath(id, deps);
    if (!found) return [];
    if (id === 'x-terminal-emulator') return [resolveSystemDefaultTerminal(found, label, deps)];
    return [{ id, label, detail: found, command: found, args }];
  });
}

/**
 * Debian/Ubuntu/Mint point x-terminal-emulator (via /etc/alternatives) at the
 * user's default terminal. Launch that terminal directly with its own
 * working-directory flags instead of relying on it inheriting our cwd.
 */
function resolveSystemDefaultTerminal(
  found: string,
  label: string,
  deps: DetectionDeps,
): ExternalTerminalSpec {
  const target = deps.realpath(found);
  // e.g. gnome-terminal.wrapper (xterm-option translator) -> gnome-terminal
  const name = target ? basename(target).replace(/\.wrapper$/, '') : null;
  const known = name ? LINUX_TERMINALS.find(t => t.id === name && t.id !== 'x-terminal-emulator') : undefined;
  const command = known ? findOnPath(known.id, deps) : null;
  if (known && command) {
    return { id: 'x-terminal-emulator', label: `System default (${known.label})`, detail: command, command, args: known.args };
  }
  return { id: 'x-terminal-emulator', label, detail: target ?? found, command: found, args: () => [] };
}

/** Builds a launch spec for a custom terminal value (app name/path, or executable). */
function customExternalTerminal(value: string, deps: DetectionDeps): ExternalTerminalSpec {
  if (deps.platform === 'darwin') return macOpenSpec(value, value, value);
  if (deps.platform === 'win32') return windowsStartSpec(value, value, value, [], deps);
  const known = LINUX_TERMINALS.find(t => t.id === basename(value));
  return { id: value, label: value, detail: value, command: value, args: known?.args ?? (() => []) };
}

/**
 * Resolves the stored preference to an ordered list of terminals to try.
 * Automatic returns every detected terminal (so Linux can fall back when one
 * fails to start); explicit choices return just that terminal.
 */
export function resolveExternalTerminals(
  preference: TerminalPreference | undefined,
  deps: DetectionDeps,
): ExternalTerminalSpec[] {
  const detected = detectExternalTerminals(deps);
  const value = preference?.trim();
  if (value) {
    return [detected.find(t => t.id === value) ?? customExternalTerminal(value, deps)];
  }
  if (deps.platform === 'linux' || deps.platform === 'freebsd' || deps.platform === 'openbsd') {
    const preferred = deps.env.TERMINAL?.trim();
    if (preferred) {
      const spec = detected.find(t => t.id === preferred || t.command === preferred) ??
        customExternalTerminal(preferred, deps);
      return [spec, ...detected.filter(t => t !== spec)];
    }
  }
  return detected;
}

// ── Shells (integrated terminal) ─────────────────────────────────────────────

const LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'ksh', 'tcsh', 'csh', 'dash', 'nu']);

function unixShellSpec(file: string, platform: NodeJS.Platform): ShellSpec {
  const name = basename(file);
  // GUI apps on macOS don't inherit the user's PATH, so start a login shell
  // to load their profile (matches VS Code and Terminal.app).
  const args = platform === 'darwin' && LOGIN_SHELLS.has(name) ? ['-l'] : [];
  return { id: file, label: name, detail: file, file, args };
}

/** Lists shells available for the integrated terminal on this machine. */
export function detectShells(deps: DetectionDeps): ShellSpec[] {
  const { platform, env, exists } = deps;
  if (platform === 'win32') {
    const p = windowsPaths(deps);
    const shells: ShellSpec[] = [];
    if (p.pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', detail: p.pwsh, file: p.pwsh, args: ['-NoLogo'] });
    shells.push({ id: 'powershell', label: 'Windows PowerShell', detail: p.powershell, file: p.powershell, args: ['-NoLogo'] });
    shells.push({ id: 'cmd', label: 'Command Prompt', detail: p.cmd, file: p.cmd, args: [] });
    if (p.gitDir) {
      const bash = joinPath('win32', p.gitDir, 'bin', 'bash.exe');
      // CHERE_INVOKING keeps the login profile from cd-ing to $HOME.
      shells.push({ id: 'git-bash', label: 'Git Bash', detail: bash, file: bash, args: ['--login', '-i'], env: { CHERE_INVOKING: '1' } });
    }
    if (p.wsl) shells.push({ id: 'wsl', label: 'WSL', detail: p.wsl, file: p.wsl, args: [] });
    return shells;
  }

  const seen = new Set<string>();
  const shells: ShellSpec[] = [];
  const add = (file: string | undefined) => {
    if (!file || seen.has(file) || !isAbsolutePath(platform, file) || !exists(file)) return;
    seen.add(file);
    shells.push(unixShellSpec(file, platform));
  };
  add(env.SHELL);
  for (const line of (deps.readFile('/etc/shells') ?? '').split('\n')) {
    const file = line.trim();
    if (file && !file.startsWith('#')) add(file);
  }
  return shells;
}

function defaultShell(shells: ShellSpec[], deps: DetectionDeps): ShellSpec | null {
  if (deps.platform === 'win32') {
    return ['pwsh', 'powershell', 'cmd'].map(id => shells.find(s => s.id === id)).find(Boolean) ?? null;
  }
  const fromEnv = shells.find(s => s.file === deps.env.SHELL);
  if (fromEnv) return fromEnv;
  const fallback = deps.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return shells.find(s => s.file === fallback) ?? shells[0] ?? unixShellSpec('/bin/sh', deps.platform);
}

/**
 * Resolves the stored shell preference. Returns null when a custom shell
 * cannot be found.
 */
export function resolveShell(preference: TerminalPreference | undefined, deps: DetectionDeps): ShellSpec | null {
  const shells = detectShells(deps);
  const value = preference?.trim();
  if (!value) return defaultShell(shells, deps);
  const match = shells.find(s => s.id === value);
  if (match) return match;
  const file = findOnPath(value, deps);
  if (!file) return null;
  if (deps.platform === 'win32') return { id: value, label: basename(file), detail: file, file, args: [] };
  return unixShellSpec(file, deps.platform);
}

/** Choices for the Preferences UI. */
export function getTerminalChoices(deps: DetectionDeps): TerminalChoices {
  const strip = ({ id, label, detail }: TerminalChoice): TerminalChoice => ({ id, label, detail });
  const shells = detectShells(deps);
  return {
    platform: deps.platform,
    externalTerminals: detectExternalTerminals(deps).map(strip),
    shells: shells.map(strip),
    autoExternalTerminal: resolveExternalTerminals(null, deps)[0]?.label ?? null,
    autoShell: defaultShell(shells, deps)?.label ?? null,
  };
}
