import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '../context/ThemeContext';
import { GitSourceControlModal } from './GitSourceControlModal';
import { createEmptyCollection } from '../../../shared/collectionSchema';
import type { GitCollectionStatus, GitDiffPayload } from '../../../shared/gitTypes';

function buildMockStatus(overrides: Partial<GitCollectionStatus> = {}): GitCollectionStatus {
  return {
    collectionFilePath: '/repo/orders/orders.awjc',
    folderPath: '/repo/orders',
    isGitRepo: true,
    repoRootPath: '/repo/orders',
    relativeFilePath: 'orders.awjc',
    branch: 'main',
    detachedHead: false,
    ahead: 1,
    behind: 2,
    fileStatus: 'modified',
    folderChangedFiles: [{ path: 'orders.awjc', status: 'M' }],
    branches: ['main', 'feat/v2'],
    safety: {
      safe: true,
      secretsSidecarIgnored: true,
      hasPlaintextSecrets: false,
      plaintextSecretWarnings: [],
      issues: [],
    },
    ...overrides,
  };
}

function buildMockDiff(overrides: Partial<GitDiffPayload> = {}): GitDiffPayload {
  return {
    collectionFilePath: '/repo/orders/orders.awjc',
    commitRef: 'HEAD',
    headContent: 'awapiLasso: "1.0"\nmetadata:\n  name: Orders v1\n',
    workingContent: 'awapiLasso: "1.0"\nmetadata:\n  name: Orders v2\n',
    rawUnifiedDiff: '-  name: Orders v1\n+  name: Orders v2\n',
    hasChanges: true,
    ...overrides,
  };
}

