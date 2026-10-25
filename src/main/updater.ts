import { app, dialog, shell, BrowserWindow } from 'electron';

/**
 * Lightweight update notifier for AwapiLasso.
 *
 * Pings the GitHub Releases API (`https://api.github.com/repos/awapi/awapi-lasso/releases/latest`),
 * compares tags with the running version, and—if a newer version is available—shows a native
 * dialog that opens the release page in the user's browser.
 */

export const GITHUB_OWNER = 'awapi';
export const GITHUB_REPO = 'awapi-lasso';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface GithubRelease {
  tag_name: string;
  html_url: string;
  name?: string;
  prerelease?: boolean;
  draft?: boolean;
}

/**
 * Compare two semver-ish version strings (e.g. "0.2.3" or "v0.2.3").
 * Returns true when `latest` is strictly newer than `current`.
 * Non-numeric / malformed input is treated as 0 so we never throw.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map(p => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<GithubRelease | null> {
  try {
    const res = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${GITHUB_REPO}-updater`,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as GithubRelease;
  } catch (err) {
    console.error('Update check failed:', err);
    return null;
  }
}

export interface CheckForUpdatesOptions {
  /** Show a dialog even when already on the latest version (manual checks). */
  notifyIfUpToDate?: boolean;
  parentWindow?: BrowserWindow | null;
  fetchImpl?: typeof fetch;
}

export async function checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<void> {
  const { notifyIfUpToDate = false, parentWindow = null, fetchImpl = fetch } = options;

  const release = await fetchLatestRelease(fetchImpl);
  const currentVersion = app.getVersion();

  if (!release || release.draft || release.prerelease) {
    if (notifyIfUpToDate) {
      await dialog.showMessageBox(parentWindow ?? undefined!, {
        type: 'info',
        message: 'Unable to check for updates',
        detail: 'Could not reach GitHub right now. Please try again later.',
        buttons: ['OK'],
      });
    }
    return;
  }

  if (!isNewerVersion(release.tag_name, currentVersion)) {
    if (notifyIfUpToDate) {
      await dialog.showMessageBox(parentWindow ?? undefined!, {
        type: 'info',
        message: `You're up to date`,
        detail: `AwapiLasso ${currentVersion} is the latest version.`,
        buttons: ['OK'],
      });
    }
    return;
  }

  const result = await dialog.showMessageBox(parentWindow ?? undefined!, {
    type: 'info',
    message: 'A new version of AwapiLasso is available',
    detail: `You're on ${currentVersion}. Latest is ${release.tag_name.replace(/^v/i, '')}.\n\nOpen the download page now?`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    await shell.openExternal(release.html_url);
  }
}
