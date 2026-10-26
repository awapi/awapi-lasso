import { describe, it, expect } from 'vitest';
import {
  detectExternalTerminals,
  detectShells,
  findOnPath,
  getEnv,
  getTerminalChoices,
  resolveExternalTerminals,
  resolveShell,
  type DetectionDeps,
} from './terminalDetection';

function deps(
  platform: NodeJS.Platform,
  files: string[],
  env: NodeJS.ProcessEnv = {},
  etcShells?: string,
  links: Record<string, string> = {},
): DetectionDeps {
  const set = new Set(files);
  return {
    platform,
    env,
    exists: p => set.has(p),
    readFile: p => (p === '/etc/shells' ? etcShells ?? null : null),
    realpath: p => links[p] ?? (set.has(p) ? p : null),
  };
}

const WIN_ENV = {
  Path: 'C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7',
  SystemRoot: 'C:\\Windows',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
};
const WT = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe';
const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const WSL = 'C:\\Windows\\System32\\wsl.exe';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

describe('getEnv / findOnPath', () => {
  it('reads env vars case-insensitively on Windows only', () => {
    expect(getEnv({ Path: 'x' }, 'win32', 'PATH')).toBe('x');
    expect(getEnv({ Path: 'x' }, 'linux', 'PATH')).toBeUndefined();
  });

  it('searches PATH with the platform separator and checks absolute names directly', () => {
    expect(findOnPath('zsh', deps('darwin', ['/opt/bin/zsh'], { PATH: '/usr/bin:/opt/bin' }))).toBe('/opt/bin/zsh');
    expect(findOnPath('pwsh.exe', deps('win32', [PWSH], WIN_ENV))).toBe(PWSH);
    expect(findOnPath('/bin/fish', deps('linux', ['/bin/fish']))).toBe('/bin/fish');
    expect(findOnPath('nope', deps('linux', [], { PATH: '/usr/bin' }))).toBeNull();
  });
});

describe('detectExternalTerminals', () => {
  it('always offers Terminal on macOS plus installed third-party apps', () => {
    const terminals = detectExternalTerminals(
      deps('darwin', ['/Applications/Warp.app', '/Users/me/Applications/iTerm.app'], { HOME: '/Users/me' }),
    );
    expect(terminals.map(t => [t.id, t.detail])).toEqual([
      ['terminal', 'Terminal'],
      ['iterm', '/Users/me/Applications/iTerm.app'],
      ['warp', '/Applications/Warp.app'],
    ]);
  });

  it('orders Windows terminals as Windows Terminal, PowerShell 7, Windows PowerShell, cmd, Git Bash', () => {
    const terminals = detectExternalTerminals(deps('win32', [WT, PWSH, GIT_BASH], WIN_ENV));
    expect(terminals.map(t => t.id)).toEqual(['windows-terminal', 'pwsh', 'powershell', 'cmd', 'git-bash']);
    expect(terminals[0].args('C:\\x')).toEqual(['/d', '/c', 'start', '""', 'wt.exe', '-d', '.']);
    expect(terminals[1].args('C:\\x')).toEqual(['/d', '/c', 'start', '""', `"${PWSH}"`]);
    expect(terminals[4].detail).toBe('C:\\Program Files\\Git\\git-bash.exe');
  });

  it('always offers Windows PowerShell and cmd even on a bare Windows install', () => {
    const terminals = detectExternalTerminals(deps('win32', [], WIN_ENV));
    expect(terminals.map(t => t.id)).toEqual(['powershell', 'cmd']);
  });

  it('launches the real target of x-terminal-emulator with its working-directory flags (Ubuntu/Mint)', () => {
    const ubuntu = detectExternalTerminals(
      deps('linux', ['/usr/bin/x-terminal-emulator', '/usr/bin/gnome-terminal'], { PATH: '/usr/bin' }, undefined, {
        '/usr/bin/x-terminal-emulator': '/usr/bin/gnome-terminal.wrapper',
      }),
    );
    expect(ubuntu[0]).toMatchObject({ id: 'x-terminal-emulator', label: 'System default (GNOME Terminal)', command: '/usr/bin/gnome-terminal' });
    expect(ubuntu[0].args('/p')).toEqual(['--working-directory=/p']);

    const ptyxis = detectExternalTerminals(
      deps('linux', ['/usr/bin/x-terminal-emulator', '/usr/bin/ptyxis'], { PATH: '/usr/bin' }, undefined, {
        '/usr/bin/x-terminal-emulator': '/usr/bin/ptyxis',
      }),
    );
    expect(ptyxis[0]).toMatchObject({ label: 'System default (Ptyxis)', command: '/usr/bin/ptyxis' });
    expect(ptyxis[0].args('/p')).toEqual(['--new-window', '--working-directory=/p']);
    expect(ptyxis.map(t => t.id)).toEqual(['x-terminal-emulator', 'ptyxis']);
  });

  it('falls back to plain x-terminal-emulator when its target is unknown or unresolvable', () => {
    const unknown = detectExternalTerminals(
      deps('linux', ['/usr/bin/x-terminal-emulator'], { PATH: '/usr/bin' }, undefined, {
        '/usr/bin/x-terminal-emulator': '/usr/bin/terminator',
      }),
    );
    expect(unknown[0]).toMatchObject({ label: 'System default (x-terminal-emulator)', command: '/usr/bin/x-terminal-emulator', detail: '/usr/bin/terminator' });
    expect(unknown[0].args('/p')).toEqual([]);

    const broken = detectExternalTerminals({
      ...deps('linux', ['/usr/bin/x-terminal-emulator'], { PATH: '/usr/bin' }),
      realpath: () => null,
    });
    expect(broken[0]).toMatchObject({ command: '/usr/bin/x-terminal-emulator', detail: '/usr/bin/x-terminal-emulator' });
  });

  it('lists only installed Linux terminals', () => {
    const terminals = detectExternalTerminals(deps('linux', ['/usr/bin/konsole', '/usr/bin/xterm'], { PATH: '/usr/bin' }));
    expect(terminals.map(t => t.id)).toEqual(['konsole', 'xterm']);
  });
});

