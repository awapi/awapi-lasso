import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.1' },
  dialog: {
    showMessageBox: vi.fn(),
    showErrorBox: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

import { BrowserWindow, dialog, shell } from 'electron';
import { showAboutDialog } from './about';

describe('showAboutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    vi.mocked(shell.openExternal).mockResolvedValue();
  });

  it('shows app and runtime information without requiring a parent window', async () => {
    await showAboutDialog();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'About AwapiLasso',
      message: 'AwapiLasso',
      detail: expect.stringContaining('Version: 0.1.1'),
      buttons: ['OK', 'Open Repo', 'Open Profile'],
      cancelId: 0,
    }));
    const options = vi.mocked(dialog.showMessageBox).mock.calls[0][0];
    expect(options).toMatchObject({
      detail: expect.stringContaining(`Platform: ${process.platform} ${process.arch}`),
    });
    expect(options).toMatchObject({ detail: expect.stringContaining('Electron:') });
    expect(options).toMatchObject({ detail: expect.stringContaining('Chrome:') });
    expect(options).toMatchObject({ detail: expect.stringContaining('Node.js:') });
    expect(options).toMatchObject({ detail: expect.stringContaining('Maintainer: Omer Yesil') });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('parents the dialog to the supplied window', async () => {
    const parent = new BrowserWindow();
    await showAboutDialog(parent);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(parent, expect.any(Object));
  });

  it.each([
    [1, 'https://github.com/awapi/awapi-lasso'],
    [2, 'https://github.com/omeryesil'],
  ])('opens the selected link for response %i', async (response, url) => {
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response, checkboxChecked: false });
    await showAboutDialog();
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('reports browser launch failures', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('No browser'));
    await showAboutDialog();
    expect(log).toHaveBeenCalled();
    expect(dialog.showErrorBox).toHaveBeenCalledWith('Unable to open link', expect.any(String));
    log.mockRestore();
  });
});
