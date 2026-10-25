import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from './App';

describe('App shell', () => {
  let osOpenCallback: ((filePath: string) => void) | null = null;

  beforeEach(() => {
    osOpenCallback = null;
    window.electronAPI = {
      openCollectionDialog: vi.fn().mockResolvedValue(['/Users/me/apis/payments.awjc']),
      openCollectionsWithDialog: vi.fn().mockResolvedValue(null),
      openCollectionFromPath: vi.fn(),
      saveCollection: vi.fn(),
      saveCollectionAs: vi.fn().mockResolvedValue(null),
      watchCollectionPaths: vi.fn().mockResolvedValue(undefined),
      onCollectionExternalChange: vi.fn(() => () => {}),
      getSecret: vi.fn().mockResolvedValue(null),
      setSecret: vi.fn().mockResolvedValue(true),
      deleteSecret: vi.fn().mockResolvedValue(true),
      getAllCollectionSecrets: vi.fn().mockResolvedValue({ byScope: {}, flatByKey: {} }),
      sendHttpRequest: vi.fn(),
      cancelHttpRequest: vi.fn().mockResolvedValue(false),
      getOAuth2Token: vi.fn(),
      refreshOAuth2Token: vi.fn(),
      getCachedOAuth2Token: vi.fn().mockResolvedValue(null),
      clearOAuth2Token: vi.fn().mockResolvedValue(false),
      onCollectionOpenedFromOs: vi.fn((cb: (filePath: string) => void) => {
        osOpenCallback = cb;
        return () => {
          osOpenCallback = null;
        };
      }),
      getPathForFile: vi.fn((file: File) => file.name),
      loadSettings: vi.fn().mockResolvedValue({
        sessionDir: null,
        theme: 'dark',
        verifySsl: true,
        defaultTimeoutMs: 30000,
        recentFiles: [],
        openCollectionPaths: [],
      }),
      saveSettings: vi.fn().mockImplementation(async partial => ({
        sessionDir: null,
        theme: partial.theme ?? 'dark',
      })),
      getRecentFiles: vi.fn().mockResolvedValue([]),
      addRecentFile: vi.fn().mockResolvedValue([]),
      removeRecentFile: vi.fn().mockResolvedValue([]),
      clearRecentFiles: vi.fn().mockResolvedValue(undefined),
      saveSession: vi.fn().mockResolvedValue(true),
      loadSession: vi.fn().mockResolvedValue(null),
      getContextMenuStatus: vi.fn().mockResolvedValue({ supported: false, enabled: false }),
      setContextMenuEnabled: vi.fn().mockResolvedValue({ ok: true, enabled: false }),
      getCliCommandStatus: vi.fn().mockResolvedValue({
        supported: true,
        enabled: true,
        commandPath: '/usr/local/bin/awlasso',
      }),
      setCliCommandEnabled: vi.fn().mockResolvedValue({
        ok: true,
        enabled: true,
        commandPath: '/usr/local/bin/awlasso',
      }),
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
      readClipboardText: vi.fn().mockResolvedValue(''),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      onMenuNewCollection: vi.fn(() => () => {}),
      onMenuOpenCollection: vi.fn(() => () => {}),
      onMenuSaveCollection: vi.fn(() => () => {}),
      onMenuSaveCollectionAs: vi.fn(() => () => {}),
      onMenuOpenSettings: vi.fn(() => () => {}),
    };
  });

  it('renders AwapiLasso header, request bar, and empty collections sidebar', async () => {
    render(<App />);
    expect(screen.getByTestId('awapilasso-app')).toBeInTheDocument();
    expect(screen.getByTestId('top-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('empty-collections-msg')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('cli-status-badge')).toHaveTextContent('awlasso CLI active');
    });
  });

  it('adds a collection when opened via the native dialog button', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('open-collection-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('collection-list')).toHaveTextContent(
        '/Users/me/apis/payments.awjc',
      );
    });
  });

  it('receives .awjc files opened from OS file association over IPC', async () => {
    render(<App />);
    expect(osOpenCallback).not.toBeNull();

    act(() => {
      osOpenCallback?.('/Users/me/double-clicked.awjc');
    });

    await waitFor(() => {
      expect(screen.getByTestId('collection-list')).toHaveTextContent(
        '/Users/me/double-clicked.awjc',
      );
    });
  });

  it('toggles theme and saves settings via window.electronAPI', async () => {
    render(<App />);
    await waitFor(() => {
      expect(window.electronAPI.loadSettings).toHaveBeenCalled();
    });

    const toggleBtn = screen.getByTestId('theme-toggle-btn');
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(window.electronAPI.saveSettings).toHaveBeenCalledWith({ theme: 'light' });
    });
  });

  it('sends an HTTP request from the URL bar and renders the response in ResponseInspector', async () => {
    window.electronAPI.sendHttpRequest = vi.fn().mockResolvedValue({
      requestId: 'req_test',
      ok: true,
      finalUrl: 'https://api.example.com/v1/health',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      httpVersion: '1.1',
      headers: { 'content-type': 'application/json' },
      rawHeaders: [{ key: 'Content-Type', value: 'application/json' }],
      cookies: [],
      body: '{"status":"healthy"}',
      isBinary: false,
      contentType: 'application/json',
      sizeBytes: 20,
      transferSizeBytes: 20,
      timings: { dnsMs: 1, tcpMs: 2, tlsMs: 3, ttfbMs: 10, downloadMs: 2, totalMs: 18 },
      tls: null,
      redirects: [],
      captures: [],
      assertions: [],
      sentHeaders: {},
    });

    render(<App />);
    fireEvent.click(screen.getByTestId('send-request-btn'));

    await waitFor(() => {
      expect(window.electronAPI.sendHttpRequest).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('response-status-badge')).toHaveTextContent('200 OK');
      expect(screen.getByTestId('response-body-content')).toHaveTextContent('"status": "healthy"');
    });
  });

  it('closes the last standing tab (or Close All) to an empty workspace and allows creating or reopening a tab', async () => {
    render(<App />);
    expect(screen.getByTestId('request-tab-tab_initial')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tab-close-btn-tab_initial'));
    expect(screen.queryByTestId('request-tab-tab_initial')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-tabs-workspace')).toBeInTheDocument();

    // Reopen closed tab restores it
    fireEvent.click(screen.getByTestId('reopen-closed-tab-btn'));
    expect(screen.getByTestId('request-tab-tab_initial')).toBeInTheDocument();
  });
});
