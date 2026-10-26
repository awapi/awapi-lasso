import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  checkoutCollectionGitBranch,
  commitCollectionGitChanges,
  ensureCollectionGitignore,
  getCollectionGitDiff,
  getCollectionGitLog,
  getCollectionGitStatus,
  initCollectionGitRepo,
  pullCollectionGit,
  pushCollectionGit,
  revertCollectionGitChanges,
  type GitServiceDeps,
} from './gitService';
import { createEmptyCollection } from '../shared/collectionSchema';
import { serializeCollectionToYaml } from '../shared/awjcSerializer';

function createRealGitDeps(): GitServiceDeps {
  return {
    runGit: (cwd, args) =>
      new Promise(resolve => {
        const child = spawn('git', args, {
          cwd,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Awapi Tester',
            GIT_AUTHOR_EMAIL: 'tester@awapi.dev',
            GIT_COMMITTER_NAME: 'Awapi Tester',
            GIT_COMMITTER_EMAIL: 'tester@awapi.dev',
          },
        });
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
    exists: p => fs.existsSync(p),
    readFile: p => fs.readFileSync(p, 'utf-8'),
    writeFile: (p, content) => fs.writeFileSync(p, content, 'utf-8'),
  };
}

describe('gitService (per-collection folder Git integration)', () => {
  let tempDir: string;
  let deps: GitServiceDeps;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awapilasso-git-test-'));
    deps = createRealGitDeps();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns unsaved status for untitled in-memory collections', async () => {
    const status = await getCollectionGitStatus('untitled:col_123', deps);
    expect(status.isGitRepo).toBe(false);
    expect(status.fileStatus).toBe('unsaved');
    expect(status.folderPath).toBe('');
  });

  it('detects non-Git collection folders and initializes Git with *.secrets.awjc in .gitignore', async () => {
    const colPath = path.join(tempDir, 'orders.awjc');
    const col = createEmptyCollection('Orders API');
    fs.writeFileSync(colPath, serializeCollectionToYaml(col), 'utf-8');

    const beforeStatus = await getCollectionGitStatus(colPath, deps);
    expect(beforeStatus.isGitRepo).toBe(false);
    expect(beforeStatus.fileStatus).toBe('not_a_repo');
    expect(beforeStatus.folderPath).toBe(tempDir);

    const initRes = await initCollectionGitRepo(colPath, deps);
    expect(initRes.ok).toBe(true);
    expect(initRes.status?.isGitRepo).toBe(true);
    expect(initRes.status?.fileStatus).toBe('untracked');
    expect(initRes.status?.safety.safe).toBe(true);
    expect(initRes.status?.safety.secretsSidecarIgnored).toBe(true);

    const gitignoreContent = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignoreContent).toContain('*.secrets.awjc');
    expect(gitignoreContent).toContain('*.secrets.awj');
  });

  it('tracks status, commits collection changes, computes YAML diff, and lists commit history', async () => {
    const colPath = path.join(tempDir, 'payments.awjc');
    const colV1 = createEmptyCollection('Payments API v1');
    const yamlV1 = serializeCollectionToYaml(colV1);
    fs.writeFileSync(colPath, yamlV1, 'utf-8');

    await initCollectionGitRepo(colPath, deps);

    // First commit (collection file + .gitignore)
    const commit1 = await commitCollectionGitChanges(
      {
        collectionFilePath: colPath,
        message: 'Initial commit of Payments API collection',
        scope: 'folder',
      },
      deps,
    );
    expect(commit1.ok).toBe(true);
    expect(commit1.status?.fileStatus).toBe('clean');

    // Modify the collection file on disk
    const colV2 = {
      ...colV1,
      metadata: {
        ...colV1.metadata,
        name: 'Payments API v2',
        description: 'Added refund endpoint',
      },
    };
    const yamlV2 = serializeCollectionToYaml(colV2);
    fs.writeFileSync(colPath, yamlV2, 'utf-8');

    const modifiedStatus = await getCollectionGitStatus(colPath, deps);
    expect(modifiedStatus.fileStatus).toBe('modified');
    expect(modifiedStatus.folderChangedFiles.some(f => f.path.endsWith('payments.awjc'))).toBe(
      true,
    );

    // Inspect diff between HEAD and working copy
    const diff = await getCollectionGitDiff({ collectionFilePath: colPath }, deps);
    expect(diff.hasChanges).toBe(true);
    expect(diff.headContent).toContain('Payments API v1');
    expect(diff.workingContent).toContain('Payments API v2');
    expect(diff.rawUnifiedDiff).toContain('-  name: Payments API v1');
    expect(diff.rawUnifiedDiff).toContain('+  name: Payments API v2');

    // Commit only the collection file
    const commit2 = await commitCollectionGitChanges(
      {
        collectionFilePath: colPath,
        message: 'Update Payments API to v2',
        scope: 'collection_only',
      },
      deps,
    );
    expect(commit2.ok).toBe(true);
    expect(commit2.status?.fileStatus).toBe('clean');

    // Verify commit history
    const log = await getCollectionGitLog({ collectionFilePath: colPath, limit: 10 }, deps);
    expect(log.length).toBe(2);
    expect(log[0].subject).toBe('Update Payments API to v2');
    expect(log[1].subject).toBe('Initial commit of Payments API collection');

    // Verify diff against historical commit
    const historicalDiff = await getCollectionGitDiff(
      {
        collectionFilePath: colPath,
        commitRef: log[1].hash,
      },
      deps,
    );
    expect(historicalDiff.hasChanges).toBe(true);
    expect(historicalDiff.headContent).toContain('Payments API v1');
    expect(historicalDiff.workingContent).toContain('Payments API v2');
  });

  it('creates and switches branches inside the collection folder', async () => {
    const colPath = path.join(tempDir, 'users.awjc');
    fs.writeFileSync(colPath, serializeCollectionToYaml(createEmptyCollection('Users API')), 'utf-8');
    await initCollectionGitRepo(colPath, deps);
    await commitCollectionGitChanges(
      { collectionFilePath: colPath, message: 'Initial commit', scope: 'folder' },
      deps,
    );

    const initialBranch = (await getCollectionGitStatus(colPath, deps)).branch!;

    const createBranchRes = await checkoutCollectionGitBranch(
      {
        collectionFilePath: colPath,
        branch: 'feat/oauth-flows',
        createNew: true,
      },
      deps,
    );
    expect(createBranchRes.ok).toBe(true);
    expect(createBranchRes.status?.branch).toBe('feat/oauth-flows');
    expect(createBranchRes.status?.branches).toContain('feat/oauth-flows');
    expect(createBranchRes.status?.branches).toContain(initialBranch);

    const switchBackRes = await checkoutCollectionGitBranch(
      {
        collectionFilePath: colPath,
        branch: initialBranch,
        createNew: false,
      },
      deps,
    );
    expect(switchBackRes.ok).toBe(true);
    expect(switchBackRes.status?.branch).toBe(initialBranch);
  });

  it('blocks commits when pre-commit safety detects plaintext secrets or unignored sidecar', async () => {
    const colPath = path.join(tempDir, 'billing.awjc');
    await deps.runGit(tempDir, ['init']);

    // 1. Create an unignored sidecar file (.gitignore not created yet)
    const sidecarPath = path.join(tempDir, 'billing.secrets.awjc');
    fs.writeFileSync(sidecarPath, 'awapiLassoSecrets: "1.0"\nsecrets: {}\n', 'utf-8');

    // 2. Write a collection YAML that accidentally contains a plaintext value on a secret:true variable
    const unsafeYaml = [
      'awapiLasso: "1.0"',
      'metadata:',
      '  id: col_billing',
      '  name: Billing API',
      'variables:',
      '  - key: stripeSecretKey',
      '    value: sk-live-super-secret-value',
      '    enabled: true',
      '    secret: true',
      'items: []',
      '',
    ].join('\n');
    fs.writeFileSync(colPath, unsafeYaml, 'utf-8');

    const status = await getCollectionGitStatus(colPath, deps);
    expect(status.safety.safe).toBe(false);
    expect(status.safety.secretsSidecarIgnored).toBe(false);
    expect(status.safety.hasPlaintextSecrets).toBe(true);

    const blockedCommit = await commitCollectionGitChanges(
      {
        collectionFilePath: colPath,
        message: 'Attempt unsafe commit',
      },
      deps,
    );
    expect(blockedCommit.ok).toBe(false);
    expect(blockedCommit.message).toContain('Blocked by pre-commit secret safety check');

    // Fix .gitignore and strip plaintext secret by re-serializing via serializeCollectionToYaml
    await ensureCollectionGitignore(colPath, deps);
    const cleanCollection = createEmptyCollection('Billing API', {
      variables: [{ key: 'stripeSecretKey', value: 'sk-live-super-secret-value', enabled: true, secret: true }],
    });
    fs.writeFileSync(colPath, serializeCollectionToYaml(cleanCollection), 'utf-8');

    const safeStatus = await getCollectionGitStatus(colPath, deps);
    expect(safeStatus.safety.safe).toBe(true);
    expect(safeStatus.safety.secretsSidecarIgnored).toBe(true);
    expect(safeStatus.safety.hasPlaintextSecrets).toBe(false);

    const allowedCommit = await commitCollectionGitChanges(
      {
        collectionFilePath: colPath,
        message: 'Safe commit with stripped secrets',
        scope: 'folder',
      },
      deps,
    );
    expect(allowedCommit.ok).toBe(true);
  });

  it('pushes and pulls changes against a remote repository and reports ahead/behind counts', async () => {
    const bareRemoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awapilasso-git-remote-'));
    try {
      await deps.runGit(bareRemoteDir, ['init', '--bare']);

      const colPath = path.join(tempDir, 'catalog.awjc');
      fs.writeFileSync(
        colPath,
        serializeCollectionToYaml(createEmptyCollection('Catalog API')),
        'utf-8',
      );
      await initCollectionGitRepo(colPath, deps);
      await deps.runGit(tempDir, ['remote', 'add', 'origin', bareRemoteDir]);

      await commitCollectionGitChanges(
        { collectionFilePath: colPath, message: 'First catalog commit', scope: 'folder' },
        deps,
      );

      // Push initial branch (sets upstream -u origin <branch>)
      const pushRes = await pushCollectionGit(colPath, deps);
      expect(pushRes.ok).toBe(true);
      expect(pushRes.status?.hasUpstream).toBe(true);
      expect(pushRes.status?.ahead).toBe(0);
      expect(pushRes.status?.behind).toBe(0);

      // Make a second local commit and verify ahead = 1
      fs.writeFileSync(
        colPath,
        serializeCollectionToYaml(createEmptyCollection('Catalog API v2')),
        'utf-8',
      );
      await commitCollectionGitChanges(
        { collectionFilePath: colPath, message: 'Second catalog commit' },
        deps,
      );
      const aheadStatus = await getCollectionGitStatus(colPath, deps);
      expect(aheadStatus.ahead).toBe(1);

      const pushRes2 = await pushCollectionGit(colPath, deps);
      expect(pushRes2.ok).toBe(true);
      expect(pushRes2.status?.ahead).toBe(0);

      const pullRes = await pullCollectionGit(colPath, deps);
      expect(pullRes.ok).toBe(true);
    } finally {
      fs.rmSync(bareRemoteDir, { recursive: true, force: true });
    }
  });

  it('reverts uncommitted collection changes to HEAD or restores from a historical commit', async () => {
    const colPath = path.join(tempDir, 'inventory.awjc');
    const v1Yaml = serializeCollectionToYaml(createEmptyCollection('Inventory v1'));
    fs.writeFileSync(colPath, v1Yaml, 'utf-8');
    await initCollectionGitRepo(colPath, deps);
    await commitCollectionGitChanges(
      { collectionFilePath: colPath, message: 'Commit Inventory v1', scope: 'folder' },
      deps,
    );

    const v2Yaml = serializeCollectionToYaml(createEmptyCollection('Inventory v2'));
    fs.writeFileSync(colPath, v2Yaml, 'utf-8');
    await commitCollectionGitChanges(
      { collectionFilePath: colPath, message: 'Commit Inventory v2' },
      deps,
    );

    // Dirty the working copy with uncommitted v3 changes
    const v3Yaml = serializeCollectionToYaml(createEmptyCollection('Inventory v3 Dirty'));
    fs.writeFileSync(colPath, v3Yaml, 'utf-8');
    expect((await getCollectionGitStatus(colPath, deps)).fileStatus).toBe('modified');

    // Revert uncommitted changes back to HEAD (v2)
    const revertHeadRes = await revertCollectionGitChanges(
      { collectionFilePath: colPath, commitRef: 'HEAD' },
      deps,
    );
    expect(revertHeadRes.ok).toBe(true);
    expect(revertHeadRes.status?.fileStatus).toBe('clean');
    expect(fs.readFileSync(colPath, 'utf-8')).toContain('Inventory v2');

    // Restore from the first commit (v1)
    const log = await getCollectionGitLog({ collectionFilePath: colPath }, deps);
    const v1CommitHash = log[1].hash;
    const restoreV1Res = await revertCollectionGitChanges(
      { collectionFilePath: colPath, commitRef: v1CommitHash },
      deps,
    );
    expect(restoreV1Res.ok).toBe(true);
    expect(fs.readFileSync(colPath, 'utf-8')).toContain('Inventory v1');
  });
});
