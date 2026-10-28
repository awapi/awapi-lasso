import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopToolbar } from './TopToolbar';
import { ThemeProvider } from '../context/ThemeContext';
import type { EnvironmentConfig } from '../../../shared/collectionSchema';

const sampleEnvironments: EnvironmentConfig[] = [
  { id: 'env_1', name: 'local', color: '#22c55e', variables: [] },
  { id: 'env_2', name: 'staging', color: '#f59e0b', variables: [] },
  { id: 'env_3', name: 'prod', color: '#ef4444', variables: [] },
];

describe('TopToolbar', () => {
  it('keeps About, update checks, and Terminal out of the toolbar', () => {
    render(
      <ThemeProvider>
        <TopToolbar
          environments={[]}
          onSelectEnvironment={vi.fn()}
          onOpenEnvironmentManager={vi.fn()}
          onOpenPreferences={vi.fn()}
        />
      </ThemeProvider>,
    );
    for (const name of ['About AwapiLasso', 'Check for Updates', 'Toggle terminal']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('renders active collection badge, environment switcher with color indicator, manager button, and import menu', () => {
    const onSelectEnvironment = vi.fn();
    const onOpenEnvironmentManager = vi.fn();
    const onOpenPreferences = vi.fn();
    const onOpenImportOpenApi = vi.fn();
    const onOpenImportCurl = vi.fn();
    const onOpenImportPostman = vi.fn();
    const onOpenImportBruno = vi.fn();
    const onOpenCollectionRunner = vi.fn();

    render(
      <ThemeProvider>
        <TopToolbar
          activeCollectionName="Payments API"
          activeCollectionPath="/Users/me/payments.awjc"
          environments={sampleEnvironments}
          activeEnvironmentName="staging"
          onSelectEnvironment={onSelectEnvironment}
          onOpenEnvironmentManager={onOpenEnvironmentManager}
          onOpenPreferences={onOpenPreferences}
          onOpenImportOpenApi={onOpenImportOpenApi}
          onOpenImportCurl={onOpenImportCurl}
          onOpenImportPostman={onOpenImportPostman}
          onOpenImportBruno={onOpenImportBruno}
          onOpenCollectionRunner={onOpenCollectionRunner}
          cliEnabled={true}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('active-collection-badge')).toHaveTextContent('Payments API');
    expect(screen.getByTestId('cli-status-badge')).toHaveTextContent('awlasso CLI active');

    const colorDot = screen.getByTestId('environment-color-dot');
    expect(colorDot).toHaveStyle({ backgroundColor: '#f59e0b' });

    const envSelect = screen.getByTestId('environment-switcher-select');
    expect(envSelect).toHaveValue('staging');
    expect(envSelect).toHaveAttribute('title', 'Active Environment (Cmd/Ctrl+E)');
    expect(screen.getByTestId('environment-switcher-wrapper')).toHaveAttribute(
      'title',
      'Active Environment (Cmd/Ctrl+E)',
    );

    fireEvent.change(envSelect, { target: { value: 'prod' } });
    expect(onSelectEnvironment).toHaveBeenCalledWith('prod');

    fireEvent.click(screen.getByTestId('open-env-manager-btn'));
    expect(onOpenEnvironmentManager).toHaveBeenCalledTimes(1);

    for (const name of ['Environments', 'Runner', 'Import']) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent).toBe('');
      expect(button).toHaveAttribute('title');
      expect(button.querySelector('svg')).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Runner' }));
    expect(onOpenCollectionRunner).toHaveBeenCalledTimes(1);

    // Import dropdown menu shows OpenAPI / Swagger, cURL, Postman, and Bruno options
    expect(screen.getByTestId('toolbar-import-btn')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    expect(screen.getByTestId('toolbar-import-btn')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('toolbar-import-menu')).toBeInTheDocument();
    expect(screen.getByTestId('import-bruno-btn')).toBeEnabled();
    expect(screen.getByTestId('import-postman-btn')).toBeEnabled();

    fireEvent.click(screen.getByTestId('import-openapi-btn'));
    expect(onOpenImportOpenApi).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('toolbar-import-btn')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    fireEvent.click(screen.getByTestId('open-import-curl-btn'));
    expect(onOpenImportCurl).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    fireEvent.click(screen.getByTestId('import-postman-btn'));
    expect(onOpenImportPostman).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toolbar-import-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toolbar-import-btn'));
    fireEvent.click(screen.getByTestId('import-bruno-btn'));
    expect(onOpenImportBruno).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toolbar-import-menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-preferences-btn'));
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });

  it('renders active collection Git status badge and opens Git modal on click', () => {
    const onOpenGitSourceControl = vi.fn();

    render(
      <ThemeProvider>
        <TopToolbar
          activeCollectionName="Payments API"
          activeCollectionPath="/Users/me/apis/payments.awjc"
          activeCollectionDirty={true}
          activeGitStatus={{
            collectionFilePath: '/Users/me/apis/payments.awjc',
            folderPath: '/Users/me/apis',
            isGitRepo: true,
            branch: 'feat/checkout',
            ahead: 2,
            behind: 1,
            fileStatus: 'modified',
            folderChangedFiles: [],
            branches: ['main', 'feat/checkout'],
            safety: {
              safe: true,
              secretsSidecarIgnored: true,
              hasPlaintextSecrets: false,
              plaintextSecretWarnings: [],
              issues: [],
            },
          }}
          onOpenGitSourceControl={onOpenGitSourceControl}
          environments={sampleEnvironments}
          activeEnvironmentName="staging"
          onSelectEnvironment={vi.fn()}
          onOpenEnvironmentManager={vi.fn()}
          onOpenPreferences={vi.fn()}
        />
      </ThemeProvider>,
    );

    const gitBtn = screen.getByTestId('toolbar-git-status-btn');
    expect(gitBtn).toHaveTextContent('feat/checkout');
    expect(screen.getByTestId('toolbar-git-state-pill')).toHaveTextContent('Modified');
    fireEvent.click(gitBtn);
    expect(onOpenGitSourceControl).toHaveBeenCalledTimes(1);
  });

  it('toggles awlasso CLI installation when clicking the CLI status badge', () => {
    const onToggleCliCommand = vi.fn();
    render(
      <ThemeProvider>
        <TopToolbar
          environments={sampleEnvironments}
          activeEnvironmentName="local"
          onSelectEnvironment={vi.fn()}
          onOpenEnvironmentManager={vi.fn()}
          onOpenPreferences={vi.fn()}
          cliEnabled={false}
          cliCommandPath="/usr/local/bin/awlasso"
          onToggleCliCommand={onToggleCliCommand}
        />
      </ThemeProvider>,
    );

    const cliBadge = screen.getByTestId('cli-status-badge');
    expect(cliBadge).toHaveTextContent('awlasso CLI ready');
    fireEvent.click(cliBadge);
    expect(onToggleCliCommand).toHaveBeenCalledTimes(1);
  });

  it('supports Cmd/Ctrl+E to focus environment switcher and Cmd/Ctrl+, to open preferences', () => {
    const onOpenPreferences = vi.fn();
    render(
      <ThemeProvider>
        <TopToolbar
          environments={sampleEnvironments}
          activeEnvironmentName="local"
          onSelectEnvironment={vi.fn()}
          onOpenEnvironmentManager={vi.fn()}
          onOpenPreferences={onOpenPreferences}
        />
      </ThemeProvider>,
    );

    const envSelect = screen.getByTestId('environment-switcher-select');
    fireEvent.keyDown(window, { key: 'e', metaKey: true });
    expect(document.activeElement).toBe(envSelect);

    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });

  it('shows the AI assistant toggle only when wired, reflects state, and supports Cmd/Ctrl+Shift+A', () => {
    const onToggleAiPanel = vi.fn();
    const baseProps = {
      environments: [],
      onSelectEnvironment: vi.fn(),
      onOpenEnvironmentManager: vi.fn(),
      onOpenPreferences: vi.fn(),
    };
    const { rerender } = render(
      <ThemeProvider>
        <TopToolbar {...baseProps} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('toggle-ai-panel-btn')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <TopToolbar {...baseProps} aiPanelOpen onToggleAiPanel={onToggleAiPanel} />
      </ThemeProvider>,
    );
    const button = screen.getByTestId('toggle-ai-panel-btn');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onToggleAiPanel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'A', metaKey: true, shiftKey: true });
    expect(onToggleAiPanel).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    expect(onToggleAiPanel).toHaveBeenCalledTimes(2);
  });
});