describe('resolveExternalTerminals', () => {
  it('returns all detected terminals in automatic mode', () => {
    const d = deps('win32', [PWSH], WIN_ENV);
    expect(resolveExternalTerminals(null, d).map(t => t.id)).toEqual(['pwsh', 'powershell', 'cmd']);
    expect(resolveExternalTerminals('  ', d).map(t => t.id)).toEqual(['pwsh', 'powershell', 'cmd']);
  });

  it('returns only the chosen terminal for a known id', () => {
    expect(resolveExternalTerminals('cmd', deps('win32', [PWSH], WIN_ENV)).map(t => t.id)).toEqual(['cmd']);
  });

  it('treats unknown values as custom executables or apps', () => {
    const [win] = resolveExternalTerminals('C:\\Tools\\My Term.exe', deps('win32', [], WIN_ENV));
    expect(win.args('C:\\x')).toEqual(['/d', '/c', 'start', '""', '"C:\\Tools\\My Term.exe"']);

    const [linux] = resolveExternalTerminals('/opt/kitty/kitty', deps('linux', []));
    expect(linux.command).toBe('/opt/kitty/kitty');
    expect(linux.args('/p')).toEqual(['--directory', '/p']);
  });

  it('puts $TERMINAL first on Linux, even if it is not in the known list', () => {
    const d = deps('linux', ['/usr/bin/xterm'], { PATH: '/usr/bin', TERMINAL: 'foot' });
    expect(resolveExternalTerminals(null, d).map(t => t.command)).toEqual(['foot', '/usr/bin/xterm']);
  });
});

describe('detectShells / resolveShell', () => {
  const etcShells = '# comment\n/bin/bash\n/bin/zsh\n/bin/missing\n\n/bin/zsh\n';

  it('reads /etc/shells, puts $SHELL first, and starts login shells on macOS', () => {
    const d = deps('darwin', ['/bin/bash', '/bin/zsh', '/opt/homebrew/bin/fish'], { SHELL: '/opt/homebrew/bin/fish' }, etcShells);
    const shells = detectShells(d);
    expect(shells.map(s => s.file)).toEqual(['/opt/homebrew/bin/fish', '/bin/bash', '/bin/zsh']);
    expect(shells.every(s => s.args[0] === '-l')).toBe(true);
    expect(resolveShell(null, d)?.file).toBe('/opt/homebrew/bin/fish');
  });

  it('does not add login flags on Linux and falls back to bash without $SHELL', () => {
    const d = deps('linux', ['/bin/bash', '/bin/zsh'], {}, etcShells);
    expect(resolveShell(null, d)).toMatchObject({ file: '/bin/bash', args: [] });
  });

  it('falls back to /bin/sh when nothing is detected', () => {
    expect(resolveShell(null, deps('linux', []))?.file).toBe('/bin/sh');
  });

  it('detects Windows shells and defaults to pwsh, then powershell', () => {
    const full = deps('win32', [PWSH, GIT_BASH, WSL], WIN_ENV);
    expect(detectShells(full).map(s => s.id)).toEqual(['pwsh', 'powershell', 'cmd', 'git-bash', 'wsl']);
    expect(resolveShell(null, full)).toMatchObject({ id: 'pwsh', file: PWSH, args: ['-NoLogo'] });
    expect(resolveShell(null, deps('win32', [], WIN_ENV))).toMatchObject({ id: 'powershell', file: POWERSHELL });
  });

  it('keeps Git Bash in the starting folder', () => {
    expect(resolveShell('git-bash', deps('win32', [GIT_BASH], WIN_ENV))).toMatchObject({
      file: GIT_BASH,
      args: ['--login', '-i'],
      env: { CHERE_INVOKING: '1' },
    });
  });

  it('resolves custom shells via PATH and returns null when missing', () => {
    const d = deps('linux', ['/usr/local/bin/nu'], { PATH: '/usr/local/bin' });
    expect(resolveShell('nu', d)?.file).toBe('/usr/local/bin/nu');
    expect(resolveShell('/bin/nope', d)).toBeNull();
    expect(resolveShell('C:\\Tools\\nu.exe', deps('win32', ['C:\\Tools\\nu.exe'], WIN_ENV))).toMatchObject({ file: 'C:\\Tools\\nu.exe', args: [] });
  });
});

describe('getTerminalChoices', () => {
  it('returns serializable choices and the automatic labels', () => {
    const choices = getTerminalChoices(deps('win32', [WT, PWSH], WIN_ENV));
    expect(choices.platform).toBe('win32');
    expect(choices.autoExternalTerminal).toBe('Windows Terminal');
    expect(choices.autoShell).toBe('PowerShell 7');
    expect(choices.shells[0]).toEqual({ id: 'pwsh', label: 'PowerShell 7', detail: PWSH });
    expect(JSON.parse(JSON.stringify(choices))).toEqual(choices);
  });
});
