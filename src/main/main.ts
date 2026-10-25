import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  nativeImage,
  clipboard,
  Menu,
  safeStorage,
  type MenuItemConstructorOptions,
} from 'electron';

// Set app name and AppUserModelId BEFORE any imports that use app.getPath()
app.name = 'AwapiLasso';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.awapi.awapilasso');
}

import * as path from 'path';
import { join } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import type { AwjcCollection } from '../shared/collectionSchema';
import { importOpenApiSpec } from '../shared/openapiImporter';
import { checkForUpdates } from './updater';
import {
  COLLECTION_OPENED_FROM_OS_CHANNEL,
  isCollectionFilePath,
  extractCollectionPathsFromArgv,
  createOsFileQueue,
  ensureWindow,
  sendWhenLoaded,
  type OsFileArgDeps,
} from './osFileAssociation';
import {
  getContextMenuStatus,
  setContextMenuEnabled,
  type ContextMenuDeps,
} from './contextMenu';
import {
  getCliCommandStatus,
  setCliCommandEnabled,
  type CliCommandDeps,
} from './cliCommand';
import {
  loadAppSettings,
  saveAppSettings,
  getRecentFiles,
  addRecentFile,
  clearRecentFiles,
  removeRecentFile,
  getLastOpenDirectory,
  setLastOpenDirectoryFromFile,
  saveSession,
  loadSession,
  type AppSettings,
  type SessionState,
} from './session';
import {
  setSecret,
  getSecret,
  deleteSecret,
  getAllCollectionSecrets,
  type SecretCoordinate,
  type SecretStoreDeps,
} from './secretStore';
import {
  openCollectionFromFile,
  saveCollectionToFile,
  CollectionWatcherRegistry,
  type CollectionFileServiceDeps,
  type OpenedCollectionPayload,
} from './collectionFileService';
import {
  executeHttpRequest,
  cancelHttpRequest,
  type HttpEngineDeps,
} from './httpEngine';
import {
  acquireOAuth2Token,
  refreshOAuth2Token,
  getCachedOAuth2Token,
  clearCachedOAuth2Token,
  type OAuth2EngineDeps,
} from './oauth2Engine';
import type { PreparedHttpRequest } from '../shared/httpTypes';
import type {
  OAuth2GetTokenRequest,
  OAuth2RefreshTokenRequest,
  OAuth2TokenCoordinate,
} from '../shared/oauth2Types';
import {
  getCachedGraphQLSchema,
  introspectRemoteGraphQLSchema,
  loadLocalGraphQLSchemaFile,
  type GraphQLIntrospectRequest,
  type GraphQLLoadLocalSchemaRequest,
  type GraphQLSchemaCacheCoordinate,
} from './graphqlIntrospection';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let isAppReady = false;

function osFileArgDeps(): OsFileArgDeps {
  return {
    platform: process.platform,
    isFile: (p: string) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
  };
}

const osFileQueue = createOsFileQueue<BrowserWindow>({
  isAppReady: () => isAppReady,
  getMainWindow: () => mainWindow,
  createMainWindow: () => {
    createWindow();
    return mainWindow!;
  },
  onFileDelivered: (filePath: string) => {
    addRecentFile(filePath);
    rebuildAppMenu();
  },
  channel: COLLECTION_OPENED_FROM_OS_CHANNEL,
});

// Capture cold-start .awjc / .awj arguments passed on initial launch
const initialCollectionPaths = extractCollectionPathsFromArgv(
  process.argv,
  isDev,
  process.cwd(),
  osFileArgDeps(),
);
if (initialCollectionPaths.length > 0) {
  osFileQueue.enqueue(initialCollectionPaths);
} else if (isDev) {
  const existingSettings = loadAppSettings();
  const existingSession = loadSession();
  const hasRestorableSession =
    (existingSettings.openCollectionPaths &&
      existingSettings.openCollectionPaths.length > 0) ||
    (existingSession !== null &&
      ((existingSession.openCollectionPaths &&
        existingSession.openCollectionPaths.length > 0) ||
        existingSession.tabs.length > 0));

  if (!hasRestorableSession) {
    const defaultSampleCollections = [
      join(process.cwd(), 'samples', 'orders-and-inventory.awjc'),
      join(process.cwd(), 'samples', 'public-apis.awjc'),
    ].filter(p => fs.existsSync(p));
    if (defaultSampleCollections.length > 0) {
      osFileQueue.enqueue(defaultSampleCollections);
    }
  }
}

