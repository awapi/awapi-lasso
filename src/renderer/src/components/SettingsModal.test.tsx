import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsModal from './SettingsModal';
import { ThemeProvider } from '../context/ThemeContext';

const renderModal = (isOpen = true, onClose = vi.fn()) =>
  render(
    <ThemeProvider>
      <SettingsModal isOpen={isOpen} onClose={onClose} />
    </ThemeProvider>,
  );

describe('SettingsModal', () => {
  let mockElectronAPI: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockElectronAPI = {
      loadSettings: vi.fn().mockResolvedValue({
        sessionDir: null,
        theme: 'dark',
        verifySsl: true,
        defaultTimeoutMs: 30000,
        followRedirects: true,
      }),
      saveSettings: vi.fn().mockImplementation(async partial => ({
        sessionDir: null,
        theme: 'dark',
        ...partial,
      })),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = mockElectronAPI;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('renders nothing when closed', () => {
    renderModal(false);
    expect(screen.queryByTestId('settings-modal')).toBeNull();
  });

  it('renders the modal when open and defaults to the General tab', async () => {
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('settings-modal')).toBeDefined());
    expect(screen.getByText('Preferences')).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('settings-tabs')).toBeDefined());
    expect(screen.getByTestId('settings-tab-general').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('settings-general-section')).toBeDefined();
    expect(screen.getByTestId('settings-group-http-defaults')).toBeDefined();
  });

  it('switches between General, Appearance, and Terminal tabs with grouped sections', async () => {
    mockElectronAPI.getTerminalChoices = vi.fn().mockResolvedValue({
      platform: 'win32',
      externalTerminals: [],
      shells: [],
      autoExternalTerminal: null,
      autoShell: null,
    });
    renderModal(true);
    await waitFor(() => expect(screen.getByTestId('settings-tab-general')).toBeDefined());

    expect(screen.getByTestId('settings-general-section')).toBeDefined();
    expect(screen.queryByTestId('settings-appearance-section')).toBeNull();
    expect(screen.queryByTestId('settings-terminal-section')).toBeNull();

    fireEvent.click(screen.getByTestId('settings-tab-appearance'));
    expect(screen.getByTestId('settings-tab-appearance').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('settings-appearance-section')).toBeDefined();
    expect(screen.getByTestId('settings-group-theme')).toBeDefined();
    expect(screen.queryByTestId('settings-general-section')).toBeNull();

    fireEvent.click(screen.getByTestId('settings-tab-terminal'));
    expect(screen.getByTestId('settings-tab-terminal').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('settings-terminal-section')).toBeDefined();
    expect(screen.getByTestId('settings-group-integrated-terminal')).toBeDefined();
    expect(screen.getByTestId('settings-group-external-terminal')).toBeDefined();
    expect(screen.queryByTestId('settings-appearance-section')).toBeNull();
  });

  it('calls onClose when Close button is clicked', async () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    await waitFor(() => screen.getByTestId('settings-close-btn'));
    fireEvent.click(screen.getByTestId('settings-close-btn'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('switches theme and persists to settings', async () => {
    renderModal(true);
    await waitFor(() => screen.getByTestId('settings-tab-appearance'));
    fireEvent.click(screen.getByTestId('settings-tab-appearance'));
    fireEvent.click(screen.getByTestId('theme-btn-light'));
    expect(screen.getByTestId('theme-btn-light').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() =>
      expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ theme: 'light' }),
    );
  });

  describe('Terminal section', () => {
    const choices = {
      platform: 'win32',
      externalTerminals: [
        { id: 'windows-terminal', label: 'Windows Terminal', detail: 'wt.exe' },
        { id: 'cmd', label: 'Command Prompt', detail: 'cmd.exe' },
      ],
      shells: [
        { id: 'pwsh', label: 'PowerShell 7', detail: 'C:\\pwsh.exe' },
        { id: 'git-bash', label: 'Git Bash', detail: 'C:\\bash.exe' },
      ],
      autoExternalTerminal: 'Windows Terminal',
      autoShell: 'PowerShell 7',
    };

    beforeEach(() => {
      mockElectronAPI.getTerminalChoices = vi.fn().mockResolvedValue(choices);
    });

    it('is hidden when terminal choices are unavailable', async () => {
      delete mockElectronAPI.getTerminalChoices;
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-appearance'));
      expect(screen.queryByTestId('settings-tab-terminal')).toBeNull();
      expect(screen.queryByTestId('settings-terminal-section')).toBeNull();
    });

    it('lists automatic, detected, and custom options with the automatic target named', async () => {
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-terminal'));
      fireEvent.click(screen.getByTestId('settings-tab-terminal'));
      const shell = (await screen.findByTestId('settings-integrated-shell')) as HTMLSelectElement;
      expect(Array.from(shell.options).map(o => o.textContent)).toEqual([
        'Automatic (PowerShell 7)',
        'PowerShell 7',
        'Git Bash',
        'Custom…',
      ]);
      expect(shell.value).toBe('');
      const external = screen.getByTestId('settings-external-terminal') as HTMLSelectElement;
      expect(external.options[0].textContent).toBe('Automatic (Windows Terminal)');
    });

    it('reflects stored preferences, including custom values', async () => {
      mockElectronAPI.loadSettings.mockResolvedValue({
        sessionDir: null,
        integratedShell: 'git-bash',
        externalTerminal: 'C:\\Tools\\term.exe',
      });
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-terminal'));
      fireEvent.click(screen.getByTestId('settings-tab-terminal'));
      const shell = (await screen.findByTestId('settings-integrated-shell')) as HTMLSelectElement;
      expect(shell.value).toBe('git-bash');
      expect((screen.getByTestId('settings-external-terminal') as HTMLSelectElement).value).toBe('__custom__');
      expect((screen.getByTestId('settings-external-terminal-custom') as HTMLInputElement).value).toBe('C:\\Tools\\term.exe');
    });

    it('saves a detected choice or automatic immediately', async () => {
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-terminal'));
      fireEvent.click(screen.getByTestId('settings-tab-terminal'));
      const shell = await screen.findByTestId('settings-integrated-shell');
      fireEvent.change(shell, { target: { value: 'git-bash' } });
      await waitFor(() => expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ integratedShell: 'git-bash' }));

      fireEvent.change(shell, { target: { value: '' } });
      await waitFor(() => expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ integratedShell: null }));

      fireEvent.change(screen.getByTestId('settings-external-terminal'), { target: { value: 'cmd' } });
      await waitFor(() => expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ externalTerminal: 'cmd' }));
    });

    it('saves a custom path on blur or Enter, but not before one is typed', async () => {
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-terminal'));
      fireEvent.click(screen.getByTestId('settings-tab-terminal'));
      const shell = await screen.findByTestId('settings-integrated-shell');
      fireEvent.change(shell, { target: { value: '__custom__' } });
      expect(mockElectronAPI.saveSettings).not.toHaveBeenCalled();

      const input = screen.getByTestId('settings-integrated-shell-custom');
      fireEvent.change(input, { target: { value: '  C:\\msys64\\usr\\bin\\bash.exe  ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ integratedShell: 'C:\\msys64\\usr\\bin\\bash.exe' }),
      );

      fireEvent.blur(input);
      expect(mockElectronAPI.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('lists console (fixed-width) fonts and saves the selected terminal font', async () => {
      mockElectronAPI.loadSettings.mockResolvedValue({
        sessionDir: null,
        terminalFont: 'MesloLGS NF',
      });
      renderModal(true);
      await waitFor(() => screen.getByTestId('settings-tab-terminal'));
      fireEvent.click(screen.getByTestId('settings-tab-terminal'));

      const fontSelect = (await screen.findByTestId('settings-terminal-font')) as HTMLSelectElement;
      expect(fontSelect.value).toBe('MesloLGS NF');
      expect(fontSelect.options[0].textContent).toBe('Default');
      expect(Array.from(fontSelect.options).map(o => o.value)).toContain('Consolas');

      fireEvent.change(fontSelect, { target: { value: 'Consolas' } });
      await waitFor(() =>
        expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ terminalFont: 'Consolas' }),
      );

      fireEvent.change(fontSelect, { target: { value: '' } });
      await waitFor(() =>
        expect(mockElectronAPI.saveSettings).toHaveBeenCalledWith({ terminalFont: null }),
      );
    });
  });
});
