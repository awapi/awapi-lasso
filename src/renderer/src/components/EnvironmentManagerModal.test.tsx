import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EnvironmentManagerModal } from './EnvironmentManagerModal';
import { createEmptyCollection, type AwjcCollection } from '../../../shared/collectionSchema';

const StatefulModalHarness: React.FC = () => {
  const [collection, setCollection] = useState<AwjcCollection>(() =>
    createEmptyCollection('Billing API', {
      metadata: { id: 'col_billing', name: 'Billing API' },
    }),
  );
  return (
    <EnvironmentManagerModal
      isOpen={true}
      collection={collection}
      onUpdateCollection={setCollection}
      onClose={vi.fn()}
    />
  );
};

describe('EnvironmentManagerModal', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      setSecret: vi.fn().mockResolvedValue(true),
      deleteSecret: vi.fn().mockResolvedValue(true),
    } as unknown as Window['electronAPI'];
  });

  it('creates, renames, color-tags, duplicates, and deletes environments and stores secrets via electronAPI', () => {
    render(<StatefulModalHarness />);

    expect(screen.getByTestId('environment-manager-modal')).toBeInTheDocument();
    expect(screen.getByTestId('env-name-input')).toHaveValue('local');

    // Toggle secret on baseUrl variable -> persists via electronAPI.setSecret
    fireEvent.click(screen.getByTestId('env-vars-secret-toggle-0'));
    expect(window.electronAPI.setSecret).toHaveBeenCalledWith(
      {
        collectionId: 'col_billing',
        scopeId: 'env:local',
        key: 'baseUrl',
      },
      'http://localhost:8080',
    );

    // Rename local -> dev
    fireEvent.change(screen.getByTestId('env-name-input'), { target: { value: 'dev' } });
    expect(screen.getByTestId('env-list-item-dev')).toBeInTheDocument();

    // Duplicate dev -> dev-copy
    fireEvent.click(screen.getByTestId('env-duplicate-btn-dev'));
    expect(screen.getByTestId('env-list-item-dev-copy')).toBeInTheDocument();

    // Switch to Collection Variables tab and add a variable
    fireEvent.click(screen.getByTestId('env-modal-tab-collection-vars'));
    fireEvent.click(screen.getByTestId('collection-vars-add-row-btn'));
    fireEvent.change(screen.getByTestId('collection-vars-key-0'), {
      target: { value: 'apiVersion' },
    });
    expect(screen.getByTestId('collection-vars-key-0')).toHaveValue('apiVersion');

    // Switch to Auth & OAuth 2.0 Profiles tab and create a profile
    fireEvent.click(screen.getByTestId('env-modal-tab-auth-profiles'));
    fireEvent.click(screen.getByTestId('auth-profile-add-btn'));
    expect(screen.getByTestId('auth-profile-name-input')).toHaveValue('Auth Profile 1');
  });
});
