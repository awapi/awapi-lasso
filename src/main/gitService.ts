import * as path from 'path';
import YAML from 'yaml';
import { parseCollectionFile } from '../shared/awjcSerializer';
import type {
  GitCheckoutBranchRequest,
  GitChangedFileEntry,
  GitCollectionStatus,
  GitCommitEntry,
  GitCommitRequest,
  GitDiffPayload,
  GitDiffRequest,
  GitFileState,
  GitLogRequest,
  GitOperationResult,
  GitRevertRequest,
  GitSafetyCheckResult,
} from '../shared/gitTypes';
import { ensureSecretsInGitignore, getSidecarFilePath } from './secretStore';

export interface GitCommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitServiceDeps {
  runGit: (cwd: string, args: string[]) => Promise<GitCommandOutput>;
  exists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, content: string) => void;
}

const HIGH_CONFIDENCE_SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'PEM Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: 'GitHub Personal Access Token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  },
  {
    label: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
];

export function isUnsavedCollectionPath(collectionFilePath: string): boolean {
  return !collectionFilePath || /^untitled[:\-]/i.test(collectionFilePath);
}

export function getCollectionFolderPath(collectionFilePath: string): string {
  if (isUnsavedCollectionPath(collectionFilePath)) return '';
  return path.dirname(collectionFilePath);
}

function classifyPorcelainLine(porcelainLine: string): GitFileState {
  if (!porcelainLine || porcelainLine.trim().length === 0) return 'clean';
  const xy = porcelainLine.slice(0, 2);
  if (xy === '??') return 'untracked';
  if (xy === '!!') return 'ignored';
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict';
  const indexStatus = xy[0];
  const workTreeStatus = xy[1];
  if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
    return 'modified';
  }
  if (indexStatus !== ' ' && indexStatus !== '?') {
    return 'staged';
  }
  return 'modified';
}

function parsePorcelainChangedFiles(stdout: string): GitChangedFileEntry[] {
  const entries: GitChangedFileEntry[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine || rawLine.length < 4) continue;
    const status = rawLine.slice(0, 2).trim() || 'M';
    const filePart = rawLine.slice(3).trim();
    if (!filePart) continue;
    entries.push({ path: filePart, status });
  }
  return entries;
}

/**
 * Verifies pre-commit safety for a `.awjc` / `.awj` collection:
 * 1. Confirms `*.secrets.awjc` sidecar is gitignored (or not present/tracked).
 * 2. Confirms the `.awjc` file contains no plaintext values on `secret: true` fields or raw private keys/tokens.
 */
export async function verifyCollectionGitSafety(
  collectionFilePath: string,
  folderPath: string,
  deps: GitServiceDeps,
  workingContentOverride?: string,
): Promise<GitSafetyCheckResult> {
  const plaintextSecretWarnings: string[] = [];
  const issues: string[] = [];

  const sidecarPath = getSidecarFilePath(collectionFilePath);
  const sidecarExists = deps.exists(sidecarPath);

  // Check if *.secrets.awjc is ignored by git
  const checkIgnoreRes = await deps.runGit(folderPath, [
    'check-ignore',
    '-q',
    sidecarPath,
  ]);
  const isIgnoredByGit = checkIgnoreRes.code === 0;

  // Also check if sidecar file is tracked or shows up as untracked in git status
  const sidecarStatusRes = await deps.runGit(folderPath, [
    'status',
    '--porcelain',
    '--',
    sidecarPath,
  ]);
  const sidecarPorcelain = sidecarStatusRes.stdout.trim();
  const isSidecarTrackedOrUntracked = sidecarPorcelain.length > 0 && !sidecarPorcelain.startsWith('!!');

  const secretsSidecarIgnored = isIgnoredByGit || (!sidecarExists && !isSidecarTrackedOrUntracked);
  if (!secretsSidecarIgnored) {
    issues.push(
      `Secret sidecar "${path.basename(sidecarPath)}" is not ignored by Git. Add "*.secrets.awjc" to .gitignore before committing.`,
    );
  }

  // Inspect the collection content for plaintext secrets
  const contentToScan =
    workingContentOverride !== undefined
      ? workingContentOverride
      : deps.exists(collectionFilePath)
        ? deps.readFile(collectionFilePath)
        : '';

  if (contentToScan.trim().length > 0) {
    try {
      const parsed = parseCollectionFile(contentToScan);
      for (const secretRec of parsed.extractedSecrets) {
        const warning = `Plaintext secret value found on secret:true field "${secretRec.key}" (${secretRec.scopeId})`;
        plaintextSecretWarnings.push(warning);
      }
    } catch {
      // Fallback: inspect raw YAML/JSON nodes for any { secret: true, value: "<non-empty>" }
      try {
        const rawDoc = YAML.parse(contentToScan) as unknown;
        const walkNode = (node: unknown): void => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const item of node) walkNode(item);
            return;
          }
          const rec = node as Record<string, unknown>;
          if (rec.secret === true) {
            const candidateVal =
              typeof rec.value === 'string'
                ? rec.value
                : typeof rec.token === 'string'
                  ? rec.token
                  : typeof rec.password === 'string'
                    ? rec.password
                    : typeof rec.secretAccessKey === 'string'
                      ? rec.secretAccessKey
                      : '';
            if (candidateVal.trim().length > 0) {
              const label = typeof rec.key === 'string' ? rec.key : 'auth';
              plaintextSecretWarnings.push(
                `Plaintext secret value found on secret:true field "${label}"`,
              );
            }
          }
          for (const child of Object.values(rec)) {
            walkNode(child);
          }
        };
        walkNode(rawDoc);
      } catch {
        // Ignore syntax error during live edit
      }
    }

    for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
      if (pattern.regex.test(contentToScan)) {
        plaintextSecretWarnings.push(
          `Detected ${pattern.label} marker in collection file`,
        );
      }
    }
  }

  const hasPlaintextSecrets = plaintextSecretWarnings.length > 0;
  if (hasPlaintextSecrets) {
    issues.push(...plaintextSecretWarnings);
  }

  return {
    safe: secretsSidecarIgnored && !hasPlaintextSecrets,
    secretsSidecarIgnored,
    hasPlaintextSecrets,
    plaintextSecretWarnings,
    issues,
  };
}

