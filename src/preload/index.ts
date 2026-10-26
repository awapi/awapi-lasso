import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AwjcCollection } from '../shared/collectionSchema';
import type { AppSettings, SessionState } from '../main/session';
import type { ContextMenuStatus, ContextMenuUpdateResult } from '../main/contextMenu';
import type { CliCommandStatus, CliCommandUpdateResult } from '../main/cliCommand';
import type { SecretCoordinate } from '../main/secretStore';
import type { OpenedCollectionPayload } from '../main/collectionFileService';
import type { HttpResponseResult, PreparedHttpRequest } from '../shared/httpTypes';
import type {
  OAuth2GetTokenRequest,
  OAuth2RefreshTokenRequest,
  OAuth2TokenCoordinate,
  OAuth2TokenExchangeResult,
  OAuth2TokenRecord,
} from '../shared/oauth2Types';
import type {
  GraphQLCachedSchemaRecord,
  GraphQLIntrospectRequest,
  GraphQLLoadLocalSchemaRequest,
  GraphQLSchemaCacheCoordinate,
  GraphQLSchemaDiscoveryResult,
} from '../main/graphqlIntrospection';
import type {
  GitCheckoutBranchRequest,
  GitCollectionStatus,
  GitCommitEntry,
  GitCommitRequest,
  GitDiffPayload,
  GitDiffRequest,
  GitLogRequest,
  GitOperationResult,
  GitRevertRequest,
} from '../shared/gitTypes';
import type {
  PtyCreateOptions,
  PtyCreateResult,
  PtyDataEvent,
  PtyExitEvent,
  TerminalChoices,
} from '../shared/terminal';
import { COLLECTION_OPENED_FROM_OS_CHANNEL } from '../main/osFileAssociation';

