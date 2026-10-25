import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0' },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  BrowserWindow: class {},
}));

import {
  LATEST_RELEASE_URL,
  isNewerVersion,
  fetchLatestRelease,
  checkForUpdates,
} from './updater';
import { dialog, shell } from 'electron';

describe('updater', () => {
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
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
          draft: false,
          prerelease: false,
        }),
      }) as unknown as typeof fetch;

      const release = await fetchLatestRelease(mockFetch);
      expect(release?.tag_name).toBe('v0.2.0');

      await checkForUpdates({ fetchImpl: mockFetch });
      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/awapi/awapi-lasso/releases/tag/v0.2.0',
      );
    });
  });
});
