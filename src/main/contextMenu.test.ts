import { describe, it, expect, vi } from 'vitest';
import {
  CONTEXT_MENU_KEY,
  CONTEXT_MENU_COMMAND_KEY,
  CONTEXT_MENU_DIR_KEY,
  CONTEXT_MENU_DIR_COMMAND_KEY,
  CONTEXT_MENU_DIR_BG_KEY,
  CONTEXT_MENU_DIR_BG_COMMAND_KEY,
  CONTEXT_MENU_LABEL,
  buildQueryArgs,
  buildQueryCommands,
  buildRegisterCommands,
  buildUnregisterArgs,
  buildUnregisterCommands,
  isContextMenuSupported,
  getContextMenuStatus,
  setContextMenuEnabled,
  type ContextMenuDeps,
} from './contextMenu';

function createDeps(overrides: Partial<ContextMenuDeps> = {}): ContextMenuDeps {
  return {
    platform: 'win32',
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\AwapiLasso\\AwapiLasso.exe',
    isPackaged: true,
    runReg: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('contextMenu', () => {
  describe('command builders', () => {
    it('builds query args for HKCU\\Software\\Classes\\*\\shell\\AwapiLasso', () => {
      expect(CONTEXT_MENU_KEY).toBe('HKCU\\Software\\Classes\\*\\shell\\AwapiLasso');
      expect(CONTEXT_MENU_LABEL).toBe('Open with AwapiLasso');
      expect(buildQueryArgs()).toEqual(['query', CONTEXT_MENU_COMMAND_KEY, '/ve']);
      expect(buildQueryCommands()).toEqual([
        ['query', CONTEXT_MENU_COMMAND_KEY, '/ve'],
        ['query', CONTEXT_MENU_DIR_COMMAND_KEY, '/ve'],
        ['query', CONTEXT_MENU_DIR_BG_COMMAND_KEY, '/ve'],
      ]);
    });

    it('builds registration commands for files (*), folders (Directory), and folder backgrounds (Directory\\Background)', () => {
      const exe = 'C:\\Program Files\\AwapiLasso\\AwapiLasso.exe';
      expect(buildRegisterCommands(exe)).toEqual([
        ['add', CONTEXT_MENU_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f'],
        ['add', CONTEXT_MENU_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f'],
        ['add', CONTEXT_MENU_DIR_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_DIR_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f'],
        ['add', CONTEXT_MENU_DIR_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%1"`, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${exe}",0`, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "%V"`, '/f'],
      ]);
    });

    it('uses iconPath and appEntryPath when running unpackaged (dev mode)', () => {
      const exe = 'C:\\repo\\node_modules\\electron\\dist\\electron.exe';
      const iconPath = 'C:\\repo\\build\\icon.ico';
      const appEntryPath = 'C:\\repo\\dist\\main\\main.js';
      expect(
        buildRegisterCommands({
          execPath: exe,
          isPackaged: false,
          iconPath,
          appEntryPath,
        }),
      ).toEqual([
        ['add', CONTEXT_MENU_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${iconPath}"`, '/f'],
        ['add', CONTEXT_MENU_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "${appEntryPath}" "%1"`, '/f'],
        ['add', CONTEXT_MENU_DIR_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_DIR_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${iconPath}"`, '/f'],
        ['add', CONTEXT_MENU_DIR_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "${appEntryPath}" "%1"`, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${iconPath}"`, '/f'],
        ['add', CONTEXT_MENU_DIR_BG_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', `"${exe}" "${appEntryPath}" "%V"`, '/f'],
      ]);
    });

    it('builds unregister args to delete the shell keys', () => {
      expect(buildUnregisterArgs()).toEqual(['delete', CONTEXT_MENU_KEY, '/f']);
      expect(buildUnregisterCommands()).toEqual([
        ['delete', CONTEXT_MENU_KEY, '/f'],
        ['delete', CONTEXT_MENU_DIR_KEY, '/f'],
        ['delete', CONTEXT_MENU_DIR_BG_KEY, '/f'],
      ]);
    });
  });

  describe('isContextMenuSupported', () => {
    it('returns true on win32 with a non-empty execPath', () => {
      expect(isContextMenuSupported({ platform: 'win32', execPath: 'C:\\AwapiLasso.exe' })).toBe(true);
    });

    it('returns false on macOS and Linux or when execPath is empty', () => {
      expect(isContextMenuSupported({ platform: 'darwin', execPath: '/Applications/AwapiLasso' })).toBe(false);
      expect(isContextMenuSupported({ platform: 'linux', execPath: '/usr/bin/awapi-lasso' })).toBe(false);
      expect(isContextMenuSupported({ platform: 'win32', execPath: '' })).toBe(false);
    });
  });

  describe('getContextMenuStatus', () => {
    it('returns supported: false on non-Windows platforms without invoking reg.exe', async () => {
      const runReg = vi.fn();
      const status = await getContextMenuStatus(createDeps({ platform: 'darwin', runReg }));
      expect(status).toEqual({ supported: false, enabled: false });
      expect(runReg).not.toHaveBeenCalled();
    });

    it('returns enabled: true when all reg queries succeed with code 0', async () => {
      const runReg = vi.fn().mockResolvedValue({ code: 0, stdout: 'REG_SZ', stderr: '' });
      const status = await getContextMenuStatus(createDeps({ runReg }));
      expect(status).toEqual({ supported: true, enabled: true });
      expect(runReg).toHaveBeenCalledTimes(3);
      expect(runReg.mock.calls.map(c => c[0])).toEqual(buildQueryCommands());
    });

    it('returns enabled: false when any reg query exits non-zero or throws', async () => {
      const runRegMissing = vi.fn().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'ERROR: The system was unable to find the specified registry key or value.',
      });
      expect(await getContextMenuStatus(createDeps({ runReg: runRegMissing }))).toEqual({
        supported: true,
        enabled: false,
      });

      const runRegThrows = vi.fn().mockRejectedValue(new Error('spawn EACCES'));
      expect(await getContextMenuStatus(createDeps({ runReg: runRegThrows }))).toEqual({
        supported: true,
        enabled: false,
      });
    });
  });

  describe('setContextMenuEnabled', () => {
    it('fails gracefully on non-Windows platforms', async () => {
      const res = await setContextMenuEnabled(true, createDeps({ platform: 'linux' }));
      expect(res.ok).toBe(false);
      expect(res.enabled).toBe(false);
    });

    it('registers file, folder, and folder-background keys when enabling', async () => {
      const runReg = vi.fn().mockResolvedValue({ code: 0, stdout: 'The operation completed successfully.', stderr: '' });
      const deps = createDeps({ runReg });
      const res = await setContextMenuEnabled(true, deps);

      expect(res).toEqual({ ok: true, enabled: true });
      expect(runReg).toHaveBeenCalledTimes(9);
      expect(runReg.mock.calls.map(c => c[0])).toEqual(buildRegisterCommands(deps.execPath));
    });

    it('returns an error if any reg add command fails during enable', async () => {
      const runReg = vi
        .fn()
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'ERROR: Access is denied.' });
      const res = await setContextMenuEnabled(true, createDeps({ runReg }));

      expect(res).toEqual({
        ok: false,
        enabled: false,
        error: 'ERROR: Access is denied.',
      });
      expect(runReg).toHaveBeenCalledTimes(2);
    });

    it('deletes the shell keys when disabling', async () => {
      const runReg = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
      const res = await setContextMenuEnabled(false, createDeps({ runReg }));

      expect(res).toEqual({ ok: true, enabled: false });
      expect(runReg).toHaveBeenCalledTimes(3);
      expect(runReg.mock.calls.map(c => c[0])).toEqual(buildUnregisterCommands());
    });
  });
});
