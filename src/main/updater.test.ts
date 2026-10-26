import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0' },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  BrowserWindow: class {
    isDestroyed() { return false; }
  },
}));

import {
  LATEST_RELEASE_URL,
  isNewerVersion,
  fetchLatestRelease,
  checkForUpdates,
} from './updater';
import { BrowserWindow, dialog, shell } from 'electron';

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('points LATEST_RELEASE_URL to awapi/awapi-lasso', () => {
    expect(LATEST_RELEASE_URL).toBe(
      'https://api.github.com/repos/awapi/awapi-lasso/releases/latest',
    );
  });

  describe('isNewerVersion', () => {
    it('returns true when latest patch, minor, or major is higher', () => {
      expect(isNewerVersion('0.1.1', '0.1.0')).toBe(true);
      expect(isNewerVersion('0.2.0', '0.1.9')).toBe(true);
      expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    });

    it('strips leading "v" from tag', () => {
      expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
      expect(isNewerVersion('V1.0.0', '0.9.0')).toBe(true);
    });

    it('returns false when versions are equal or current is newer', () => {
      expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
      expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
      expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
    });

    it('handles malformed input without throwing', () => {
      expect(() => isNewerVersion('abc', '0.1.0')).not.toThrow();
      expect(isNewerVersion('abc', '0.1.0')).toBe(false);
      expect(isNewerVersion('0.1.0', 'abc')).toBe(true);
    });
  });

  describe('fetchLatestRelease & checkForUpdates', () => {
    it('fetches release metadata and opens external URL when user chooses Download', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
      }));

      const release = await fetchLatestRelease(mockFetch);
      expect(release?.tag_name).toBe('v0.2.0');

      await checkForUpdates({ fetchImpl: mockFetch });
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
      );
    });

    it('shows an up-to-date result for manual checks and stays silent for background checks', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.1.0',
      }));
      await checkForUpdates({ fetchImpl: mockFetch });
      expect(dialog.showMessageBox).not.toHaveBeenCalled();
      await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true });
      expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
        message: "You're up to date",
        detail: 'AwapiLasso 0.1.0 is the latest version.',
      }));
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it.each(['network', 'http', 'invalid-json', 'invalid-release', 'untrusted-url'])(
      'reports %s failures without claiming the app is up to date',
      async failure => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mockFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
          if (failure === 'network') throw new Error('Offline');
          if (failure === 'http') return new Response(null, { status: 503 });
          if (failure === 'invalid-json') return new Response('{');
          if (failure === 'invalid-release') return Response.json({ tag_name: null });
          return Response.json({ tag_name: 'v0.2.0', html_url: 'file:///tmp/update' });
        });
        await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true });
        expect(log).toHaveBeenCalled();
        expect(dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          message: 'Unable to check for updates',
        }));
        expect(shell.openExternal).not.toHaveBeenCalled();
      },
    );

    it('uses a timeout signal and GitHub API headers', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.1.0',
      }));
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      await fetchLatestRelease(mockFetch);
      expect(timeout).toHaveBeenCalledWith(15_000);
      expect(mockFetch).toHaveBeenCalledWith(LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'awapi-lasso-updater',
        },
        signal: expect.any(AbortSignal),
      });
    });

    it('accepts a release without a display name', async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
        name: null,
      }));
      expect(await fetchLatestRelease(mockFetch)).toMatchObject({ tag_name: 'v0.2.0' });
    });

    it('shows an unparented dialog if the window closes during the check', async () => {
      const parentWindow = new BrowserWindow();
      vi.spyOn(parentWindow, 'isDestroyed').mockReturnValue(true);
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.1.0',
      }));
      await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true, parentWindow });
      expect(dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        message: "You're up to date",
      }));
    });

    it.each(['draft', 'prerelease'])('does not offer %s releases', async flag => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
        [flag]: true,
      }));
      await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true });
      expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Unable to check for updates',
      }));
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('parents the update dialog and respects Later', async () => {
      const parentWindow = new BrowserWindow();
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
      }));
      vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true, parentWindow });
      expect(dialog.showMessageBox).toHaveBeenCalledWith(parentWindow, expect.objectContaining({
        message: 'A new version of AwapiLasso is available',
        buttons: ['Download', 'Later'],
        cancelId: 1,
      }));
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('reports browser launch failures with a manual download URL', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
      }));
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('No browser'));
      await checkForUpdates({ fetchImpl: mockFetch, notifyIfUpToDate: true });
      expect(dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'error',
        message: 'Unable to open the download page',
        detail: expect.stringContaining('https://github.com/awapi/awapi-lasso/releases'),
      }));
    });
  });
});
