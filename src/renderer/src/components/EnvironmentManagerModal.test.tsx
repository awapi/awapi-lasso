import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EnvironmentManagerModal } from './EnvironmentManagerModal';
import { createEmptyCollection, type AwjcCollection } from '../../../shared/collectionSchema';

function makeCollection(): AwjcCollection {
  return createEmptyCollection('Billing API', {
    metadata: { id: 'col_billing', name: 'Billing API' },
  });
}

describe('EnvironmentManagerModal', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      setSecret: vi.fn().mockResolvedValue(true),
      deleteSecret: vi.fn().mockResolvedValue(true),
    } as unknown as Window['electronAPI'];
  });

  it('renders nothing when closed', () => {
    render(
      <EnvironmentManagerModal
        isOpen={false}
        collection={makeCollection()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('environment-manager-modal')).not.toBeInTheDocument();
  });

  it('edits a draft (rename, duplicate, collection vars, auth profiles) and saves it all at once, storing secrets under the environment id', async () => {
    const collection = makeCollection();
    const envId = collection.environments![0].id;
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={collection}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('env-name-input')).toHaveValue('local');

    // Secret toggles are deferred until Save
    fireEvent.click(screen.getByTestId('env-vars-secret-toggle-0'));
    expect(window.electronAPI.setSecret).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('env-name-input'), { target: { value: 'dev' } });
    expect(screen.getByTestId('env-list-item-dev')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('env-duplicate-btn-dev'));
    expect(screen.getByTestId('env-list-item-dev-copy')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('env-modal-tab-collection-vars'));
    fireEvent.click(screen.getByTestId('collection-vars-add-row-btn'));
    fireEvent.change(screen.getByTestId('collection-vars-key-0'), {
      target: { value: 'apiVersion' },
    });
    expect(screen.getByTestId('collection-vars-key-0')).toHaveValue('apiVersion');

    const authProfilesTab = screen.getByTestId('env-modal-tab-auth-profiles');
    expect(authProfilesTab).toHaveTextContent('Auth Profiles (0)');
    fireEvent.click(authProfilesTab);
    fireEvent.click(screen.getByTestId('auth-profile-add-btn'));
    expect(screen.getByTestId('auth-profile-name-input')).toHaveValue('Auth Profile 1');

    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('env-modal-save-btn'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(window.electronAPI.setSecret).toHaveBeenCalledWith(
      { collectionId: 'col_billing', scopeId: `env:${envId}`, key: 'baseUrl' },
      'http://localhost:8080',
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as AwjcCollection;
    expect(saved.activeEnvironment).toBe('dev');
    expect(saved.environments?.map(e => e.name)).toEqual(['dev', 'dev-copy']);
    expect(saved.variables?.[0].key).toBe('apiVersion');
    expect(saved.authProfiles).toHaveLength(1);
    // The source collection is never mutated by the draft
    expect(collection.environments?.map(e => e.name)).toEqual(['local']);
  });

  it('keeps the active environment linked when the name is cleared before typing a new one', async () => {
    const onSave = vi.fn();
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={makeCollection()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    const nameInput = screen.getByTestId('env-name-input');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.change(nameInput, { target: { value: 'staging' } });
    fireEvent.click(screen.getByTestId('env-modal-save-btn'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0] as AwjcCollection;
    expect(saved.environments?.[0].name).toBe('staging');
    expect(saved.activeEnvironment).toBe('staging');
  });

  it('asks before discarding unsaved edits on Cancel and never calls onSave', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={makeCollection()}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByTestId('env-name-input'), { target: { value: 'dev' } });
    fireEvent.click(screen.getByTestId('env-modal-cancel-btn'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('env-modal-footer')).toHaveTextContent('Discard them?');

    fireEvent.click(screen.getByTestId('env-modal-keep-editing-btn'));
    expect(screen.getByTestId('env-name-input')).toHaveValue('dev');

    fireEvent.click(screen.getByTestId('env-modal-close-btn'));
    fireEvent.click(screen.getByTestId('env-modal-discard-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes immediately on Cancel when nothing was edited', () => {
    const onClose = vi.fn();
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={makeCollection()}
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('env-modal-cancel-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves with Cmd/Ctrl+S without letting the shortcut reach window listeners', async () => {
    const onSave = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={makeCollection()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('env-name-input'), { target: { value: 'qa' } });
    fireEvent.keyDown(screen.getByTestId('env-name-input'), { key: 's', ctrlKey: true });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(windowListener).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowListener);
  });

  it('shows the error and stays open when saving fails', async () => {
    const onClose = vi.fn();
    render(
      <EnvironmentManagerModal
        isOpen={true}
        collection={makeCollection()}
        onSave={vi.fn().mockRejectedValue(new Error('disk full'))}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('env-modal-save-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('env-modal-footer')).toHaveTextContent('Save failed: disk full'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