/**
 * Inspects the Git status for a collection using its parent folder (`path.dirname(collectionFilePath)`) as `cwd`.
 */
export async function getCollectionGitStatus(
  collectionFilePath: string,
  deps: GitServiceDeps,
): Promise<GitCollectionStatus> {
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      collectionFilePath,
      folderPath: '',
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      fileStatus: 'unsaved',
      folderChangedFiles: [],
      branches: [],
      safety: {
        safe: true,
        secretsSidecarIgnored: true,
        hasPlaintextSecrets: false,
        plaintextSecretWarnings: [],
        issues: [],
      },
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  if (!deps.exists(folderPath)) {
    return {
      collectionFilePath,
      folderPath,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      fileStatus: 'not_a_repo',
      folderChangedFiles: [],
      branches: [],
      safety: {
        safe: true,
        secretsSidecarIgnored: true,
        hasPlaintextSecrets: false,
        plaintextSecretWarnings: [],
        issues: [],
      },
      error: `Collection folder does not exist: ${folderPath}`,
    };
  }

  const topLevelRes = await deps.runGit(folderPath, ['rev-parse', '--show-toplevel']);
  if (topLevelRes.code !== 0) {
    return {
      collectionFilePath,
      folderPath,
      isGitRepo: false,
      ahead: 0,
      behind: 0,
      fileStatus: 'not_a_repo',
      folderChangedFiles: [],
      branches: [],
      safety: {
        safe: true,
        secretsSidecarIgnored: true,
        hasPlaintextSecrets: false,
        plaintextSecretWarnings: [],
        issues: [],
      },
    };
  }

  const repoRootPath = topLevelRes.stdout.trim();
  const prefixRes = await deps.runGit(folderPath, ['rev-parse', '--show-prefix']);
  const repoPrefix = prefixRes.code === 0 ? prefixRes.stdout.trim() : '';
  const relativeFilePath = `${repoPrefix}${path.basename(collectionFilePath)}`;

  // Current branch (works for both normal and unborn HEAD)
  const branchRes = await deps.runGit(folderPath, ['branch', '--show-current']);
  let branch = branchRes.code === 0 ? branchRes.stdout.trim() : '';
  let detachedHead = false;
  if (!branch) {
    const symbolicRes = await deps.runGit(folderPath, ['symbolic-ref', '--short', 'HEAD']);
    if (symbolicRes.code === 0 && symbolicRes.stdout.trim()) {
      branch = symbolicRes.stdout.trim();
    } else {
      const shortShaRes = await deps.runGit(folderPath, ['rev-parse', '--short', 'HEAD']);
      if (shortShaRes.code === 0 && shortShaRes.stdout.trim()) {
        branch = `HEAD (${shortShaRes.stdout.trim()})`;
        detachedHead = true;
      } else {
        branch = 'main';
      }
    }
  }

  // Local branches list
  const branchesRes = await deps.runGit(folderPath, [
    'branch',
    '--format=%(refname:short)',
  ]);
  const branchSet = new Set<string>();
  if (!detachedHead && branch) {
    branchSet.add(branch);
  }
  if (branchesRes.code === 0) {
    for (const line of branchesRes.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) branchSet.add(trimmed);
    }
  }

  // Remote URL & Ahead / Behind counts
  const remoteRes = await deps.runGit(folderPath, ['config', '--get', 'remote.origin.url']);
  const remoteUrl = remoteRes.code === 0 ? remoteRes.stdout.trim() || undefined : undefined;

  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  const revListRes = await deps.runGit(folderPath, [
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...@{upstream}',
  ]);
  if (revListRes.code === 0) {
    hasUpstream = true;
    const parts = revListRes.stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      ahead = Number.parseInt(parts[0], 10) || 0;
      behind = Number.parseInt(parts[1], 10) || 0;
    }
  }

  // Status for this specific collection file
  const fileStatusRes = await deps.runGit(folderPath, [
    'status',
    '--porcelain',
    '--',
    collectionFilePath,
  ]);
  const firstPorcelainLine =
    fileStatusRes.code === 0
      ? (fileStatusRes.stdout.split(/\r?\n/).find(l => l.trim().length > 0) ?? '')
      : '';
  const fileStatus = classifyPorcelainLine(firstPorcelainLine);

  // Status for all files in the collection's folder
  const folderStatusRes = await deps.runGit(folderPath, [
    'status',
    '--porcelain',
    '--',
    '.',
  ]);
  const folderChangedFiles =
    folderStatusRes.code === 0
      ? parsePorcelainChangedFiles(folderStatusRes.stdout)
      : [];

  const safety = await verifyCollectionGitSafety(collectionFilePath, folderPath, deps);

  return {
    collectionFilePath,
    folderPath,
    isGitRepo: true,
    repoRootPath,
    relativeFilePath,
    branch,
    detachedHead,
    remoteUrl,
    hasUpstream,
    ahead,
    behind,
    fileStatus,
    folderChangedFiles,
    branches: Array.from(branchSet),
    safety,
  };
}

