import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AiSettingsModal } from './AiSettingsModal';
import { ThemeProvider } from '../context/ThemeContext';
import { createDefaultAiSettings } from '../../../shared/aiTypes';

function mockApi(hasKey = false) {
  const settings = createDefaultAiSettings();
  const api = {
    aiGetSettings: vi.fn().mockResolvedValue(settings),
    aiSaveSettings: vi.fn().mockImplementation(async s => s),
    aiGetKeyStatuses: vi.fn().mockResolvedValue([
      { provider: 'openai', hasKey },
      { provider: 'anthropic', hasKey: false },
      { provider: 'openai-compatible', hasKey: false },
    ]),
    aiSetKey: vi.fn().mockResolvedValue({ ok: true }),
    aiClearKey: vi.fn().mockResolvedValue(true),
    aiTestConnection: vi.fn().mockResolvedValue({ ok: true, message: 'Connected to OpenAI using gpt.' }),
  };
  window.electronAPI = api as unknown as Window['electronAPI'];
  return api;
}

const renderModal = (props: Partial<React.ComponentProps<typeof AiSettingsModal>> = {}) =>
  render(
    <ThemeProvider>
      <AiSettingsModal isOpen onClose={vi.fn()} {...props} />
    </ThemeProvider>,
  );

describe('AiSettingsModal', () => {
  beforeEach(() => {
    mockApi();
  });

  it('renders nothing when closed', () => {
    render(
      <ThemeProvider>
        <AiSettingsModal isOpen={false} onClose={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('ai-settings-modal')).not.toBeInTheDocument();
  });

  it('loads settings and shows a masked key input with status', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByTestId('ai-provider-select')).toHaveValue('openai'));
    expect(screen.getByTestId('ai-key-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('ai-key-status')).toHaveTextContent('No key stored');
    expect(screen.getByTestId('ai-save-key-btn')).toBeDisabled();
    expect(screen.queryByTestId('ai-remove-key-btn')).not.toBeInTheDocument();
  });

  it('saves a key without echoing it back, clears the field, and notifies the parent', async () => {
    const api = mockApi();
    const onChanged = vi.fn();
    renderModal({ onChanged });
    await waitFor(() => screen.getByTestId('ai-key-input'));
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk-test-1' } });
    fireEvent.click(screen.getByTestId('ai-save-key-btn'));
    await waitFor(() => expect(api.aiSetKey).toHaveBeenCalledWith('openai', 'sk-test-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByTestId('ai-key-input')).toHaveValue('');
    expect(screen.getByTestId('ai-settings-feedback')).toHaveTextContent('saved to the OS Keychain');
  });

  it('shows keychain errors from saving a key', async () => {
    const api = mockApi();
    api.aiSetKey.mockResolvedValue({ ok: false, error: 'Secure storage is unavailable' });
    renderModal();
    await waitFor(() => screen.getByTestId('ai-key-input'));
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk' } });
    fireEvent.click(screen.getByTestId('ai-save-key-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-feedback')).toHaveTextContent('Secure storage is unavailable'),
    );
  });

  it('offers Replace/Remove when a key exists and removes it', async () => {
    const api = mockApi(true);
    renderModal();
    await waitFor(() => expect(screen.getByTestId('ai-key-status')).toHaveTextContent('stored in the OS Keychain'));
    expect(screen.getByTestId('ai-save-key-btn')).toHaveTextContent('Replace');
    fireEvent.click(screen.getByTestId('ai-remove-key-btn'));
    await waitFor(() => expect(api.aiClearKey).toHaveBeenCalledWith('openai'));
  });

  it('keeps per-provider models when switching providers and saves all settings', async () => {
    const api = mockApi();
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => screen.getByTestId('ai-provider-select'));
    fireEvent.change(screen.getByTestId('ai-model-input'), { target: { value: 'gpt-custom' } });
    fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'anthropic' } });
    expect(screen.getByTestId('ai-model-input')).toHaveValue(createDefaultAiSettings().models.anthropic);
    fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'openai' } });
    expect(screen.getByTestId('ai-model-input')).toHaveValue('gpt-custom');

    fireEvent.click(screen.getByTestId('ai-save-btn'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.aiSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', models: expect.objectContaining({ openai: 'gpt-custom' }) }),
    );
  });

  it('tests the connection and reports the result', async () => {
    const api = mockApi();
    renderModal();
    await waitFor(() => screen.getByTestId('ai-test-btn'));
    fireEvent.click(screen.getByTestId('ai-test-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-feedback')).toHaveTextContent('Connected to OpenAI'),
    );
    expect(api.aiSaveSettings).toHaveBeenCalled();

    api.aiTestConnection.mockResolvedValue({ ok: false, message: 'rejected the API key' });
    fireEvent.click(screen.getByTestId('ai-test-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('ai-settings-feedback')).toHaveTextContent('rejected the API key'),
    );
  });

  it('closes on Cancel without saving', async () => {
    const api = mockApi();
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => screen.getByTestId('ai-cancel-btn'));
    fireEvent.click(screen.getByTestId('ai-cancel-btn'));
    expect(onClose).toHaveBeenCalled();
    expect(api.aiSaveSettings).not.toHaveBeenCalled();
  });

  it('saves the approval preferences', async () => {
    const api = mockApi();
    renderModal();
    await waitFor(() => screen.getByTestId('ai-auto-apply-checkbox'));
    expect(screen.getByTestId('ai-confirm-run-checkbox')).toBeChecked();
    expect(screen.getByTestId('ai-auto-apply-checkbox')).not.toBeChecked();
    expect(screen.queryByTestId('ai-autonomy-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-auto-apply-checkbox'));
    expect(screen.queryByTestId('ai-autonomy-warning')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ai-confirm-run-checkbox'));
    expect(screen.getByTestId('ai-autonomy-warning')).toHaveTextContent('without asking');
    expect(screen.getByTestId('ai-share-env-checkbox')).toBeChecked();
    fireEvent.click(screen.getByTestId('ai-share-env-checkbox'));
    fireEvent.click(screen.getByTestId('ai-save-btn'));
    await waitFor(() =>
      expect(api.aiSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ autoApplyEdits: true, confirmBeforeRun: false, shareEnvironmentValues: false }),
      ),
    );
  });
});
