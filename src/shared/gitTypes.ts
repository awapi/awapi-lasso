export type GitFileState =
  | 'clean'
  | 'modified'
  | 'staged'
  | 'untracked'
  | 'ignored'
  | 'conflict'
  | 'not_a_repo'
  | 'unsaved';

export interface GitSafetyCheckResult {
  safe: boolean;
  secretsSidecarIgnored: boolean;
  hasPlaintextSecrets: boolean;
  plaintextSecretWarnings: string[];
  issues: string[];
}

export interface GitChangedFileEntry {
  path: string;
  status: string;
}

export interface GitCommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitCollectionStatus {
  collectionFilePath: string;
  /** The collection's parent directory (`path.dirname(collectionFilePath)`), used as Git `cwd`. */
  folderPath: string;
  isGitRepo: boolean;
  repoRootPath?: string;
  relativeFilePath?: string;
  branch?: string;
  detachedHead?: boolean;
  remoteUrl?: string;
  hasUpstream?: boolean;
  ahead: number;
  behind: number;
  fileStatus: GitFileState;
  folderChangedFiles: GitChangedFileEntry[];
  branches: string[];
  safety: GitSafetyCheckResult;
  error?: string;
}

export interface GitDiffRequest {
  collectionFilePath: string;
  /** Commit reference to compare against (defaults to `'HEAD'`). */
  commitRef?: string;
  /** Optional in-memory serialized `.awjc` YAML/JSON to compare against `commitRef` before saving. */
  workingContentOverride?: string;
}

export interface GitDiffPayload {
  collectionFilePath: string;
  commitRef: string;
  headContent: string;
  workingContent: string;
  rawUnifiedDiff: string;
  hasChanges: boolean;
}

export interface GitLogRequest {
  collectionFilePath: string;
  limit?: number;
}

export interface GitCheckoutBranchRequest {
  collectionFilePath: string;
  branch: string;
  createNew?: boolean;
}

export type GitCommitScope = 'collection_only' | 'folder';

export interface GitCommitRequest {
  collectionFilePath: string;
  message: string;
  scope?: GitCommitScope;
}

export interface GitRevertRequest {
  collectionFilePath: string;
  /** Target commit reference to restore the collection file from (defaults to `'HEAD'`). */
  commitRef?: string;
}

export interface GitOperationResult {
  ok: boolean;
  message: string;
  error?: string;
  status?: GitCollectionStatus;
}