/**
 * Initializes a new Git repository in the collection's folder (`path.dirname(collectionFilePath)`)
 * and ensures `*.secrets.awjc`, `*.secrets.awj`, and `.env.secret*` are added to `.gitignore`.
 */
export async function initCollectionGitRepo(
  collectionFilePath: string,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk before initializing a Git repository.',
      error: 'Collection is unsaved.',
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  const initRes = await deps.runGit(folderPath, ['init']);
  if (initRes.code !== 0) {
    return {
      ok: false,
      message: 'Failed to initialize Git repository.',
      error: initRes.stderr.trim() || initRes.stdout.trim() || 'git init failed',
    };
  }

  const gitignorePath = path.join(folderPath, '.gitignore');
  ensureSecretsInGitignore(gitignorePath, deps);

  const status = await getCollectionGitStatus(collectionFilePath, deps);
  return {
    ok: true,
    message: `Initialized Git repository in ${folderPath} and protected *.secrets.awjc in .gitignore.`,
    status,
  };
}

/**
 * Ensures `.gitignore` in the collection's folder ignores `*.secrets.awjc` and `*.secrets.awj`.
 */
export async function ensureCollectionGitignore(
  collectionFilePath: string,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk first.',
      error: 'Collection is unsaved.',
    };
  }
  const folderPath = getCollectionFolderPath(collectionFilePath);
  const gitignorePath = path.join(folderPath, '.gitignore');
  ensureSecretsInGitignore(gitignorePath, deps);
  const status = await getCollectionGitStatus(collectionFilePath, deps);
  return {
    ok: true,
    message: 'Updated .gitignore with *.secrets.awjc rules.',
    status,
  };
}

/**
 * Computes the side-by-side YAML/JSON diff between `commitRef` (default `HEAD`) and the
 * working copy (or live in-memory override) of the `.awjc` collection.
 */
