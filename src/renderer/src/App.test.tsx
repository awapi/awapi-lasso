import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from './App';

vi.mock('./components/TerminalView', () => ({
  default: (props: { sessionId: number; isActive: boolean }) => (
    <div data-testid={`terminal-view-${props.sessionId}`} data-active={String(props.isActive)} />
  ),
}));

describe('App shell', () => {
  let osOpenCallback: ((filePath: string) => void) | null = null;

  beforeEach(() => {
    osOpenCallback = null;
    window.electronAPI = {
      openCollectionDialog: vi.fn().mockResolvedValue(['/Users/me/apis/payments.awjc']),
      openCollectionsWithDialog: vi.fn().mockResolvedValue(null),
      openCollectionFromPath: vi.fn(),
      importOpenApiWithDialog: vi.fn().mockResolvedValue(null),
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
      introspectGraphQLSchema: vi.fn().mockResolvedValue({ ok: false, error: 'Mocked offline' }),
      loadLocalGraphQLSchema: vi.fn().mockResolvedValue({ ok: false, error: 'Mocked offline' }),
      getCachedGraphQLSchema: vi.fn().mockResolvedValue(null),
      openGraphQLSchemaFileDialog: vi.fn().mockResolvedValue(null),
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
      getGitStatus: vi.fn().mockResolvedValue({
        collectionFilePath: '/Users/me/apis/payments.awjc',
        folderPath: '/Users/me/apis',
        isGitRepo: true,
        repoRootPath: '/Users/me/apis',
        relativeFilePath: 'payments.awjc',
        branch: 'main',
        ahead: 0,
        behind: 0,
        fileStatus: 'clean',
        folderChangedFiles: [],
        branches: ['main'],
        safety: {
          safe: true,
          secretsSidecarIgnored: true,
          hasPlaintextSecrets: false,
          plaintextSecretWarnings: [],
          issues: [],
        },
      }),
      initGitRepo: vi.fn().mockResolvedValue({ ok: true, message: 'Initialized' }),
      ensureGitignore: vi.fn().mockResolvedValue({ ok: true, message: 'Updated' }),
      getGitDiff: vi.fn().mockResolvedValue({
        collectionFilePath: '/Users/me/apis/payments.awjc',
        commitRef: 'HEAD',
        headContent: '',
        workingContent: '',
        rawUnifiedDiff: '',
        hasChanges: false,
      }),
      getGitLog: vi.fn().mockResolvedValue([]),
      checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Switched' }),
      commitGitChanges: vi.fn().mockResolvedValue({ ok: true, message: 'Committed' }),
      pullGit: vi.fn().mockResolvedValue({ ok: true, message: 'Pulled' }),
      pushGit: vi.fn().mockResolvedValue({ ok: true, message: 'Pushed' }),
      revertGitChanges: vi.fn().mockResolvedValue({ ok: true, message: 'Reverted' }),
      showItemInFolder: vi.fn().mockResolvedValue(undefined),
      openInTerminal: vi.fn().mockResolvedValue(true),
      getTerminalChoices: vi.fn().mockResolvedValue({
        platform: 'darwin',
        externalTerminals: [{ id: 'terminal', label: 'Terminal', detail: 'Terminal' }],
        shells: [{ id: '/bin/zsh', label: 'zsh', detail: '/bin/zsh' }],
        autoExternalTerminal: 'Terminal',
        autoShell: 'zsh',
      }),
      ptyCreate: vi.fn().mockResolvedValue({
        ok: true,
        id: 1,
        cwd: '/Users/me/apis',
        shell: 'zsh',
      }),
      ptyWrite: vi.fn(),
      ptyResize: vi.fn(),
      ptyKill: vi.fn().mockResolvedValue(undefined),
      onPtyData: vi.fn(() => () => {}),
      onPtyExit: vi.fn(() => () => {}),
      onMenuNewCollection: vi.fn(() => () => {}),
      onMenuOpenCollection: vi.fn(() => () => {}),
      onMenuSaveCollection: vi.fn(() => () => {}),
      onMenuSaveCollectionAs: vi.fn(() => () => {}),
      onMenuOpenSettings: vi.fn(() => () => {}),
      onMenuImportCurl: vi.fn(() => () => {}),
      onMenuImportOpenApi: vi.fn(() => () => {}),
      onMenuToggleTerminal: vi.fn(() => () => {}),
      onMenuNewTerminal: vi.fn(() => () => {}),
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

    window.electronAPI.setCliCommandEnabled = vi.fn().mockResolvedValue({
      ok: true,
      enabled: false,
      commandPath: '/usr/local/bin/awlasso',
    });

    fireEvent.click(screen.getByTestId('cli-status-badge'));
    expect(window.electronAPI.setCliCommandEnabled).toHaveBeenCalledWith(false);

    await waitFor(() => {
      expect(screen.getByTestId('cli-status-badge')).toHaveTextContent('awlasso CLI ready');
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

    // Can remove/close the collection via the collection context menu
    const colMenuBtn = screen
      .getAllByRole('button')
      .find(btn => btn.getAttribute('data-testid')?.startsWith('collection-menu-btn-'));
    expect(colMenuBtn).toBeDefined();
    fireEvent.click(colMenuBtn!);

    const closeColMenuItem = screen
      .getAllByRole('button')
      .find(btn => btn.getAttribute('data-testid')?.startsWith('col-menu-close-'));
    expect(closeColMenuItem).toBeDefined();
    fireEvent.click(closeColMenuItem!);

    await waitFor(() => {
      expect(screen.getByTestId('empty-collections-msg')).toBeInTheDocument();
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

  it('switches to GraphQLWorkspace when protocol is changed to GRAPHQL in the URL bar', async () => {
    render(<App />);
    const methodSelect = screen.getByTestId('method-select');
    fireEvent.change(methodSelect, { target: { value: 'GRAPHQL' } });

    await waitFor(() => {
      expect(screen.getByTestId('graphql-workspace')).toBeInTheDocument();
    });
  });

  it('keeps RequestUrlBar and section tabs fixed above the scrollable configuration panel', () => {
    render(<App />);
    const stickyHeader = screen.getByTestId('request-sticky-header');
    const scrollContainer = screen.getByTestId('request-config-scroll-container');
    const urlBar = screen.getByTestId('request-url-bar');
    const sendBtn = screen.getByTestId('send-request-btn');

    expect(stickyHeader).toContainElement(urlBar);
    expect(stickyHeader).toContainElement(sendBtn);
    expect(stickyHeader).toContainElement(screen.getByTestId('req-config-tab-params'));
    expect(scrollContainer).not.toContainElement(urlBar);
    expect(scrollContainer).toHaveStyle({ overflowY: 'auto' });
  });

  it('prompts to Save, Don’t Save, or Cancel when closing a dirty request tab', async () => {
    render(<App />);

    // Open a collection so we can verify saving to disk when Save is clicked
    fireEvent.click(screen.getByTestId('open-collection-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('collection-list')).toHaveTextContent(
        '/Users/me/apis/payments.awjc',
      );
    });

    // Edit the active tab URL to make the tab dirty
    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'https://api.example.com/v1/modified' } });
    expect(screen.getByTestId('tab-dirty-tab_initial')).toBeInTheDocument();

    // Attempt to close the dirty tab -> confirmation modal appears
    fireEvent.click(screen.getByTestId('tab-close-btn-tab_initial'));
    expect(screen.getByTestId('unsaved-tab-close-modal')).toBeInTheDocument();
    expect(screen.getByTestId('request-tab-tab_initial')).toBeInTheDocument();

    // Clicking Cancel keeps the tab open and dirty
    fireEvent.click(screen.getByTestId('unsaved-modal-cancel-btn'));
    expect(screen.queryByTestId('unsaved-tab-close-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('request-tab-tab_initial')).toBeInTheDocument();
    expect(screen.getByTestId('tab-dirty-tab_initial')).toBeInTheDocument();

    // Attempt to close again and click Save -> saves collection and closes tab
    fireEvent.click(screen.getByTestId('tab-close-btn-tab_initial'));
    fireEvent.click(screen.getByTestId('unsaved-modal-save-btn'));

    await waitFor(() => {
      expect(window.electronAPI.saveCollection).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('request-tab-tab_initial')).not.toBeInTheDocument();
    });
  });

  it('reverts unsaved changes when Don’t Save is chosen on closing a dirty tab', async () => {
    render(<App />);

    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'https://api.example.com/v1/unsaved' } });
    expect(screen.getByTestId('tab-dirty-tab_initial')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tab-close-btn-tab_initial'));
    expect(screen.getByTestId('unsaved-tab-close-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('unsaved-modal-discard-btn'));
    expect(screen.queryByTestId('request-tab-tab_initial')).not.toBeInTheDocument();
    expect(window.electronAPI.saveCollection).not.toHaveBeenCalled();

    // Reopening the closed tab restores the original saved URL
    fireEvent.click(screen.getByTestId('reopen-closed-tab-btn'));
    expect(screen.getByTestId('url-input')).toHaveValue('http://127.0.0.1:8080/v1/health');
  });

  it('opens CodeSnippetModal from tab context menu, sidebar request context menu, and URL bar, plus CollectionRunnerModal and Import cURL modal', () => {
    render(<App />);

    // 1. Open Code Snippet Generator modal from the tab's right-click context menu
    fireEvent.contextMenu(screen.getByTestId('request-tab-tab_initial'));
    fireEvent.click(screen.getByTestId('tab-ctx-generate-code-tab_initial'));
    expect(screen.getByTestId('code-snippet-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-code-snippet-modal-btn'));
    expect(screen.queryByTestId('code-snippet-modal')).not.toBeInTheDocument();

    // 2. Open Code Snippet Generator modal from a request item in the left sidebar tree
    fireEvent.click(screen.getByTestId('sidebar-new-collection-btn'));
    const sampleTreeItemMenu = screen
      .getAllByRole('button')
      .find(btn => btn.getAttribute('data-testid')?.startsWith('item-menu-btn-'));
    expect(sampleTreeItemMenu).toBeDefined();
    fireEvent.click(sampleTreeItemMenu!);
    const generateCodeMenuItem = screen
      .getAllByRole('button')
      .find(btn => btn.getAttribute('data-testid')?.startsWith('menu-generate-code-'));
    expect(generateCodeMenuItem).toBeDefined();
    fireEvent.click(generateCodeMenuItem!);
    expect(screen.getByTestId('code-snippet-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-code-snippet-modal-btn'));
    expect(screen.queryByTestId('code-snippet-modal')).not.toBeInTheDocument();

    // 3. Open Code Snippet Generator modal from URL bar button
    fireEvent.click(screen.getByTestId('open-code-snippet-btn'));
    expect(screen.getByTestId('code-snippet-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-code-snippet-modal-btn'));
    expect(screen.queryByTestId('code-snippet-modal')).not.toBeInTheDocument();

    // Open Collection Runner modal from top toolbar
    fireEvent.click(screen.getByTestId('open-runner-btn'));
    expect(screen.getByTestId('collection-runner-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-runner-modal-btn'));
    expect(screen.queryByTestId('collection-runner-modal')).not.toBeInTheDocument();

    // Import cURL command via toolbar Import dropdown menu into a new request tab
    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    fireEvent.click(screen.getByTestId('open-import-curl-btn'));
    expect(screen.getByTestId('import-curl-modal')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('import-curl-textarea'), {
      target: {
        value: 'curl -X POST https://api.example.com/v1/payments -d \'{"amount":500}\'',
      },
    });
    fireEvent.click(screen.getByTestId('confirm-import-curl-btn'));

    expect(screen.queryByTestId('import-curl-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('url-input')).toHaveValue('https://api.example.com/v1/payments');
    expect(screen.getByTestId('method-select')).toHaveValue('POST');
  });

  it('restores loaded collections, open tabs, unsaved drafts, and active environment from saved session on launch and persists changes', async () => {
    window.electronAPI.openCollectionFromPath = vi.fn().mockResolvedValue({
      filePath: '/Users/me/apis/orders.awjc',
      format: 'yaml',
      collection: {
        awjcVersion: '1.0',
        metadata: { id: 'col_orders', name: 'Orders API' },
        activeEnvironment: 'dev',
        environments: [
          { name: 'dev', variables: [] },
          { name: 'prod', variables: [] },
        ],
        items: [
          {
            kind: 'request',
            id: 'req_list_orders',
            name: 'List Orders',
            protocol: 'http',
            method: 'GET',
            url: 'https://api.example.com/v1/orders',
            headers: [],
            queryParams: [],
            pathParams: [],
          },
        ],
      },
    });

    window.electronAPI.loadSession = vi.fn().mockResolvedValue({
      activeTabId: 'tab_draft_1',
      activeCollectionPath: '/Users/me/apis/orders.awjc',
      activeEnvironmentByCollection: { '/Users/me/apis/orders.awjc': 'prod' },
      openCollectionPaths: ['/Users/me/apis/orders.awjc'],
      activeConfigTab: 'headers',
      splitLayout: 'horizontal',
      tabs: [
        {
          id: 'tab_saved_1',
          title: 'List Orders',
          collectionPath: '/Users/me/apis/orders.awjc',
          requestId: 'req_list_orders',
          isDirty: false,
        },
        {
          id: 'tab_draft_1',
          title: 'Create Order Draft',
          collectionPath: '/Users/me/apis/orders.awjc',
          requestId: 'req_list_orders',
          isDirty: true,
          draftJson: JSON.stringify({
            kind: 'request',
            id: 'req_list_orders',
            name: 'Create Order Draft',
            protocol: 'http',
            method: 'POST',
            url: 'https://api.example.com/v1/orders/draft',
          }),
        },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.loadSession).toHaveBeenCalled();
      expect(screen.getByTestId('collection-list')).toHaveTextContent('/Users/me/apis/orders.awjc');
      expect(screen.getByTestId('request-tab-tab_saved_1')).toBeInTheDocument();
      expect(screen.getByTestId('request-tab-tab_draft_1')).toBeInTheDocument();
      expect(screen.getByTestId('tab-dirty-tab_draft_1')).toBeInTheDocument();
      expect(screen.getByTestId('url-input')).toHaveValue('https://api.example.com/v1/orders/draft');
      expect(screen.getByTestId('method-select')).toHaveValue('POST');
    });

    // Updating the active request should persist the updated session via saveSession
    fireEvent.change(screen.getByTestId('url-input'), {
      target: { value: 'https://api.example.com/v1/orders/updated' },
    });

    await waitFor(() => {
      expect(window.electronAPI.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          activeTabId: 'tab_draft_1',
          activeCollectionPath: '/Users/me/apis/orders.awjc',
          openCollectionPaths: ['/Users/me/apis/orders.awjc'],
          activeEnvironmentByCollection: { '/Users/me/apis/orders.awjc': 'prod' },
        }),
      );
    });
  });

  it('prompts for confirmation (Save & Close, Don’t Save, Cancel) when closing an unsaved collection or a collection with dirty requests', async () => {
    render(<App />);

    // Create a new collection (starts as isDirty: true)
    fireEvent.click(screen.getByTestId('sidebar-new-collection-btn'));
    expect(screen.getByTestId('collection-list')).toHaveTextContent('New Collection 1');

    const openColMenu = () => {
      const colMenuBtn = screen
        .getAllByRole('button')
        .find(btn => btn.getAttribute('data-testid')?.startsWith('collection-menu-btn-'));
      expect(colMenuBtn).toBeDefined();
      fireEvent.click(colMenuBtn!);
      const closeBtn = screen
        .getAllByRole('button')
        .find(btn => btn.getAttribute('data-testid')?.startsWith('col-menu-close-'));
      expect(closeBtn).toBeDefined();
      fireEvent.click(closeBtn!);
    };

    // Attempt to close dirty collection -> confirmation modal appears
    openColMenu();
    expect(screen.getByTestId('unsaved-collection-close-modal')).toBeInTheDocument();

    // Cancel keeps the collection open
    fireEvent.click(screen.getByTestId('unsaved-collection-modal-cancel-btn'));
    expect(screen.queryByTestId('unsaved-collection-close-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-list')).toHaveTextContent('New Collection 1');

    // Reopen confirmation and click Save & Close -> saves collection and removes it
    openColMenu();
    fireEvent.click(screen.getByTestId('unsaved-collection-modal-save-btn'));

    await waitFor(() => {
      expect(window.electronAPI.saveCollection).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('empty-collections-msg')).toBeInTheDocument();
    });
  });

  it('prevents orphan request saves by opening SaveRequestModal on Save button or Cmd/Ctrl+S, allowing collection and subfolder creation', async () => {
    render(<App />);

    // Edit URL on the initial unattached request tab
    const urlInput = screen.getByTestId('url-input');
    fireEvent.change(urlInput, { target: { value: 'https://awapi.com' } });
    expect(screen.getByTestId('save-request-btn')).toHaveAttribute('data-unsaved', 'true');

    // Pressing Ctrl+S (or clicking Save button) when no collection is open opens SaveRequestModal
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(screen.getByTestId('save-request-modal')).toBeInTheDocument();
    expect(screen.getByTestId('save-modal-empty-collections')).toBeInTheDocument();

    // Create a new collection inside the modal
    fireEvent.click(screen.getByTestId('save-modal-empty-new-collection-cta'));
    fireEvent.change(screen.getByTestId('save-modal-new-collection-input'), {
      target: { value: 'Awapi Platform' },
    });
    fireEvent.click(screen.getByTestId('save-modal-confirm-new-collection-btn'));

    // Create a root folder "Core" and a subfolder "Public" inside the modal
    fireEvent.click(screen.getByTestId('save-modal-new-folder-btn'));
    fireEvent.change(screen.getByTestId('save-modal-new-folder-input'), {
      target: { value: 'Core' },
    });
    fireEvent.click(screen.getByTestId('save-modal-confirm-new-folder-btn'));

    // Since "Core" is now selected, clicking "+ New Subfolder" creates a subfolder under "Core"
    fireEvent.click(screen.getByTestId('save-modal-new-folder-btn'));
    fireEvent.change(screen.getByTestId('save-modal-new-folder-input'), {
      target: { value: 'Public' },
    });
    fireEvent.click(screen.getByTestId('save-modal-confirm-new-folder-btn'));

    expect(screen.getByTestId('save-modal-destination-summary')).toHaveTextContent(
      'Awapi Platform / Core / Public',
    );

    // Name the request and confirm save
    fireEvent.change(screen.getByTestId('save-request-name-input'), {
      target: { value: 'Awapi Home' },
    });
    fireEvent.click(screen.getByTestId('save-request-modal-confirm-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('save-request-modal')).not.toBeInTheDocument();
      expect(window.electronAPI.saveCollection).toHaveBeenCalledTimes(1);
    });

    // Request is now attached to the collection (no longer orphan or dirty)
    expect(screen.getByTestId('save-request-btn')).toHaveAttribute('data-unsaved', 'false');
    expect(screen.getByTestId('collection-list')).toHaveTextContent('Awapi Platform');
    expect(screen.getByTestId('collection-list')).toHaveTextContent('Awapi Home');
  });

  it('opens integrated and external terminal from collection context menu, and status bar icon opens in home folder when no collection is selected or collection folder when selected', async () => {
    render(<App />);

    // 1. With no collection selected, clicking the status bar terminal icon opens in the home folder (cwd: null)
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-collection')).toHaveTextContent('No collection selected');
    fireEvent.click(screen.getByTestId('status-bar-terminal-toggle'));

    await waitFor(() => {
      expect(window.electronAPI.ptyCreate).toHaveBeenCalledWith({
        cwd: null,
        cols: 80,
        rows: 24,
      });
    });

    // Close the terminal session so the next status bar toggle starts a fresh session
    fireEvent.click(screen.getByTestId('terminal-close-1'));

    // 2. Open a collection -> status bar reflects selected collection and opens in that collection's folder
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    fireEvent.click(screen.getByTestId('open-collection-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('collection-list')).toHaveTextContent(
        '/Users/me/apis/payments.awjc',
      );
    });

    fireEvent.click(screen.getByTestId('status-bar-terminal-toggle'));
    await waitFor(() => {
      expect(window.electronAPI.ptyCreate).toHaveBeenLastCalledWith({
        cwd: '/Users/me/apis/payments.awjc',
        cols: 80,
        rows: 24,
      });
    });

    const colMenuBtn = screen
      .getAllByRole('button')
      .find(btn => btn.getAttribute('data-testid')?.startsWith('collection-menu-btn-'));
    expect(colMenuBtn).toBeDefined();
    fireEvent.click(colMenuBtn!);

    const openIntegratedBtn = screen
      .getAllByRole('button')
      .find(btn =>
        btn.getAttribute('data-testid')?.startsWith('col-menu-open-integrated-terminal-'),
      );
    expect(openIntegratedBtn).toBeDefined();
    fireEvent.click(openIntegratedBtn!);

    await waitFor(() => {
      expect(window.electronAPI.ptyCreate).toHaveBeenCalledWith({
        cwd: '/Users/me/apis/payments.awjc',
        cols: 80,
        rows: 24,
      });
    });

    // Open collection menu again and test Open in External Terminal
    fireEvent.click(colMenuBtn!);
    const openExternalBtn = screen
      .getAllByRole('button')
      .find(btn =>
        btn.getAttribute('data-testid')?.startsWith('col-menu-open-external-terminal-'),
      );
    expect(openExternalBtn).toBeDefined();
    fireEvent.click(openExternalBtn!);
    expect(window.electronAPI.openInTerminal).toHaveBeenCalledWith(
      '/Users/me/apis/payments.awjc',
    );
  });
});
