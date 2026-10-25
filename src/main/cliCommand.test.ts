import { describe, it, expect, vi } from 'vitest';
import {
  CLI_COMMAND_NAME,
  resolvePathFromCwd,
  fileArgsFromArgv,
  directoryArgsFromArgv,
  pathsFromArgv,
  resolveCliInstallPaths,
  buildWindowsCmdLauncher,
  buildPosixShellLauncher,
  isCliCommandSupported,
  getCliCommandStatus,
  setCliCommandEnabled,
  type CliCommandDeps,
} from './cliCommand';

function createDeps(overrides: Partial<CliCommandDeps> = {}): CliCommandDeps {
  return {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
    homeDir: 'C:\\Users\\me',
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\AwapiLasso\\AwapiLasso.exe',
    isPackaged: true,
    exists: vi.fn(() => false),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    ...overrides,
  };
}

describe('cliCommand', () => {
  it('uses awlasso as the CLI command name', () => {
    expect(CLI_COMMAND_NAME).toBe('awlasso');
  });

  describe('resolvePathFromCwd', () => {
    it('resolves relative Windows paths against cwd and normalizes . and .. segments', () => {
      expect(resolvePathFromCwd('win32', 'C:\\Users\\me\\project', 'api.awjc')).toBe(
        'C:\\Users\\me\\project\\api.awjc',
      );
      expect(resolvePathFromCwd('win32', 'C:\\Users\\me\\project\\sub', '..\\api.awj')).toBe(
        'C:\\Users\\me\\project\\api.awj',
      );
    });

    it('preserves absolute Windows and POSIX paths', () => {
      expect(resolvePathFromCwd('win32', 'C:\\other', 'D:\\work\\api.awjc')).toBe('D:\\work\\api.awjc');
      expect(resolvePathFromCwd('linux', '/home/me', '/etc/api.awjc')).toBe('/etc/api.awjc');
    });

    it('resolves relative POSIX paths against cwd', () => {
      expect(resolvePathFromCwd('darwin', '/Users/me/repo', './src/../my-api.awjc')).toBe(
        '/Users/me/repo/my-api.awjc',
      );
    });
  });

  describe('fileArgsFromArgv & pathsFromArgv', () => {
    it('extracts multiple files and resolves relative paths against workingDirectory', () => {
      const files = new Set([
        'C:\\Users\\me\\project\\a.awjc',
        'C:\\Users\\me\\project\\sub\\b.awj',
        'D:\\abs\\c.awjc',
      ]);
      const argv = [
        'C:\\Program Files\\AwapiLasso\\AwapiLasso.exe',
        '--some-electron-flag',
        'a.awjc',
        'sub\\b.awj',
        'D:\\abs\\c.awjc',
        'missing.awjc',
      ];

      const result = fileArgsFromArgv(argv, false, 'C:\\Users\\me\\project', {
        platform: 'win32',
        isFile: p => files.has(p),
      });

      expect(result).toEqual([
        'C:\\Users\\me\\project\\a.awjc',
        'C:\\Users\\me\\project\\sub\\b.awj',
        'D:\\abs\\c.awjc',
      ]);
    });

    it('skips electron and entry script in dev mode, and deduplicates paths', () => {
      const files = new Set(['/home/me/work/api.awjc']);
      const argv = [
        '/repo/node_modules/electron/dist/electron',
        '/repo/dist/main/main.js',
        'api.awjc',
        './api.awjc',
      ];

      const result = fileArgsFromArgv(argv, true, '/home/me/work', {
        platform: 'linux',
        isFile: p => files.has(p),
      });

      expect(result).toEqual(['/home/me/work/api.awjc']);
    });

    it('extracts both files and directories via pathsFromArgv and directoryArgsFromArgv', () => {
      const files = new Set(['C:\\Users\\me\\project\\a.awjc']);
      const dirs = new Set(['C:\\Users\\me\\project']);
      const argv = ['C:\\Program Files\\AwapiLasso\\AwapiLasso.exe', '.', 'a.awjc'];

      const deps = {
        platform: 'win32' as const,
        isFile: (p: string) => files.has(p),
        isDirectory: (p: string) => dirs.has(p),
      };

      expect(pathsFromArgv(argv, false, 'C:\\Users\\me\\project', deps)).toEqual({
        files: ['C:\\Users\\me\\project\\a.awjc'],
        directories: ['C:\\Users\\me\\project'],
      });
      expect(directoryArgsFromArgv(argv, false, 'C:\\Users\\me\\project', deps)).toEqual([
        'C:\\Users\\me\\project',
      ]);
    });
  });

  describe('resolveCliInstallPaths', () => {
    it('resolves WindowsApps path on win32', () => {
      const paths = resolveCliInstallPaths({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        homeDir: 'C:\\Users\\me',
      });
      expect(paths.primary).toBe(
        `C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\${CLI_COMMAND_NAME}.cmd`,
      );
      expect(paths.companionPosix).toBe(
        `C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\${CLI_COMMAND_NAME}`,
      );
    });

    it('resolves /usr/local/bin and fallbacks on darwin and linux', () => {
      const mac = resolveCliInstallPaths({ platform: 'darwin', env: {}, homeDir: '/Users/me' });
      expect(mac.candidates).toEqual([
        `/usr/local/bin/${CLI_COMMAND_NAME}`,
        `/opt/homebrew/bin/${CLI_COMMAND_NAME}`,
        `/Users/me/.local/bin/${CLI_COMMAND_NAME}`,
      ]);

      const linux = resolveCliInstallPaths({ platform: 'linux', env: {}, homeDir: '/home/me' });
      expect(linux.candidates).toEqual([
        `/home/me/.local/bin/${CLI_COMMAND_NAME}`,
        `/usr/local/bin/${CLI_COMMAND_NAME}`,
      ]);
    });
  });

  describe('launcher builders', () => {
    it('builds Windows .cmd launcher for packaged and dev builds', () => {
      const packaged = buildWindowsCmdLauncher({
        execPath: 'C:\\Program Files\\AwapiLasso\\AwapiLasso.exe',
        isPackaged: true,
      });
      expect(packaged).toContain('start "" /b "C:\\Program Files\\AwapiLasso\\AwapiLasso.exe" %*');

      const dev = buildWindowsCmdLauncher({
        execPath: 'C:\\repo\\electron.exe',
        isPackaged: false,
        appEntryPath: 'C:\\repo\\dist\\main\\main.js',
      });
      expect(dev).toContain('start "" /b "C:\\repo\\electron.exe" "C:\\repo\\dist\\main\\main.js" %*');
    });

    it('builds POSIX shell launcher for packaged and dev builds', () => {
      const packaged = buildPosixShellLauncher({
        execPath: '/Applications/AwapiLasso.app/Contents/MacOS/AwapiLasso',
        isPackaged: true,
      });
      expect(packaged).toContain(
        "nohup '/Applications/AwapiLasso.app/Contents/MacOS/AwapiLasso' \"$@\" >/dev/null 2>&1 &",
      );
    });
  });

  describe('getCliCommandStatus & setCliCommandEnabled', () => {
    it('reports supported status accurately', () => {
      expect(isCliCommandSupported(createDeps())).toBe(true);
      expect(isCliCommandSupported(createDeps({ execPath: '' }))).toBe(false);
    });

    it('reports enabled: true when launcher file exists', async () => {
      const cmdPath = `C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\${CLI_COMMAND_NAME}.cmd`;
      const deps = createDeps({
        exists: vi.fn(p => p === cmdPath),
      });
      const status = await getCliCommandStatus(deps);
      expect(status).toEqual({
        supported: true,
        enabled: true,
        commandPath: cmdPath,
      });
    });

    it('writes both .cmd and POSIX companion scripts on Windows when enabling', async () => {
      const writeFile = vi.fn();
      const mkdir = vi.fn();
      const deps = createDeps({ writeFile, mkdir });

      const res = await setCliCommandEnabled(true, deps);
      expect(res.ok).toBe(true);
      expect(res.enabled).toBe(true);
      expect(mkdir).toHaveBeenCalledWith('C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps');
      expect(writeFile).toHaveBeenCalledTimes(2);
      expect(writeFile.mock.calls[0][0]).toBe(
        `C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\${CLI_COMMAND_NAME}.cmd`,
      );
      expect(writeFile.mock.calls[1][0]).toBe(
        `C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\${CLI_COMMAND_NAME}`,
      );
    });

    it('falls back to ~/.local/bin/awlasso on macOS when /usr/local/bin is not writable', async () => {
      const writeFile = vi.fn((p: string) => {
        if (p.startsWith('/usr/local/bin') || p.startsWith('/opt/homebrew/bin')) {
          throw new Error('EACCES: permission denied');
        }
      });
      const deps = createDeps({
        platform: 'darwin',
        env: {},
        homeDir: '/Users/me',
        execPath: '/Applications/AwapiLasso.app/Contents/MacOS/AwapiLasso',
        writeFile,
      });

      const res = await setCliCommandEnabled(true, deps);
      expect(res).toEqual({
        ok: true,
        enabled: true,
        commandPath: `/Users/me/.local/bin/${CLI_COMMAND_NAME}`,
      });
    });

    it('removes installed launcher scripts when disabling', async () => {
      const unlink = vi.fn();
      const deps = createDeps({
        exists: vi.fn(() => true),
        unlink,
      });

      const res = await setCliCommandEnabled(false, deps);
      expect(res.ok).toBe(true);
      expect(res.enabled).toBe(false);
      expect(unlink).toHaveBeenCalledTimes(2);
    });
  });
});