function seedDefaultDevCollectionSecrets(): void {
  if (!isDev) return;
  try {
    const secretDeps = buildSecretStoreDeps();
    const collectionId = 'col_orders_platform_01';
    const scopeId = 'env:env_local';
    if (!getSecret({ collectionId, scopeId, key: 'clientSecret' }, secretDeps)) {
      setSecret(
        { collectionId, scopeId, key: 'clientSecret' },
        'local-dev-secret',
        secretDeps,
      );
    }
    if (!getSecret({ collectionId, scopeId, key: 'apiPassword' }, secretDeps)) {
      setSecret(
        { collectionId, scopeId, key: 'apiPassword' },
        'local-admin-pass',
        secretDeps,
      );
    }
  } catch {
    // ignore in restricted environments
  }
}

// macOS Finder double-click or drag-and-drop onto app icon
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (isCollectionFilePath(filePath)) {
    osFileQueue.enqueue(filePath);
  }
});

// Single-instance lock so double-clicking .awjc/.awj focuses the existing window
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const openedPaths = extractCollectionPathsFromArgv(
      commandLine,
      isDev,
      workingDirectory || process.cwd(),
      osFileArgDeps(),
    );
    osFileQueue.enqueue(openedPaths);
  });
}

function createWindow(): void {
  const settings = loadAppSettings();
  const isLight = settings.theme === 'light';
  nativeTheme.themeSource = isLight ? 'light' : 'dark';

  // Window icon: used on Windows/Linux title bars, taskbars, and Alt-Tab switcher.
  // macOS uses the icon embedded in the .app bundle (or app.dock.setIcon in dev).
  const winIcon = join(
    __dirname,
    '../../build',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'AwapiLasso',
    icon: winIcon,
    backgroundColor: isLight ? '#f8fafc' : '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildContextMenuDeps(): ContextMenuDeps {
  return {
    platform: process.platform,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    iconPath: join(__dirname, '../../build/icon.ico'),
    appEntryPath: join(__dirname, 'main.js'),
    runReg: (args: string[]) =>
      new Promise(resolve => {
        const child = spawn('reg.exe', args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', d => {
          stdout += String(d);
        });
        child.stderr?.on('data', d => {
          stderr += String(d);
        });
        child.on('error', err => {
          resolve({ code: 1, stdout, stderr: err.message });
        });
        child.on('close', code => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      }),
  };
}

function buildCliCommandDeps(): CliCommandDeps {
  return {
    platform: process.platform,
    env: process.env,
    homeDir: os.homedir(),
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    appEntryPath: join(__dirname, 'main.js'),
    exists: (p: string) => fs.existsSync(p),
    mkdir: (p: string) => fs.mkdirSync(p, { recursive: true }),
    writeFile: (p: string, content: string, mode?: number) => {
      fs.writeFileSync(p, content, { encoding: 'utf-8', ...(mode ? { mode } : {}) });
      if (mode && process.platform !== 'win32') {
        fs.chmodSync(p, mode);
      }
    },
    unlink: (p: string) => fs.unlinkSync(p),
  };
}

function rebuildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const recentFiles = getRecentFiles();

  const recentSubmenu: MenuItemConstructorOptions[] =
    recentFiles.length > 0
      ? [
          ...recentFiles.map(fp => ({
            label: fp,
            click: () => {
              osFileQueue.enqueue(fp);
            },
          })),
          { type: 'separator' as const },
          {
            label: 'Clear Recent Collections',
            click: () => {
              clearRecentFiles();
              rebuildAppMenu();
            },
          },
        ]
      : [{ label: 'No Recent Collections', enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates…',
                click: () => {
                  void checkForUpdates({ notifyIfUpToDate: true, parentWindow: mainWindow });
                },
              },
              { type: 'separator' as const },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  const win = ensureWindow(mainWindow, () => {
                    createWindow();
                    return mainWindow!;
                  });
                  sendWhenLoaded(win, 'menu:openSettings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Collection',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            const win = ensureWindow(mainWindow, () => {
              createWindow();
              return mainWindow!;
            });
            sendWhenLoaded(win, 'menu:newCollection');
          },
        },
        {
          label: 'Open Collection…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = ensureWindow(mainWindow, () => {
              createWindow();
              return mainWindow!;
            });
            sendWhenLoaded(win, 'menu:openCollection');
          },
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: 'Import',
          submenu: [
            {
              label: 'Import from OpenAPI / Swagger…',
              click: () => {
                const win = ensureWindow(mainWindow, () => {
                  createWindow();
                  return mainWindow!;
                });
                sendWhenLoaded(win, 'menu:importOpenApi');
              },
            },
            {
              label: 'Import from cURL…',
              click: () => {
                const win = ensureWindow(mainWindow, () => {
                  createWindow();
                  return mainWindow!;
                });
                sendWhenLoaded(win, 'menu:importCurl');
              },
            },
            { type: 'separator' },
            {
              label: 'Import from Bruno (Coming Soon)',
              enabled: false,
            },
            {
              label: 'Import from Postman (Coming Soon)',
              enabled: false,
            },
          ],
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              sendWhenLoaded(mainWindow, 'menu:saveCollection');
            }
          },
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              sendWhenLoaded(mainWindow, 'menu:saveCollectionAs');
            }
          },
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  const win = ensureWindow(mainWindow, () => {
                    createWindow();
                    return mainWindow!;
                  });
                  sendWhenLoaded(win, 'menu:openSettings');
                },
              },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ]
          : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'AwapiLasso on GitHub',
          click: () => {
            void shell.openExternal('https://github.com/awapi/awapi-lasso');
          },
        },
        ...(!isMac
          ? [
              {
                label: 'Check for Updates…',
                click: () => {
                  void checkForUpdates({ notifyIfUpToDate: true, parentWindow: mainWindow });
                },
              },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function buildSecretStoreDeps(): SecretStoreDeps {
  return {
    userDataDir: app.getPath('userData'),
    isEncryptionAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    encryptString: (plain: string) => safeStorage.encryptString(plain),
    decryptString: (buf: Buffer) => safeStorage.decryptString(buf),
    exists: (p: string) => fs.existsSync(p),
    readFile: (p: string) => fs.readFileSync(p, 'utf-8'),
    writeFile: (p: string, content: string) => fs.writeFileSync(p, content, 'utf-8'),
    mkdir: (p: string) => fs.mkdirSync(p, { recursive: true }),
  };
}

function buildCollectionFileServiceDeps(): CollectionFileServiceDeps {
  const secretDeps = buildSecretStoreDeps();
  return {
    secretDeps,
    readFile: secretDeps.readFile,
    writeFile: secretDeps.writeFile,
    exists: secretDeps.exists,
    onRecentFileAdded: (filePath: string) => {
      addRecentFile(filePath);
      rebuildAppMenu();
    },
  };
}

function buildOAuth2EngineDeps(): OAuth2EngineDeps {
  return {
    secretDeps: buildSecretStoreDeps(),
    openExternalUrl: async (url: string) => {
      await shell.openExternal(url);
    },
  };
}

function buildHttpEngineDeps(): HttpEngineDeps {
  const resolveLocalPath = (p: string) =>
    path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  return {
    readFileBuffer: (p: string) => fs.readFileSync(resolveLocalPath(p)),
    fileExists: (p: string) => fs.existsSync(resolveLocalPath(p)),
    oauth2Deps: buildOAuth2EngineDeps(),
  };
}

const collectionWatchers = new CollectionWatcherRegistry();

function registerIpcHandlers(): void {
  ipcMain.handle('settings:load', () => loadAppSettings());
  ipcMain.handle('settings:save', (_event, partial: Partial<AppSettings>) => {
    const updated = saveAppSettings(partial);
    if (partial.theme) {
      nativeTheme.themeSource = partial.theme === 'light' ? 'light' : 'dark';
    }
    return updated;
  });

  ipcMain.handle('settings:getRecentFiles', () => getRecentFiles());
  ipcMain.handle('settings:addRecentFile', (_event, filePath: string) => {
    const updated = addRecentFile(filePath);
    rebuildAppMenu();
    return updated;
  });
  ipcMain.handle('settings:removeRecentFile', (_event, filePath: string) => {
    const updated = removeRecentFile(filePath);
    rebuildAppMenu();
    return updated;
  });
  ipcMain.handle('settings:clearRecentFiles', () => {
    clearRecentFiles();
    rebuildAppMenu();
  });

  ipcMain.handle('session:save', (_event, session: SessionState) => saveSession(session));
  ipcMain.handle('session:load', () => loadSession());

  ipcMain.handle('contextMenu:getStatus', () => getContextMenuStatus(buildContextMenuDeps()));
  ipcMain.handle('contextMenu:setEnabled', (_event, enable: boolean) =>
    setContextMenuEnabled(enable, buildContextMenuDeps()),
  );

  ipcMain.handle('cliCommand:getStatus', () => getCliCommandStatus(buildCliCommandDeps()));
  ipcMain.handle('cliCommand:setEnabled', (_event, enable: boolean) =>
    setCliCommandEnabled(enable, buildCliCommandDeps()),
  );

  ipcMain.handle('dialog:openCollectionFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Open AwapiLasso Collection',
      defaultPath: getLastOpenDirectory(),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'AwapiLasso Collections (*.awjc, *.awj)', extensions: ['awjc', 'awj'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    for (const fp of result.filePaths) {
      addRecentFile(fp);
    }
    setLastOpenDirectoryFromFile(result.filePaths[0]);
    rebuildAppMenu();
    return result.filePaths;
  });

  ipcMain.handle('collection:openDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Open AwapiLasso Collection',
      defaultPath: getLastOpenDirectory(),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'AwapiLasso Collections (*.awjc, *.awj)', extensions: ['awjc', 'awj'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    setLastOpenDirectoryFromFile(result.filePaths[0]);

    const serviceDeps = buildCollectionFileServiceDeps();
    const opened: OpenedCollectionPayload[] = [];
    for (const fp of result.filePaths) {
      try {
        opened.push(openCollectionFromFile(fp, serviceDeps));
      } catch (err) {
        await dialog.showMessageBox(mainWindow ?? undefined!, {
          type: 'error',
          message: `Failed to open collection "${fp}"`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return opened.length > 0 ? opened : null;
  });

  ipcMain.handle('collection:openPath', (_event, filePath: string) => {
    const serviceDeps = buildCollectionFileServiceDeps();
    return openCollectionFromFile(filePath, serviceDeps);
  });

  ipcMain.handle('collection:importOpenApiDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Import OpenAPI 3.x / Swagger 2.0 Specification',
      defaultPath: getLastOpenDirectory(),
      properties: ['openFile'],
      filters: [
        {
          name: 'OpenAPI / Swagger (*.yaml, *.yml, *.json)',
          extensions: ['yaml', 'yml', 'json'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const specPath = result.filePaths[0];
    setLastOpenDirectoryFromFile(specPath);
    const rawContent = fs.readFileSync(specPath, 'utf-8');
    const collection = importOpenApiSpec(rawContent);
    return {
      sourcePath: specPath,
      collection,
    };
  });

  ipcMain.handle(
    'collection:save',
    (
      _event,
      options: { filePath: string; collection: AwjcCollection; format?: 'yaml' | 'json' },
    ) => {
      collectionWatchers.markSelfSaved(options.filePath);
      return saveCollectionToFile(options, buildCollectionFileServiceDeps());
    },
  );

  ipcMain.handle(
    'collection:saveAs',
    async (
      _event,
      options: {
        defaultPath?: string;
        collection: AwjcCollection;
        format?: 'yaml' | 'json';
      },
    ) => {
      const defaultFileName = `${options.collection.metadata.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase() || 'collection'}.awjc`;
      const lastDir = getLastOpenDirectory();
      const computedDefaultPath =
        options.defaultPath && path.isAbsolute(options.defaultPath)
          ? options.defaultPath
          : lastDir
            ? join(lastDir, options.defaultPath || defaultFileName)
            : options.defaultPath || defaultFileName;

      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save AwapiLasso Collection',
        defaultPath: computedDefaultPath,
        filters: [
          { name: 'AwapiLasso Collection (*.awjc)', extensions: ['awjc'] },
          { name: 'AwapiLasso Collection Alias (*.awj)', extensions: ['awj'] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      setLastOpenDirectoryFromFile(result.filePath);
      collectionWatchers.markSelfSaved(result.filePath);
      return saveCollectionToFile(
        {
          filePath: result.filePath,
          collection: options.collection,
          format: options.format,
        },
        buildCollectionFileServiceDeps(),
      );
    },
  );

  ipcMain.handle('collection:watchPaths', (_event, filePaths: string[]) => {
    collectionWatchers.syncWatchedPaths(
      filePaths,
      (fp, onChange) => {
        try {
          const fsWatcher = fs.watch(fp, { persistent: false }, eventType => {
            if (eventType === 'change' || eventType === 'rename') {
              onChange(fp);
            }
          });
          return { close: () => fsWatcher.close() };
        } catch {
          return { close: () => {} };
        }
      },
      changedPath => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            const payload = openCollectionFromFile(changedPath, buildCollectionFileServiceDeps());
            sendWhenLoaded(mainWindow, 'collection:externalChange', payload);
          } catch {
            // ignore transient partial write
          }
        }
      },
    );
  });

  ipcMain.handle(
    'secrets:get',
    (_event, coord: SecretCoordinate, options?: { collectionFilePath?: string }) =>
      getSecret(coord, buildSecretStoreDeps(), options),
  );
  ipcMain.handle('secrets:set', (_event, coord: SecretCoordinate, value: string) => {
    setSecret(coord, value, buildSecretStoreDeps());
    return true;
  });
  ipcMain.handle('secrets:delete', (_event, coord: SecretCoordinate) =>
    deleteSecret(coord, buildSecretStoreDeps()),
  );
  ipcMain.handle(
    'secrets:getAllForCollection',
    (_event, collectionId: string, options?: { collectionFilePath?: string }) =>
      getAllCollectionSecrets(collectionId, buildSecretStoreDeps(), options),
  );

  ipcMain.handle('http:send', (_event, request: PreparedHttpRequest) =>
    executeHttpRequest(request, buildHttpEngineDeps()),
  );
  ipcMain.handle('http:cancel', (_event, requestId: string) =>
    cancelHttpRequest(requestId),
  );

  ipcMain.handle('oauth2:getToken', (_event, request: OAuth2GetTokenRequest) =>
    acquireOAuth2Token(request, buildOAuth2EngineDeps()),
  );
  ipcMain.handle('oauth2:refreshToken', (_event, request: OAuth2RefreshTokenRequest) =>
    refreshOAuth2Token(request, buildOAuth2EngineDeps()),
  );
  ipcMain.handle('oauth2:getCachedToken', (_event, coord: OAuth2TokenCoordinate) =>
    getCachedOAuth2Token(coord, buildOAuth2EngineDeps()),
  );
  ipcMain.handle('oauth2:clearToken', (_event, coord: OAuth2TokenCoordinate) =>
    clearCachedOAuth2Token(coord, buildOAuth2EngineDeps()),
  );

  ipcMain.handle('graphql:introspect', (_event, payload: GraphQLIntrospectRequest) =>
    introspectRemoteGraphQLSchema(payload, { httpDeps: buildHttpEngineDeps() }),
  );
  ipcMain.handle(
    'graphql:loadLocalSchema',
    (_event, payload: GraphQLLoadLocalSchemaRequest) =>
      loadLocalGraphQLSchemaFile(payload),
  );
  ipcMain.handle(
    'graphql:getCachedSchema',
    (_event, coord: GraphQLSchemaCacheCoordinate) => getCachedGraphQLSchema(coord),
  );
  ipcMain.handle('graphql:openSchemaFileDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Load GraphQL Schema (SDL or Introspection JSON)',
      defaultPath: getLastOpenDirectory(),
      properties: ['openFile'],
      filters: [
        {
          name: 'GraphQL Schema (*.graphql, *.gql, *.json)',
          extensions: ['graphql', 'gql', 'json'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    setLastOpenDirectoryFromFile(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ipcMain.handle('updater:check', () =>
    checkForUpdates({ notifyIfUpToDate: true, parentWindow: mainWindow }),
  );
}

if (gotSingleInstanceLock) {
  void app.whenReady().then(() => {
    isAppReady = true;

    // In dev on macOS, the bundle icon is Electron's default. Override the
    // dock icon so the app shows our brand while running `pnpm dev`.
    if (process.platform === 'darwin' && isDev && app.dock) {
      const dockImg = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'));
      if (!dockImg.isEmpty()) {
        app.dock.setIcon(dockImg);
      }
    }

    seedDefaultDevCollectionSecrets();
    registerIpcHandlers();
    rebuildAppMenu();
    createWindow();
    osFileQueue.flush();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
