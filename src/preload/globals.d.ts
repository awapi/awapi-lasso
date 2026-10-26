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

declare global {
  interface Window {
    electronAPI: {
      /** Opens a native dialog to pick one or more `.awjc` / `.awj` collection files (returns paths). */
      openCollectionDialog: () => Promise<string[] | null>;
      /** Opens a native dialog and parses/hydrates selected `.awjc` / `.awj` collections. */
      openCollectionsWithDialog: () => Promise<OpenedCollectionPayload[] | null>;
      /** Reads, parses, and hydrates a `.awjc` / `.awj` collection from a specific disk path. */
      openCollectionFromPath: (filePath: string) => Promise<OpenedCollectionPayload>;
      /** Opens a native dialog to pick an OpenAPI 3.x / Swagger 2.0 YAML/JSON file and imports it as a collection. */
      importOpenApiWithDialog: () => Promise<{
        sourcePath: string;
        collection: AwjcCollection;
      } | null>;
      /** Saves a collection to `filePath` (stripping `secret: true` values into OS Keychain). */
      saveCollection: (options: {
        filePath: string;
        collection: AwjcCollection;
      }) => Promise<{ filePath: string; serialized: string } | null>;
      /** Prompts for a file location and saves the `.awjc` / `.awj` collection. */
      saveCollectionAs: (options: {
        defaultPath?: string;
        collection: AwjcCollection;
      }) => Promise<{ filePath: string; serialized: string } | null>;
      /** Synchronizes the list of open `.awjc` / `.awj` file paths being watched for external edits. */
      watchCollectionPaths: (filePaths: string[]) => Promise<void>;
      /** Subscribes to external file modifications on watched `.awjc` / `.awj` files. */
      onCollectionExternalChange: (
        callback: (payload: OpenedCollectionPayload) => void,
      ) => () => void;

      /** OS Keychain (`safeStorage`) & local sidecar secret operations. */
      getSecret: (
        coord: SecretCoordinate,
        options?: { collectionFilePath?: string },
      ) => Promise<string | null>;
      setSecret: (coord: SecretCoordinate, value: string) => Promise<boolean>;
      deleteSecret: (coord: SecretCoordinate) => Promise<boolean>;
      getAllCollectionSecrets: (
        collectionId: string,
        options?: { collectionFilePath?: string },
      ) => Promise<{
        byScope: Record<string, Record<string, string>>;
        flatByKey: Record<string, string>;
      }>;

      /** Outbound Main-process HTTP/HTTPS/GraphQL execution & in-flight cancellation. */
      sendHttpRequest: (request: PreparedHttpRequest) => Promise<HttpResponseResult>;
      cancelHttpRequest: (requestId: string) => Promise<boolean>;

      /** OAuth 2.0 Token Manager operations (acquire, refresh, inspect cached, clear). */
      getOAuth2Token: (request: OAuth2GetTokenRequest) => Promise<OAuth2TokenExchangeResult>;
      refreshOAuth2Token: (
        request: OAuth2RefreshTokenRequest,
      ) => Promise<OAuth2TokenExchangeResult>;
      getCachedOAuth2Token: (
        coord: OAuth2TokenCoordinate,
      ) => Promise<OAuth2TokenRecord | null>;
      clearOAuth2Token: (coord: OAuth2TokenCoordinate) => Promise<boolean>;

      /** GraphQL schema introspection, offline SDL/JSON import, and per-environment cache lookup. */
      introspectGraphQLSchema: (
        payload: GraphQLIntrospectRequest,
      ) => Promise<GraphQLSchemaDiscoveryResult>;
      loadLocalGraphQLSchema: (
        payload: GraphQLLoadLocalSchemaRequest,
      ) => Promise<GraphQLSchemaDiscoveryResult>;
      getCachedGraphQLSchema: (
        coord: GraphQLSchemaCacheCoordinate,
      ) => Promise<GraphQLCachedSchemaRecord | null>;
      openGraphQLSchemaFileDialog: () => Promise<string | null>;

      /** Subscribes to `.awjc` / `.awj` collection file paths opened from OS Finder/Explorer or CLI (`awlasso`). */
      onCollectionOpenedFromOs: (callback: (filePath: string) => void) => () => void;
      /** Resolves the filesystem path for a dropped `File` object. */
      getPathForFile: (file: File) => string;

      /** Loads user preferences (theme, SSL verification default, request timeout, recent files). */
      loadSettings: () => Promise<AppSettings>;
      /** Saves partial user preferences and returns the merged settings. */
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

      getRecentFiles: () => Promise<string[]>;
      addRecentFile: (filePath: string) => Promise<string[]>;
      removeRecentFile: (filePath: string) => Promise<string[]>;
      clearRecentFiles: () => Promise<void>;

      saveSession: (session: SessionState) => Promise<boolean>;
      loadSession: () => Promise<SessionState | null>;

      /** Windows Explorer "Open with AwapiLasso" right-click context menu integration. */
      getContextMenuStatus: () => Promise<ContextMenuStatus>;
      setContextMenuEnabled: (enable: boolean) => Promise<ContextMenuUpdateResult>;

      /** `awlasso` terminal CLI launcher installation status & toggle. */
      getCliCommandStatus: () => Promise<CliCommandStatus>;
      setCliCommandEnabled: (enable: boolean) => Promise<CliCommandUpdateResult>;

      copyToClipboard: (text: string) => Promise<void>;
      readClipboardText: () => Promise<string>;

      /** Checks GitHub Releases and shows the result, without installing updates. */
      checkForUpdates: () => Promise<void>;

      /** Per-collection Git integration (using the collection's parent folder as cwd). */
      getGitStatus: (collectionFilePath: string) => Promise<GitCollectionStatus>;
      initGitRepo: (collectionFilePath: string) => Promise<GitOperationResult>;
      ensureGitignore: (collectionFilePath: string) => Promise<GitOperationResult>;
      getGitDiff: (request: GitDiffRequest) => Promise<GitDiffPayload>;
      getGitLog: (request: GitLogRequest) => Promise<GitCommitEntry[]>;
      checkoutGitBranch: (request: GitCheckoutBranchRequest) => Promise<GitOperationResult>;
      commitGitChanges: (request: GitCommitRequest) => Promise<GitOperationResult>;
      pullGit: (collectionFilePath: string) => Promise<GitOperationResult>;
      pushGit: (collectionFilePath: string) => Promise<GitOperationResult>;
      revertGitChanges: (request: GitRevertRequest) => Promise<GitOperationResult>;

      /** Reveals `filePath` in OS Finder / Explorer. */
      showItemInFolder: (filePath: string) => Promise<void>;

      /** Opens the configured external terminal in the folder containing `filePath` (null = home folder). */
      openInTerminal: (filePath: string | null) => Promise<boolean>;

      /** Terminal apps and shells available on this machine (for Preferences). */
      getTerminalChoices: () => Promise<TerminalChoices>;

      /** Integrated terminal: start a shell. `cwd` may be a file (its folder is used) or null (home). */
      ptyCreate: (options: PtyCreateOptions) => Promise<PtyCreateResult>;
      ptyWrite: (id: number, data: string) => void;
      ptyResize: (id: number, cols: number, rows: number) => void;
      ptyKill: (id: number) => Promise<void>;
      onPtyData: (callback: (event: PtyDataEvent) => void) => () => void;
      onPtyExit: (callback: (event: PtyExitEvent) => void) => () => void;

      /** Application menu event subscriptions. */
      onMenuNewCollection: (callback: () => void) => () => void;
      onMenuOpenCollection: (callback: () => void) => () => void;
      onMenuSaveCollection: (callback: () => void) => () => void;
      onMenuSaveCollectionAs: (callback: () => void) => () => void;
      onMenuOpenSettings: (callback: () => void) => () => void;
      onMenuImportCurl: (callback: () => void) => () => void;
      onMenuImportOpenApi: (callback: () => void) => () => void;
      onMenuToggleTerminal: (callback: () => void) => () => void;
      onMenuNewTerminal: (callback: () => void) => () => void;
    };
  }
}

export {};