export async function getCollectionGitDiff(
  request: GitDiffRequest,
  deps: GitServiceDeps,
): Promise<GitDiffPayload> {
  const { collectionFilePath, commitRef = 'HEAD', workingContentOverride } = request;
  const workingContent =
    workingContentOverride !== undefined
      ? workingContentOverride
      : deps.exists(collectionFilePath)
        ? deps.readFile(collectionFilePath)
        : '';

  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      collectionFilePath,
      commitRef,
      headContent: '',
      workingContent,
      rawUnifiedDiff: '',
      hasChanges: workingContent.length > 0,
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  const topLevelRes = await deps.runGit(folderPath, ['rev-parse', '--show-toplevel']);
  if (topLevelRes.code !== 0) {
    return {
      collectionFilePath,
      commitRef,
      headContent: '',
      workingContent,
      rawUnifiedDiff: '',
      hasChanges: workingContent.length > 0,
    };
  }

  const prefixRes = await deps.runGit(folderPath, ['rev-parse', '--show-prefix']);
  const repoPrefix = prefixRes.code === 0 ? prefixRes.stdout.trim() : '';
  const relativeFilePath = `${repoPrefix}${path.basename(collectionFilePath)}`;

  const showRes = await deps.runGit(folderPath, [
    'show',
    `${commitRef}:${relativeFilePath}`,
  ]);
  const headContent = showRes.code === 0 ? showRes.stdout : '';

  const diffRes = await deps.runGit(folderPath, [
    'diff',
    commitRef,
    '--',
    collectionFilePath,
  ]);
  const rawUnifiedDiff = diffRes.code === 0 ? diffRes.stdout : '';

  return {
    collectionFilePath,
    commitRef,
    headContent,
    workingContent,
    rawUnifiedDiff,
    hasChanges: headContent !== workingContent,
  };
}

/**
 * Returns recent Git commits for the collection file (falling back to folder history if the file has no commits yet).
 */
export async function getCollectionGitLog(
  request: GitLogRequest,
  deps: GitServiceDeps,
): Promise<GitCommitEntry[]> {
  const { collectionFilePath, limit = 20 } = request;
  if (isUnsavedCollectionPath(collectionFilePath)) return [];

  const folderPath = getCollectionFolderPath(collectionFilePath);
  if (!deps.exists(folderPath)) return [];

  const formatArg = '--pretty=format:%H%x09%h%x09%an%x09%aI%x09%s';
  let logRes = await deps.runGit(folderPath, [
    'log',
    `-n`,
    String(limit),
    formatArg,
    '--',
    collectionFilePath,
  ]);

  if (logRes.code !== 0 || !logRes.stdout.trim()) {
    logRes = await deps.runGit(folderPath, ['log', `-n`, String(limit), formatArg]);
  }

  if (logRes.code !== 0 || !logRes.stdout.trim()) {
    return [];
  }

  const entries: GitCommitEntry[] = [];
  for (const line of logRes.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hash, shortHash, author, date, ...subjectParts] = line.split('\t');
    if (!hash || !shortHash) continue;
    entries.push({
      hash,
      shortHash,
      author: author || 'Unknown',
      date: date || '',
      subject: subjectParts.join('\t') || '(no message)',
    });
  }
  return entries;
}

/**
 * Switches to an existing branch or creates and checks out a new branch in the collection's folder.
 */
export async function checkoutCollectionGitBranch(
  request: GitCheckoutBranchRequest,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  const { collectionFilePath, branch, createNew = false } = request;
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) {
    return {
      ok: false,
      message: 'Branch name cannot be empty.',
      error: 'Branch name is required.',
    };
  }
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk first.',
      error: 'Collection is unsaved.',
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  const args = createNew
    ? ['checkout', '-b', trimmedBranch]
    : ['checkout', trimmedBranch];

  const res = await deps.runGit(folderPath, args);
  const status = await getCollectionGitStatus(collectionFilePath, deps);
  if (res.code !== 0) {
    return {
      ok: false,
      message: `Failed to switch to branch "${trimmedBranch}".`,
      error: res.stderr.trim() || res.stdout.trim() || 'git checkout failed',
      status,
    };
  }

  return {
    ok: true,
    message: `Switched to branch "${trimmedBranch}".`,
    status,
  };
}

/**
 * Verifies pre-commit safety, stages either the `.awjc` collection file (default) or all non-secret files
 * in the collection's folder, and creates a Git commit.
 */