export const electronAPI = {
  /** Opens a native dialog to pick one or more `.awjc` / `.awj` collection files (returns paths). */
  openCollectionDialog: () =>
    ipcRenderer.invoke('dialog:openCollectionFile') as Promise<string[] | null>,

  /** Opens a native dialog and parses/hydrates selected `.awjc` / `.awj` collections. */
  openCollectionsWithDialog: () =>
    ipcRenderer.invoke('collection:openDialog') as Promise<OpenedCollectionPayload[] | null>,

  /** Reads, parses, and hydrates a `.awjc` / `.awj` collection from a specific disk path. */
  openCollectionFromPath: (filePath: string) =>
    ipcRenderer.invoke('collection:openPath', filePath) as Promise<OpenedCollectionPayload>,

  /** Opens a native dialog to pick an OpenAPI 3.x / Swagger 2.0 YAML/JSON file and imports it as a collection. */
  importOpenApiWithDialog: () =>
    ipcRenderer.invoke('collection:importOpenApiDialog') as Promise<{
      sourcePath: string;
      collection: AwjcCollection;
    } | null>,

  /** Saves a collection to `filePath` (stripping `secret: true` values into OS Keychain). */
  saveCollection: (options: { filePath: string; collection: AwjcCollection }) =>
    ipcRenderer.invoke('collection:save', options) as Promise<{
      filePath: string;
      serialized: string;
    } | null>,

  /** Prompts for a file location and saves the `.awjc` / `.awj` collection. */
  saveCollectionAs: (options: { defaultPath?: string; collection: AwjcCollection }) =>
    ipcRenderer.invoke('collection:saveAs', options) as Promise<{
      filePath: string;
      serialized: string;
    } | null>,

  /** Synchronizes the list of open `.awjc` / `.awj` file paths being watched for external edits. */
  watchCollectionPaths: (filePaths: string[]) =>
    ipcRenderer.invoke('collection:watchPaths', filePaths) as Promise<void>,

  /** Subscribes to external file modifications on watched `.awjc` / `.awj` files. */
  onCollectionExternalChange: (callback: (payload: OpenedCollectionPayload) => void) => {
    const listener = (_: unknown, payload: OpenedCollectionPayload) => callback(payload);
    ipcRenderer.on('collection:externalChange', listener);
    return () => {
      ipcRenderer.removeListener('collection:externalChange', listener);
    };
  },

  /** OS Keychain (`safeStorage`) & local sidecar secret operations. */
  getSecret: (coord: SecretCoordinate, options?: { collectionFilePath?: string }) =>
    ipcRenderer.invoke('secrets:get', coord, options) as Promise<string | null>,
  setSecret: (coord: SecretCoordinate, value: string) =>
    ipcRenderer.invoke('secrets:set', coord, value) as Promise<boolean>,
  deleteSecret: (coord: SecretCoordinate) =>
    ipcRenderer.invoke('secrets:delete', coord) as Promise<boolean>,
  getAllCollectionSecrets: (
    collectionId: string,
    options?: { collectionFilePath?: string },
  ) =>
    ipcRenderer.invoke('secrets:getAllForCollection', collectionId, options) as Promise<{
      byScope: Record<string, Record<string, string>>;
      flatByKey: Record<string, string>;
    }>,

  /** Outbound Main-process HTTP/HTTPS/GraphQL execution & in-flight cancellation. */
  sendHttpRequest: (request: PreparedHttpRequest) =>
    ipcRenderer.invoke('http:send', request) as Promise<HttpResponseResult>,
  cancelHttpRequest: (requestId: string) =>
    ipcRenderer.invoke('http:cancel', requestId) as Promise<boolean>,

  /** OAuth 2.0 Token Manager operations (acquire, refresh, inspect cached, clear). */
  getOAuth2Token: (request: OAuth2GetTokenRequest) =>
    ipcRenderer.invoke('oauth2:getToken', request) as Promise<OAuth2TokenExchangeResult>,
  refreshOAuth2Token: (request: OAuth2RefreshTokenRequest) =>
    ipcRenderer.invoke('oauth2:refreshToken', request) as Promise<OAuth2TokenExchangeResult>,
  getCachedOAuth2Token: (coord: OAuth2TokenCoordinate) =>
    ipcRenderer.invoke('oauth2:getCachedToken', coord) as Promise<OAuth2TokenRecord | null>,
  clearOAuth2Token: (coord: OAuth2TokenCoordinate) =>
    ipcRenderer.invoke('oauth2:clearToken', coord) as Promise<boolean>,

  /** GraphQL schema introspection, offline SDL/JSON import, and per-environment cache lookup. */
  introspectGraphQLSchema: (payload: GraphQLIntrospectRequest) =>
    ipcRenderer.invoke('graphql:introspect', payload) as Promise<GraphQLSchemaDiscoveryResult>,
  loadLocalGraphQLSchema: (payload: GraphQLLoadLocalSchemaRequest) =>
    ipcRenderer.invoke(
      'graphql:loadLocalSchema',
      payload,
    ) as Promise<GraphQLSchemaDiscoveryResult>,
  getCachedGraphQLSchema: (coord: GraphQLSchemaCacheCoordinate) =>
    ipcRenderer.invoke(
      'graphql:getCachedSchema',
      coord,
    ) as Promise<GraphQLCachedSchemaRecord | null>,
  openGraphQLSchemaFileDialog: () =>
    ipcRenderer.invoke('graphql:openSchemaFileDialog') as Promise<string | null>,

  /** Subscribes to `.awjc` / `.awj` collection file paths opened from OS Finder/Explorer or CLI (`awlasso`). */
  onCollectionOpenedFromOs: (callback: (filePath: string) => void) => {
    const listener = (_: unknown, filePath: string) => callback(filePath);
    ipcRenderer.on(COLLECTION_OPENED_FROM_OS_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(COLLECTION_OPENED_FROM_OS_CHANNEL, listener);
    };
  },

  /** Resolves the filesystem path for a dropped `File` object. */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  /** Loads user preferences (theme, SSL verification default, request timeout, recent files). */
  loadSettings: () => ipcRenderer.invoke('settings:load') as Promise<AppSettings>,
  /** Saves partial user preferences and returns the merged settings. */
  saveSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>,

  getRecentFiles: () => ipcRenderer.invoke('settings:getRecentFiles') as Promise<string[]>,
  addRecentFile: (filePath: string) =>
    ipcRenderer.invoke('settings:addRecentFile', filePath) as Promise<string[]>,
  removeRecentFile: (filePath: string) =>
    ipcRenderer.invoke('settings:removeRecentFile', filePath) as Promise<string[]>,
  clearRecentFiles: () => ipcRenderer.invoke('settings:clearRecentFiles') as Promise<void>,

  saveSession: (session: SessionState) =>
    ipcRenderer.invoke('session:save', session) as Promise<boolean>,
  loadSession: () => ipcRenderer.invoke('session:load') as Promise<SessionState | null>,

  /** Windows Explorer "Open with AwapiLasso" right-click context menu integration. */
  getContextMenuStatus: () =>
    ipcRenderer.invoke('contextMenu:getStatus') as Promise<ContextMenuStatus>,
  setContextMenuEnabled: (enable: boolean) =>
    ipcRenderer.invoke('contextMenu:setEnabled', enable) as Promise<ContextMenuUpdateResult>,

  /** `awlasso` terminal CLI launcher installation status & toggle. */
  getCliCommandStatus: () =>
    ipcRenderer.invoke('cliCommand:getStatus') as Promise<CliCommandStatus>,
  setCliCommandEnabled: (enable: boolean) =>
    ipcRenderer.invoke('cliCommand:setEnabled', enable) as Promise<CliCommandUpdateResult>,

  copyToClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText') as Promise<string>,

  checkForUpdates: () => ipcRenderer.invoke('updater:check') as Promise<void>,

  /** Per-collection Git integration (using the collection's parent folder as cwd). */
  getGitStatus: (collectionFilePath: string) =>
    ipcRenderer.invoke('git:getStatus', collectionFilePath) as Promise<GitCollectionStatus>,
  initGitRepo: (collectionFilePath: string) =>
    ipcRenderer.invoke('git:initRepo', collectionFilePath) as Promise<GitOperationResult>,
  ensureGitignore: (collectionFilePath: string) =>
    ipcRenderer.invoke('git:ensureGitignore', collectionFilePath) as Promise<GitOperationResult>,
  getGitDiff: (request: GitDiffRequest) =>
    ipcRenderer.invoke('git:getDiff', request) as Promise<GitDiffPayload>,
  getGitLog: (request: GitLogRequest) =>
    ipcRenderer.invoke('git:getLog', request) as Promise<GitCommitEntry[]>,
  checkoutGitBranch: (request: GitCheckoutBranchRequest) =>
    ipcRenderer.invoke('git:checkoutBranch', request) as Promise<GitOperationResult>,
  commitGitChanges: (request: GitCommitRequest) =>
    ipcRenderer.invoke('git:commit', request) as Promise<GitOperationResult>,
  pullGit: (collectionFilePath: string) =>
    ipcRenderer.invoke('git:pull', collectionFilePath) as Promise<GitOperationResult>,
  pushGit: (collectionFilePath: string) =>
    ipcRenderer.invoke('git:push', collectionFilePath) as Promise<GitOperationResult>,
  revertGitChanges: (request: GitRevertRequest) =>
    ipcRenderer.invoke('git:revert', request) as Promise<GitOperationResult>,

  /** Reveals `filePath` in OS Finder / Explorer. */
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke('file:showInFolder', filePath) as Promise<void>,

  /** Opens the configured external terminal in the folder containing `filePath` (null = home folder). */
  openInTerminal: (filePath: string | null) =>
    ipcRenderer.invoke('file:openInTerminal', filePath) as Promise<boolean>,

  /** Terminal apps and shells available on this machine (for Preferences). */
  getTerminalChoices: () =>
    ipcRenderer.invoke('terminal:getChoices') as Promise<TerminalChoices>,

  /** Integrated terminal: start a shell. `cwd` may be a file (its folder is used) or null (home). */
  ptyCreate: (options: PtyCreateOptions) =>
    ipcRenderer.invoke('pty:create', options) as Promise<PtyCreateResult>,
  ptyWrite: (id: number, data: string) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id: number, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id: number) => ipcRenderer.invoke('pty:kill', id) as Promise<void>,

  /** Subscribes to shell output for this window's sessions. Returns an unsubscribe function. */
  onPtyData: (callback: (event: PtyDataEvent) => void) => {
    const listener = (_: unknown, event: PtyDataEvent) => callback(event);
    ipcRenderer.on('pty:data', listener);
    return () => {
      ipcRenderer.removeListener('pty:data', listener);
    };
  },

  /** Subscribes to shell exits for this window's sessions. Returns an unsubscribe function. */
  onPtyExit: (callback: (event: PtyExitEvent) => void) => {
    const listener = (_: unknown, event: PtyExitEvent) => callback(event);
    ipcRenderer.on('pty:exit', listener);
    return () => {
      ipcRenderer.removeListener('pty:exit', listener);
    };
  },

  /** Application menu event subscriptions. */
  onMenuNewCollection: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:newCollection', listener);
    return () => {
      ipcRenderer.removeListener('menu:newCollection', listener);
    };
  },
  onMenuOpenCollection: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:openCollection', listener);
    return () => {
      ipcRenderer.removeListener('menu:openCollection', listener);
    };
  },
  onMenuSaveCollection: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:saveCollection', listener);
    return () => {
      ipcRenderer.removeListener('menu:saveCollection', listener);
    };
  },
  onMenuSaveCollectionAs: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:saveCollectionAs', listener);
    return () => {
      ipcRenderer.removeListener('menu:saveCollectionAs', listener);
    };
  },
  onMenuOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:openSettings', listener);
    return () => {
      ipcRenderer.removeListener('menu:openSettings', listener);
    };
  },
  onMenuImportCurl: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:importCurl', listener);
    return () => {
      ipcRenderer.removeListener('menu:importCurl', listener);
    };
  },
  onMenuImportOpenApi: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:importOpenApi', listener);
    return () => {
      ipcRenderer.removeListener('menu:importOpenApi', listener);
    };
  },
  onMenuToggleTerminal: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:toggleTerminal', listener);
    return () => {
      ipcRenderer.removeListener('menu:toggleTerminal', listener);
    };
  },
  onMenuNewTerminal: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:newTerminal', listener);
    return () => {
      ipcRenderer.removeListener('menu:newTerminal', listener);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
