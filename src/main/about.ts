import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';

export async function showAboutDialog(parentWindow: BrowserWindow | null = null): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'info',
    title: 'About AwapiLasso',
    message: 'AwapiLasso',
    detail: [
      `Version: ${app.getVersion()}`,
      `Electron: ${process.versions.electron}`,
      `Chrome: ${process.versions.chrome}`,
      `Node.js: ${process.versions.node}`,
      `Platform: ${process.platform} ${process.arch}`,
      '',
      'A fast, lightweight, cross-platform HTTP, RESTful, and GraphQL client.',
      'github.com/awapi/awapi-lasso',
      '',
      'Maintainer: Omer Yesil',
      'github.com/omeryesil',
    ].join('\n'),
    buttons: ['OK', 'Open Repo', 'Open Profile'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const { response } = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  const url = response === 1
    ? 'https://github.com/awapi/awapi-lasso'
    : response === 2 ? 'https://github.com/omeryesil' : null;
  if (url) {
    try {
      await shell.openExternal(url);
    } catch (error) {
      console.error('Unable to open About link:', error);
      dialog.showErrorBox('Unable to open link', 'Could not open your browser. Please try again.');
    }
  }
}
