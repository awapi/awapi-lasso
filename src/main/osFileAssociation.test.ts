import { describe, it, expect, vi } from 'vitest';
import {
  COLLECTION_OPENED_FROM_OS_CHANNEL,
  isCollectionFilePath,
  resolveCollectionPathFromCwd,
  extractCollectionPathsFromArgv,
  ensureWindow,
  sendWhenLoaded,
  createOsFileQueue,
  type DeliverableWindow,
} from './osFileAssociation';

function createMockWindow({ loading = false, destroyed = false } = {}) {
  const listeners: Array<() => void> = [];
  const state = { loading, destroyed };
  const win = {
    isDestroyed: vi.fn(() => state.destroyed),
    webContents: {
      isLoading: vi.fn(() => state.loading),
      once: vi.fn((_event: 'did-finish-load', listener: () => void) => {
        listeners.push(listener);
      }),
      send: vi.fn(),
    },
  } satisfies DeliverableWindow;
  return {
    win,
    state,
    finishLoad: () => {
      state.loading = false;
      for (const fn of listeners.splice(0, listeners.length)) {
        fn();
      }
    },
  };
}

describe('osFileAssociation', () => {
  describe('isCollectionFilePath', () => {
    it('accepts .awjc and .awj extensions case-insensitively', () => {
      expect(isCollectionFilePath('/path/to/service.awjc')).toBe(true);
      expect(isCollectionFilePath('/path/to/service.awj')).toBe(true);
      expect(isCollectionFilePath('C:\\Projects\\MyApi.AWJC')).toBe(true);
      expect(isCollectionFilePath('C:\\Projects\\MyApi.AWJ')).toBe(true);
    });

    it('rejects non-collection extensions and empty paths', () => {
      expect(isCollectionFilePath('/path/to/readme.md')).toBe(false);
      expect(isCollectionFilePath('/path/to/data.json')).toBe(false);
      expect(isCollectionFilePath('')).toBe(false);
    });
  });

  describe('resolveCollectionPathFromCwd', () => {
    it('resolves relative Windows and POSIX paths against cwd', () => {
      expect(
        resolveCollectionPathFromCwd('win32', 'C:\\Users\\me\\apis', 'payments.awjc'),
      ).toBe('C:\\Users\\me\\apis\\payments.awjc');
      expect(
        resolveCollectionPathFromCwd('darwin', '/Users/me/apis/sub', '../users.awj'),
      ).toBe('/Users/me/apis/users.awj');
    });
  });

  describe('extractCollectionPathsFromArgv', () => {
    it('extracts .awjc and .awj files from process.argv and ignores non-collection files or flags', () => {
      const existing = new Set([
        'C:\\Users\\me\\apis\\orders.awjc',
        'C:\\Users\\me\\apis\\legacy.awj',
        'C:\\Users\\me\\apis\\notes.txt',
      ]);
      const argv = [
        'C:\\Program Files\\AwapiLasso\\AwapiLasso.exe',
        '--allow-file-access-from-files',
        'orders.awjc',
        'legacy.awj',
        'notes.txt',
        'missing.awjc',
      ];

      const result = extractCollectionPathsFromArgv(argv, false, 'C:\\Users\\me\\apis', {
        platform: 'win32',
        isFile: p => existing.has(p),
      });

      expect(result).toEqual([
        'C:\\Users\\me\\apis\\orders.awjc',
        'C:\\Users\\me\\apis\\legacy.awj',
      ]);
    });

    it('skips electron and entry script in dev mode and deduplicates paths', () => {
      const existing = new Set(['/Users/me/work/graphql.awjc']);
      const argv = [
        '/repo/node_modules/electron/dist/electron',
        '/repo/dist/main/main.js',
        'graphql.awjc',
        './graphql.awjc',
      ];

      const result = extractCollectionPathsFromArgv(argv, true, '/Users/me/work', {
        platform: 'darwin',
        isFile: p => existing.has(p),
      });

      expect(result).toEqual(['/Users/me/work/graphql.awjc']);
    });

    it('supports "--" argument separator', () => {
      const existing = new Set(['/home/me/-dash-api.awjc']);
      const argv = ['/usr/bin/awapi-lasso', '--', '-dash-api.awjc'];

      const result = extractCollectionPathsFromArgv(argv, false, '/home/me', {
        platform: 'linux',
        isFile: p => existing.has(p),
      });

      expect(result).toEqual(['/home/me/-dash-api.awjc']);
    });
  });

  describe('ensureWindow & sendWhenLoaded', () => {
    it('reuses an open window or creates a new one if destroyed', () => {
      const { win } = createMockWindow();
      const create = vi.fn(() => createMockWindow().win);
      expect(ensureWindow(win, create)).toBe(win);
      expect(create).not.toHaveBeenCalled();

      const destroyedWin = createMockWindow({ destroyed: true }).win;
      const replacement = ensureWindow(destroyedWin, create);
      expect(create).toHaveBeenCalledTimes(1);
      expect(replacement).not.toBe(destroyedWin);
    });

    it('waits for did-finish-load when window is still loading', () => {
      const { win, finishLoad } = createMockWindow({ loading: true });
      sendWhenLoaded(win, COLLECTION_OPENED_FROM_OS_CHANNEL, '/tmp/api.awjc');
      expect(win.webContents.send).not.toHaveBeenCalled();

      finishLoad();
      expect(win.webContents.send).toHaveBeenCalledWith(
        COLLECTION_OPENED_FROM_OS_CHANNEL,
        '/tmp/api.awjc',
      );
    });
  });

  describe('createOsFileQueue', () => {
    it('queues cold-start .awjc/.awj files until app is ready and flushes them over collection:openedFromOs', () => {
      let appReady = false;
      const { win, finishLoad } = createMockWindow({ loading: true });
      let currentWin: DeliverableWindow | null = null;
      const delivered: string[] = [];

      const queue = createOsFileQueue({
        isAppReady: () => appReady,
        getMainWindow: () => currentWin,
        createMainWindow: () => {
          currentWin = win;
          return win;
        },
        onFileDelivered: fp => delivered.push(fp),
      });

      // Cold start before app.whenReady()
      queue.enqueue(['/Users/me/cold-start.awjc', '/Users/me/ignored.txt']);
      queue.enqueue('/Users/me/second.awj');
      // Duplicate should be ignored
      queue.enqueue('/Users/me/cold-start.awjc');

      expect(queue.getPending()).toEqual(['/Users/me/cold-start.awjc', '/Users/me/second.awj']);
      expect(win.webContents.send).not.toHaveBeenCalled();

      // App becomes ready and flushes queue
      appReady = true;
      const flushed = queue.flush();
      expect(flushed).toEqual(['/Users/me/cold-start.awjc', '/Users/me/second.awj']);
      expect(queue.getPending()).toEqual([]);
      expect(delivered).toEqual(['/Users/me/cold-start.awjc', '/Users/me/second.awj']);

      // Window finishes loading -> IPC messages sent
      finishLoad();
      expect(win.webContents.send).toHaveBeenCalledTimes(2);
      expect(win.webContents.send).toHaveBeenNthCalledWith(
        1,
        COLLECTION_OPENED_FROM_OS_CHANNEL,
        '/Users/me/cold-start.awjc',
      );
      expect(win.webContents.send).toHaveBeenNthCalledWith(
        2,
        COLLECTION_OPENED_FROM_OS_CHANNEL,
        '/Users/me/second.awj',
      );

      // Warm open after app is ready delivers immediately
      queue.enqueue('/Users/me/warm.awjc');
      expect(win.webContents.send).toHaveBeenNthCalledWith(
        3,
        COLLECTION_OPENED_FROM_OS_CHANNEL,
        '/Users/me/warm.awjc',
      );
    });
  });
});
