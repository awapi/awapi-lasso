import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  createDefaultFolder,
  createDefaultHttpRequest,
  createEmptyCollection,
} from '../../../shared/collectionSchema';
import { ThemeProvider } from '../context/ThemeContext';
import { SaveRequestModal } from './SaveRequestModal';

describe('SaveRequestModal', () => {
  const sampleRequest = createDefaultHttpRequest({
    id: 'req_test_1',
    name: 'Get User Profile',
    method: 'GET',
    url: 'https://api.example.com/v1/profile',
  });

  it('shows empty-collections state when no collections are open and allows creating a new collection', () => {
    const onCreateCollection = vi.fn().mockReturnValue('untitled-1.awjc');
    const onConfirmSave = vi.fn();

    render(
      <ThemeProvider>
        <SaveRequestModal
          isOpen={true}
          request={sampleRequest}
          collections={[]}
          activeCollectionPath={null}
          onCreateCollection={onCreateCollection}
          onOpenCollectionDialog={vi.fn().mockResolvedValue(null)}
          onCreateFolder={vi.fn()}
          onConfirmSave={onConfirmSave}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('save-modal-empty-collections')).toBeInTheDocument();
    expect(screen.getByTestId('save-request-modal-confirm-btn')).toBeDisabled();

    // Click Create New Collection CTA
    fireEvent.click(screen.getByTestId('save-modal-empty-new-collection-cta'));
    const colInput = screen.getByTestId('save-modal-new-collection-input');
    fireEvent.change(colInput, { target: { value: 'Customer API' } });
    fireEvent.click(screen.getByTestId('save-modal-confirm-new-collection-btn'));

    expect(onCreateCollection).toHaveBeenCalledWith('Customer API');
  });

  it('allows selecting a collection, nested folder, creating a subfolder inline, and saving the request', () => {
    const subFolder = createDefaultFolder('v1', [], { id: 'fld_v1' });
    const parentFolder = createDefaultFolder('Users', [subFolder], { id: 'fld_users' });
    const col1 = createEmptyCollection('Orders & Users', {
      items: [parentFolder],
    });

    const onCreateFolder = vi.fn().mockReturnValue('fld_new_sub');
    const onConfirmSave = vi.fn();

    render(
      <ThemeProvider>
        <SaveRequestModal
          isOpen={true}
          request={sampleRequest}
          collections={[{ filePath: '/workspace/orders.awjc', collection: col1 }]}
          activeCollectionPath="/workspace/orders.awjc"
          onCreateCollection={vi.fn()}
          onOpenCollectionDialog={vi.fn()}
          onCreateFolder={onCreateFolder}
          onConfirmSave={onConfirmSave}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    // Rename request
    const nameInput = screen.getByTestId('save-request-name-input');
    expect(nameInput).toHaveValue('Get User Profile');
    fireEvent.change(nameInput, { target: { value: 'Fetch Active User' } });

    // Select nested subfolder 'v1'
    fireEvent.click(screen.getByTestId('save-modal-folder-item-fld_v1'));
    expect(screen.getByTestId('save-modal-destination-summary')).toHaveTextContent(
      'Orders & Users / Users / v1',
    );

    // Create a new subfolder under 'Users'
    fireEvent.click(screen.getByTestId('save-modal-add-subfolder-btn-fld_users'));
    const folderInput = screen.getByTestId('save-modal-new-folder-input');
    fireEvent.change(folderInput, { target: { value: 'Admin' } });
    fireEvent.click(screen.getByTestId('save-modal-confirm-new-folder-btn'));

    expect(onCreateFolder).toHaveBeenCalledWith('/workspace/orders.awjc', 'Admin', 'fld_users');

    // Confirm save
    fireEvent.click(screen.getByTestId('save-request-modal-confirm-btn'));
    expect(onConfirmSave).toHaveBeenCalledWith({
      collectionPath: '/workspace/orders.awjc',
      parentFolderId: 'fld_new_sub',
      requestName: 'Fetch Active User',
    });
  });

  it('does not close the modal when mouseDown starts inside an input and mouseUp/click finishes on the backdrop', () => {
    const onClose = vi.fn();

    render(
      <ThemeProvider>
        <SaveRequestModal
          isOpen={true}
          request={sampleRequest}
          collections={[]}
          activeCollectionPath={null}
          onCreateCollection={vi.fn()}
          onOpenCollectionDialog={vi.fn()}
          onCreateFolder={vi.fn()}
          onConfirmSave={vi.fn()}
          onClose={onClose}
        />
      </ThemeProvider>,
    );

    const nameInput = screen.getByTestId('save-request-name-input');
    const backdrop = screen.getByTestId('save-request-modal-backdrop');

    // Simulate starting text selection inside the input and releasing outside on the backdrop
    fireEvent.mouseDown(nameInput);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();

    // Clicking directly on the backdrop (mouseDown + click on backdrop) closes the modal
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
