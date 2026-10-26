import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
const dirs = new Set<string>(['/mock-userdata', '/mock-docs']);

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/mock-userdata';
      if (name === 'documents') return '/mock-docs';
      return '/mock-userdata';
    },
  },
}));

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
  dirname: (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx <= 0 ? '.' : p.slice(0, idx);
  },
}));

vi.mock('fs', () => ({
  existsSync: (p: string) => files.has(p) || dirs.has(p),
  readFileSync: (p: string) => {
    const content = files.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  },
  writeFileSync: (p: string, data: string) => {
    files.set(p, data);
  },
  mkdirSync: (p: string) => {
    dirs.add(p);
  },
  readdirSync: (dir: string) => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const entries: string[] = [];
    for (const k of files.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        if (!rest.includes('/')) entries.push(rest);
      }
    }
    return entries;
  },
  unlinkSync: (p: string) => {
    files.delete(p);
  },
}));

import {
  MAX_RECENT_FILES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  loadAppSettings,
  saveAppSettings,
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  getLastOpenDirectory,
  setLastOpenDirectoryFromFile,
  saveSession,
  loadSession,
} from './session';

describe('session settings, recent collections, and session state', () => {
  beforeEach(() => {
    files.clear();
    dirs.clear();
    dirs.add('/mock-userdata');
    dirs.add('/mock-docs');
  });

  it('returns sensible defaults for theme, SSL verification, and timeout', () => {
    const settings = loadAppSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.verifySsl).toBe(true);
    expect(settings.defaultTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(settings.followRedirects).toBe(true);
    expect(settings.recentFiles).toEqual([]);
  });

  it('persists and restores theme, SSL defaults, timeout, and terminal preferences', () => {
    saveAppSettings({
      theme: 'light',
      verifySsl: false,
      defaultTimeoutMs: 15000,
      followRedirects: false,
      maxRedirects: 5,
      externalTerminal: 'iterm',
      integratedShell: '/bin/zsh',
      terminalFont: 'MesloLGS NF',
    });

    const loaded = loadAppSettings();
    expect(loaded.theme).toBe('light');
    expect(loaded.verifySsl).toBe(false);
    expect(loaded.defaultTimeoutMs).toBe(15000);
    expect(loaded.followRedirects).toBe(false);
    expect(loaded.maxRedirects).toBe(5);
    expect(loaded.externalTerminal).toBe('iterm');
    expect(loaded.integratedShell).toBe('/bin/zsh');
    expect(loaded.terminalFont).toBe('MesloLGS NF');
  });

  it('adds recent collection files in most-recent-first order and deduplicates existing entries', () => {
    addRecentFile('/tmp/users.awjc');
    addRecentFile('/tmp/orders.awj');
    addRecentFile('/tmp/graphql.awjc');
    expect(getRecentFiles()).toEqual([
      '/tmp/graphql.awjc',
      '/tmp/orders.awj',
      '/tmp/users.awjc',
    ]);

    addRecentFile('/tmp/users.awjc');
    expect(getRecentFiles()).toEqual([
      '/tmp/users.awjc',
      '/tmp/graphql.awjc',
      '/tmp/orders.awj',
    ]);
  });

  it('caps recent files at MAX_RECENT_FILES', () => {
    for (let i = 1; i <= MAX_RECENT_FILES + 5; i++) {
      addRecentFile(`/tmp/col-${i}.awjc`);
    }
    const recent = getRecentFiles();
    expect(recent.length).toBe(MAX_RECENT_FILES);
    expect(recent[0]).toBe(`/tmp/col-${MAX_RECENT_FILES + 5}.awjc`);
  });

  it('removes a single file or clears all recent files', () => {
    addRecentFile('/tmp/a.awjc');
    addRecentFile('/tmp/b.awjc');
    removeRecentFile('/tmp/a.awjc');
    expect(getRecentFiles()).toEqual(['/tmp/b.awjc']);

    clearRecentFiles();
    expect(getRecentFiles()).toEqual([]);
  });

  it('remembers and returns the last open directory from imported or opened files', () => {
    dirs.add('/Users/me/projects/apis');
    dirs.add('/Users/me/projects/openapi');

    expect(getLastOpenDirectory()).toBeUndefined();

    addRecentFile('/Users/me/projects/apis/orders.awjc');
    expect(loadAppSettings().lastOpenDirectory).toBe('/Users/me/projects/apis');
    expect(getLastOpenDirectory()).toBe('/Users/me/projects/apis');

    setLastOpenDirectoryFromFile('/Users/me/projects/openapi/spec.yaml');
    expect(getLastOpenDirectory()).toBe('/Users/me/projects/openapi');
  });

  it('saves and loads workspace session state including open collections, layout, and unsaved drafts', () => {
    const ok = saveSession({
      activeTabId: 'tab-1',
      activeCollectionPath: '/workspace/api.awjc',
      activeEnvironmentByCollection: { '/workspace/api.awjc': 'staging' },
      openCollectionPaths: ['/workspace/api.awjc', '/workspace/orders.awjc'],
      activeConfigTab: 'headers',
      splitLayout: 'horizontal',
      tabs: [
        {
          id: 'tab-1',
          title: 'Get Users',
          collectionPath: '/workspace/api.awjc',
          requestId: 'req-1',
          isDirty: true,
          draftJson: JSON.stringify({ method: 'GET', url: '{{baseUrl}}/users' }),
        },
        {
          id: 'tab-2',
          title: 'Saved Request',
          collectionPath: '/workspace/api.awjc',
          requestId: 'req-2',
          isDirty: false,
        },
      ],
    });
    expect(ok).toBe(true);

    const restored = loadSession();
    expect(restored).not.toBeNull();
    expect(restored?.activeTabId).toBe('tab-1');
    expect(restored?.activeCollectionPath).toBe('/workspace/api.awjc');
    expect(restored?.activeEnvironmentByCollection).toEqual({
      '/workspace/api.awjc': 'staging',
    });
    expect(restored?.openCollectionPaths).toEqual([
      '/workspace/api.awjc',
      '/workspace/orders.awjc',
    ]);
    expect(restored?.activeConfigTab).toBe('headers');
    expect(restored?.splitLayout).toBe('horizontal');
    expect(loadAppSettings().openCollectionPaths).toEqual([
      '/workspace/api.awjc',
      '/workspace/orders.awjc',
    ]);
    expect(restored?.tabs).toHaveLength(2);
    expect(restored?.tabs[0].draftJson).toBe(
      JSON.stringify({ method: 'GET', url: '{{baseUrl}}/users' }),
    );
    expect(restored?.tabs[1].draftJson).toBeUndefined();
  });
});