export async function commitCollectionGitChanges(
  request: GitCommitRequest,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  const { collectionFilePath, message, scope = 'collection_only' } = request;
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return {
      ok: false,
      message: 'Commit message cannot be empty.',
      error: 'Commit message is required.',
    };
  }
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk before committing.',
      error: 'Collection is unsaved.',
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  const safety = await verifyCollectionGitSafety(collectionFilePath, folderPath, deps);
  if (!safety.safe) {
    const status = await getCollectionGitStatus(collectionFilePath, deps);
    return {
      ok: false,
      message: 'Blocked by pre-commit secret safety check.',
      error: safety.issues.join(' '),
      status,
    };
  }

  const addArgs =
    scope === 'folder'
      ? [
          'add',
          '--all',
          '--',
          '.',
          ':(exclude)*.secrets.awjc',
          ':(exclude)*.secrets.awj',
          ':(exclude).env.secret*',
        ]
      : ['add', '--', collectionFilePath];

  const addRes = await deps.runGit(folderPath, addArgs);
  if (addRes.code !== 0) {
    const status = await getCollectionGitStatus(collectionFilePath, deps);
    return {
      ok: false,
      message: 'Failed to stage files for commit.',
      error: addRes.stderr.trim() || addRes.stdout.trim() || 'git add failed',
      status,
    };
  }

  const commitRes = await deps.runGit(folderPath, ['commit', '-m', trimmedMessage]);
  const status = await getCollectionGitStatus(collectionFilePath, deps);
  if (commitRes.code !== 0) {
    return {
      ok: false,
      message: 'Failed to commit changes.',
      error: commitRes.stderr.trim() || commitRes.stdout.trim() || 'git commit failed',
      status,
    };
  }

  return {
    ok: true,
    message: `Committed changes: "${trimmedMessage}"`,
    status,
  };
}

/**
 * Runs `git pull` in the collection's folder.
 */
export async function pullCollectionGit(
  collectionFilePath: string,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk first.',
      error: 'Collection is unsaved.',
    };
  }
  const folderPath = getCollectionFolderPath(collectionFilePath);
  const pullRes = await deps.runGit(folderPath, ['pull']);
  const status = await getCollectionGitStatus(collectionFilePath, deps);
  if (pullRes.code !== 0) {
    return {
      ok: false,
      message: 'Git pull failed.',
      error: pullRes.stderr.trim() || pullRes.stdout.trim() || 'git pull failed',
      status,
    };
  }
  return {
    ok: true,
    message: pullRes.stdout.trim() || 'Pulled latest changes.',
    status,
  };
}

/**
 * Runs `git push` in the collection's folder (automatically setting upstream to `origin <branch>` if needed).
 */
export async function pushCollectionGit(
  collectionFilePath: string,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk first.',
      error: 'Collection is unsaved.',
    };
  }
  const folderPath = getCollectionFolderPath(collectionFilePath);
  const currentStatus = await getCollectionGitStatus(collectionFilePath, deps);
  const pushArgs =
    !currentStatus.hasUpstream &&
    currentStatus.remoteUrl &&
    currentStatus.branch &&
    !currentStatus.detachedHead
      ? ['push', '-u', 'origin', currentStatus.branch]
      : ['push'];

  const pushRes = await deps.runGit(folderPath, pushArgs);
  const status = await getCollectionGitStatus(collectionFilePath, deps);
  if (pushRes.code !== 0) {
    return {
      ok: false,
      message: 'Git push failed.',
      error: pushRes.stderr.trim() || pushRes.stdout.trim() || 'git push failed',
      status,
    };
  }
  return {
    ok: true,
    message: pushRes.stdout.trim() || pushRes.stderr.trim() || 'Pushed changes to remote.',
    status,
  };
}

/**
 * Reverts / restores the `.awjc` collection file on disk to the state at `commitRef` (defaults to `HEAD`).
 */
export async function revertCollectionGitChanges(
  request: GitRevertRequest,
  deps: GitServiceDeps,
): Promise<GitOperationResult> {
  const { collectionFilePath, commitRef = 'HEAD' } = request;
  if (isUnsavedCollectionPath(collectionFilePath)) {
    return {
      ok: false,
      message: 'Save the collection to disk first.',
      error: 'Collection is unsaved.',
    };
  }

  const folderPath = getCollectionFolderPath(collectionFilePath);
  const targetRef = commitRef.trim() || 'HEAD';
  const checkoutRes = await deps.runGit(folderPath, [
    'checkout',
    targetRef,
    '--',
    collectionFilePath,
  ]);
  const status = await getCollectionGitStatus(collectionFilePath, deps);

  if (checkoutRes.code !== 0) {
    return {
      ok: false,
      message: `Failed to revert collection to ${targetRef === 'HEAD' ? 'HEAD' : targetRef.slice(0, 7)}.`,
      error: checkoutRes.stderr.trim() || checkoutRes.stdout.trim() || 'git checkout failed',
      status,
    };
  }

  return {
    ok: true,
    message:
      targetRef === 'HEAD'
        ? 'Reverted uncommitted collection changes to HEAD.'
        : `Restored collection to revision ${targetRef.slice(0, 7)}.`,
    status,
  };
}