describe('GitSourceControlModal', () => {
  const collection = createEmptyCollection('Orders API');

  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      getGitStatus: vi.fn().mockResolvedValue(buildMockStatus()),
      initGitRepo: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Initialized Git repository',
        status: buildMockStatus({ fileStatus: 'untracked' }),
      }),
      ensureGitignore: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Updated .gitignore',
        status: buildMockStatus(),
      }),
      getGitDiff: vi.fn().mockResolvedValue(buildMockDiff()),
      getGitLog: vi.fn().mockResolvedValue([
        {
          hash: 'abcdef1234567890',
          shortHash: 'abcdef1',
          author: 'Alice',
          date: '2026-10-25T12:00:00Z',
          subject: 'Initial Orders API collection',
        },
      ]),
      checkoutGitBranch: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Switched branch',
        status: buildMockStatus({ branch: 'feat/v2' }),
      }),
      commitGitChanges: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Committed changes',
        status: buildMockStatus({ fileStatus: 'clean', folderChangedFiles: [] }),
      }),
      pullGit: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Pulled latest commits',
        status: buildMockStatus({ behind: 0 }),
      }),
      pushGit: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Pushed commits to remote',
        status: buildMockStatus({ ahead: 0 }),
      }),
      revertGitChanges: vi.fn().mockResolvedValue({
        ok: true,
        message: 'Reverted uncommitted collection changes to HEAD.',
        status: buildMockStatus({ fileStatus: 'clean', folderChangedFiles: [] }),
      }),
    } as unknown as Window['electronAPI'];
  });

  it('offers git init when collection folder is not yet a Git repository', async () => {
    vi.mocked(window.electronAPI.getGitStatus)
      .mockResolvedValueOnce(
        buildMockStatus({
          isGitRepo: false,
          fileStatus: 'not_a_repo',
        }),
      )
      .mockResolvedValueOnce(buildMockStatus());

    render(
      <ThemeProvider>
        <GitSourceControlModal
          isOpen={true}
          collectionFilePath="/repo/orders/orders.awjc"
          collection={collection}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('git-not-a-repo-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('git-init-repo-btn'));

    await waitFor(() => {
      expect(window.electronAPI.initGitRepo).toHaveBeenCalledWith('/repo/orders/orders.awjc');
    });
  });

  it('displays branch switcher, YAML diff, commit history, and commits changes', async () => {
    const onSaveCollection = vi.fn().mockResolvedValue(undefined);

    render(
      <ThemeProvider>
        <GitSourceControlModal
          isOpen={true}
          collectionFilePath="/repo/orders/orders.awjc"
          collection={collection}
          isCollectionDirty={true}
          onSaveCollection={onSaveCollection}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('git-branch-select')).toHaveValue('main');
    });

    // Verifies side-by-side YAML diff content
    expect(screen.getByTestId('git-diff-original')).toHaveTextContent('Orders v1');
    expect(screen.getByTestId('git-diff-modified')).toHaveTextContent('Orders v2');
    expect(screen.getByTestId('git-safety-badge-safe')).toBeInTheDocument();

    const refreshButton = screen.getByRole('button', { name: 'Refresh Git status and diff' });
    expect(refreshButton.textContent).toBe('');
    expect(refreshButton).toHaveAttribute('title', 'Refresh Git status and diff');
    expect(refreshButton.querySelector('svg')).toBeInTheDocument();
    vi.mocked(window.electronAPI.getGitStatus).mockClear();
    fireEvent.click(refreshButton);
    await waitFor(() => {
      expect(window.electronAPI.getGitStatus).toHaveBeenCalledWith('/repo/orders/orders.awjc');
    });

    // Clicking historical commit compares against that commit hash
    fireEvent.click(screen.getByTestId('git-commit-item-abcdef1'));
    await waitFor(() => {
      expect(window.electronAPI.getGitDiff).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionFilePath: '/repo/orders/orders.awjc',
          commitRef: 'abcdef1234567890',
        }),
      );
    });

    // Enter commit message and commit
    fireEvent.change(screen.getByTestId('git-commit-message-input'), {
      target: { value: 'Add refund endpoint to Orders API' },
    });
    fireEvent.click(screen.getByTestId('git-commit-submit-btn'));

    await waitFor(() => {
      expect(onSaveCollection).toHaveBeenCalledWith('/repo/orders/orders.awjc');
      expect(window.electronAPI.commitGitChanges).toHaveBeenCalledWith({
        collectionFilePath: '/repo/orders/orders.awjc',
        message: 'Add refund endpoint to Orders API',
        scope: 'collection_only',
      });
    });
  });

  it('supports switching branches, creating branches, pulling, and pushing', async () => {
    render(
      <ThemeProvider>
        <GitSourceControlModal
          isOpen={true}
          collectionFilePath="/repo/orders/orders.awjc"
          collection={collection}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('git-branch-select')).toBeInTheDocument();
    });

    // Switch branch via dropdown
    fireEvent.change(screen.getByTestId('git-branch-select'), {
      target: { value: 'feat/v2' },
    });
    await waitFor(() => {
      expect(window.electronAPI.checkoutGitBranch).toHaveBeenCalledWith({
        collectionFilePath: '/repo/orders/orders.awjc',
        branch: 'feat/v2',
        createNew: false,
      });
    });

    // Create new branch
    fireEvent.click(screen.getByTestId('git-new-branch-toggle-btn'));
    fireEvent.change(screen.getByTestId('git-new-branch-input'), {
      target: { value: 'feat/graphql-mutations' },
    });
    fireEvent.click(screen.getByTestId('git-create-branch-btn'));
    await waitFor(() => {
      expect(window.electronAPI.checkoutGitBranch).toHaveBeenCalledWith({
        collectionFilePath: '/repo/orders/orders.awjc',
        branch: 'feat/graphql-mutations',
        createNew: true,
      });
    });

    // Pull & Push
    fireEvent.click(screen.getByTestId('git-pull-btn'));
    await waitFor(() => {
      expect(window.electronAPI.pullGit).toHaveBeenCalledWith('/repo/orders/orders.awjc');
    });

    fireEvent.click(screen.getByTestId('git-push-btn'));
    await waitFor(() => {
      expect(window.electronAPI.pushGit).toHaveBeenCalledWith('/repo/orders/orders.awjc');
    });
  });

  it('prompts for confirmation before reverting uncommitted collection changes to HEAD and reloads on confirm', async () => {
    const onReloadCollection = vi.fn().mockResolvedValue(undefined);

    render(
      <ThemeProvider>
        <GitSourceControlModal
          isOpen={true}
          collectionFilePath="/repo/orders/orders.awjc"
          collection={collection}
          isCollectionDirty={true}
          onReloadCollection={onReloadCollection}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('git-revert-btn')).toBeInTheDocument();
    });

    // Clicking Revert first shows the confirmation prompt without calling revertGitChanges
    fireEvent.click(screen.getByTestId('git-revert-btn'));
    expect(screen.getByTestId('git-revert-confirm-prompt')).toBeInTheDocument();
    expect(window.electronAPI.revertGitChanges).not.toHaveBeenCalled();

    // Cancel dismisses the prompt
    fireEvent.click(screen.getByTestId('git-cancel-revert-btn'));
    expect(screen.queryByTestId('git-revert-confirm-prompt')).not.toBeInTheDocument();
    expect(window.electronAPI.revertGitChanges).not.toHaveBeenCalled();

    // Clicking Revert and then Confirm Revert executes the revert and reloads the collection
    fireEvent.click(screen.getByTestId('git-revert-btn'));
    fireEvent.click(screen.getByTestId('git-confirm-revert-btn'));

    await waitFor(() => {
      expect(window.electronAPI.revertGitChanges).toHaveBeenCalledWith({
        collectionFilePath: '/repo/orders/orders.awjc',
        commitRef: 'HEAD',
      });
      expect(onReloadCollection).toHaveBeenCalledWith('/repo/orders/orders.awjc');
    });
  });

  it('supports dragging the header to move the popup, resizing via handles, and maximizing/restoring', async () => {
    render(
      <ThemeProvider>
        <GitSourceControlModal
          isOpen={true}
          collectionFilePath="/repo/orders/orders.awjc"
          collection={collection}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('git-source-control-modal')).toBeInTheDocument();
    });

    const modal = screen.getByTestId('git-source-control-modal');
    const header = screen.getByTestId('git-modal-header');
    const initialLeft = Number.parseInt(modal.style.left, 10);
    const initialTop = Number.parseInt(modal.style.top, 10);
    const initialWidth = Number.parseInt(modal.style.width, 10);
    const initialHeight = Number.parseInt(modal.style.height, 10);

    // Drag header to move popup
    fireEvent.mouseDown(header, { button: 0, clientX: 200, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 260, clientY: 145 });
    fireEvent.mouseUp(window);

    expect(Number.parseInt(modal.style.left, 10)).toBe(initialLeft + 60);
    expect(Number.parseInt(modal.style.top, 10)).toBe(initialTop + 45);

    // Resize via bottom-right (se) handle
    const seHandle = screen.getByTestId('git-modal-resize-se');
    fireEvent.mouseDown(seHandle, { button: 0, clientX: 600, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 680, clientY: 550 });
    fireEvent.mouseUp(window);

    expect(Number.parseInt(modal.style.width, 10)).toBe(initialWidth + 80);
    expect(Number.parseInt(modal.style.height, 10)).toBe(initialHeight + 50);

    // Toggle maximize and restore
    const maxBtn = screen.getByTestId('git-modal-maximize-btn');
    fireEvent.click(maxBtn);
    expect(modal.style.width).toBe('calc(100vw - 24px)');
    fireEvent.click(maxBtn);
    expect(Number.parseInt(modal.style.width, 10)).toBe(initialWidth + 80);
  });
});
