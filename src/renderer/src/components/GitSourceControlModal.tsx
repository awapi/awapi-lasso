import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  FolderGit2,
  GitBranch,
  GitCommit,
  GripHorizontal,
  History,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AwjcCollection } from '../../../shared/collectionSchema';
import { serializeCollectionToYaml } from '../../../shared/awjcSerializer';
import type {
  GitCollectionStatus,
  GitCommitEntry,
  GitCommitScope,
  GitDiffPayload,
  GitFileState,
} from '../../../shared/gitTypes';
import { ResizableSplitPane } from './ResizableSplitPane';
import { useTheme } from '../context/ThemeContext';

export interface GitSourceControlModalProps {
  isOpen: boolean;
  collectionFilePath: string | null;
  collection: AwjcCollection | null;
  isCollectionDirty?: boolean;
  onSaveCollection?: (filePath: string) => Promise<void> | void;
  onReloadCollection?: (filePath: string) => Promise<void> | void;
  onStatusUpdated?: (filePath: string, status: GitCollectionStatus) => void;
  onClose: () => void;
}

export function getGitFileStateBadge(
  fileStatus: GitFileState,
  isDirty?: boolean,
): { label: string; color: string } {
  if (fileStatus === 'unsaved') {
    return { label: 'Unsaved', color: '#64748b' };
  }
  if (fileStatus === 'not_a_repo') {
    return { label: 'No Git Repo', color: '#64748b' };
  }
  if (fileStatus === 'conflict') {
    return { label: 'Conflict', color: '#ef4444' };
  }
  if (fileStatus === 'untracked') {
    return { label: 'Untracked', color: '#3b82f6' };
  }
  if (fileStatus === 'modified' || isDirty) {
    return { label: 'Modified', color: '#f59e0b' };
  }
  if (fileStatus === 'staged') {
    return { label: 'Staged', color: '#10b981' };
  }
  return { label: 'Clean', color: '#22c55e' };
}

export const GitSourceControlModal: React.FC<GitSourceControlModalProps> = ({
  isOpen,
  collectionFilePath,
  collection,
  isCollectionDirty = false,
  onSaveCollection,
  onReloadCollection,
  onStatusUpdated,
  onClose,
}) => {
  const { colors, isLight } = useTheme();
  const [status, setStatus] = useState<GitCollectionStatus | null>(null);
  const [diff, setDiff] = useState<GitDiffPayload | null>(null);
  const [commits, setCommits] = useState<GitCommitEntry[]>([]);
  const [selectedCommitRef, setSelectedCommitRef] = useState<string>('HEAD');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [commitScope, setCommitScope] = useState<GitCommitScope>('collection_only');
  const [newBranchOpen, setNewBranchOpen] = useState<boolean>(false);
  const [newBranchName, setNewBranchName] = useState<string>('');
  const [confirmingRevertRef, setConfirmingRevertRef] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const MIN_MODAL_WIDTH = 560;
  const MIN_MODAL_HEIGHT = 380;

  const computeInitialRect = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800;
    const width = Math.max(MIN_MODAL_WIDTH, Math.min(1080, vw - 80));
    const height = Math.max(MIN_MODAL_HEIGHT, Math.min(720, Math.round(vh * 0.82)));
    const x = Math.max(16, Math.round((vw - width) / 2));
    const y = Math.max(16, Math.round((vh - height) / 2));
    return { x, y, width, height };
  }, []);

  const [modalRect, setModalRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>(computeInitialRect);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const [isInteracting, setIsInteracting] = useState<boolean>(false);

  const interactionRef = useRef<
    | {
        kind: 'move';
        startMouseX: number;
        startMouseY: number;
        startRect: { x: number; y: number; width: number; height: number };
      }
    | {
        kind: 'resize';
        dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
        startMouseX: number;
        startMouseY: number;
        startRect: { x: number; y: number; width: number; height: number };
      }
    | null
  >(null);
  const backdropMouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!isInteracting) return;

    const handleMouseMove = (e: MouseEvent) => {
      const active = interactionRef.current;
      if (!active) return;
      const dx = e.clientX - active.startMouseX;
      const dy = e.clientY - active.startMouseY;
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;

      if (active.kind === 'move') {
        const nextX = Math.max(
          -(active.startRect.width - 120),
          Math.min(vw - 80, Math.round(active.startRect.x + dx)),
        );
        const nextY = Math.max(0, Math.min(vh - 48, Math.round(active.startRect.y + dy)));
        setModalRect(prev => ({
          ...prev,
          x: nextX,
          y: nextY,
        }));
      } else if (active.kind === 'resize') {
        let { x, y, width, height } = active.startRect;
        const dir = active.dir;

        if (dir.includes('e')) {
          width = Math.max(MIN_MODAL_WIDTH, Math.round(active.startRect.width + dx));
        }
        if (dir.includes('s')) {
          height = Math.max(MIN_MODAL_HEIGHT, Math.round(active.startRect.height + dy));
        }
        if (dir.includes('w')) {
          const candidateWidth = Math.max(
            MIN_MODAL_WIDTH,
            Math.round(active.startRect.width - dx),
          );
          const widthDelta = active.startRect.width - candidateWidth;
          x = Math.round(active.startRect.x + widthDelta);
          width = candidateWidth;
        }
        if (dir.includes('n')) {
          const candidateHeight = Math.max(
            MIN_MODAL_HEIGHT,
            Math.round(active.startRect.height - dy),
          );
          const heightDelta = active.startRect.height - candidateHeight;
          y = Math.max(0, Math.round(active.startRect.y + heightDelta));
          height = candidateHeight;
        }

        setModalRect({ x, y, width, height });
      }
    };

    const handleMouseUp = () => {
      interactionRef.current = null;
      setIsInteracting(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isInteracting]);

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    if (isMaximized) return;
    interactionRef.current = {
      kind: 'move',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startRect: modalRect,
    };
    setIsInteracting(true);
  };

  const handleResizeMouseDown = (
    dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (isMaximized) {
      setIsMaximized(false);
    }
    interactionRef.current = {
      kind: 'resize',
      dir,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startRect: modalRect,
    };
    setIsInteracting(true);
  };

  const isTestEnv = typeof process !== 'undefined' && Boolean(process.env.VITEST);

  const liveSerializedYaml = useMemo(() => {
    if (!isCollectionDirty || !collection) return undefined;
    try {
      return serializeCollectionToYaml(collection);
    } catch {
      return undefined;
    }
  }, [isCollectionDirty, collection]);

  const refreshAll = useCallback(
    async (commitRefToLoad = selectedCommitRef) => {
      if (!collectionFilePath || !window.electronAPI?.getGitStatus) return;
      setBusyAction('refresh');
      try {
        const nextStatus = await window.electronAPI.getGitStatus(collectionFilePath);
        setStatus(nextStatus);
        onStatusUpdated?.(collectionFilePath, nextStatus);

        if (nextStatus.isGitRepo) {
          const [nextDiff, nextLog] = await Promise.all([
            window.electronAPI.getGitDiff?.({
              collectionFilePath,
              commitRef: commitRefToLoad,
              workingContentOverride: liveSerializedYaml,
            }) ?? Promise.resolve(null),
            window.electronAPI.getGitLog?.({
              collectionFilePath,
              limit: 25,
            }) ?? Promise.resolve([]),
          ]);
          if (nextDiff) setDiff(nextDiff);
          if (Array.isArray(nextLog)) setCommits(nextLog);
        } else {
          setDiff(null);
          setCommits([]);
        }
      } finally {
        setBusyAction(null);
      }
    },
    [collectionFilePath, selectedCommitRef, liveSerializedYaml, onStatusUpdated],
  );

  useEffect(() => {
    if (!isOpen || !collectionFilePath) return;
    setFeedback(null);
    setConfirmingRevertRef(null);
    setSelectedCommitRef('HEAD');
    void refreshAll('HEAD');
  }, [isOpen, collectionFilePath, refreshAll]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !collectionFilePath) return null;

  const isUnsaved = /^untitled[:\-]/i.test(collectionFilePath);
  const fileName = collectionFilePath.split(/[/\\]/).pop() || collectionFilePath;
  const folderDisplay =
    status?.folderPath ||
    (isUnsaved ? '(Unsaved collection)' : collectionFilePath.replace(/[/\\][^/\\]+$/, ''));

  const handleSelectCommitRef = async (ref: string) => {
    setSelectedCommitRef(ref);
    setConfirmingRevertRef(null);
    if (!window.electronAPI?.getGitDiff) return;
    const nextDiff = await window.electronAPI.getGitDiff({
      collectionFilePath,
      commitRef: ref,
      workingContentOverride: liveSerializedYaml,
    });
    setDiff(nextDiff);
  };

  const handleInitRepo = async () => {
    if (!window.electronAPI?.initGitRepo) return;
    setBusyAction('init');
    setFeedback(null);
    try {
      const res = await window.electronAPI.initGitRepo(collectionFilePath);
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      await refreshAll('HEAD');
    } finally {
      setBusyAction(null);
    }
  };

  const handleFixGitignore = async () => {
    if (!window.electronAPI?.ensureGitignore) return;
    setBusyAction('gitignore');
    setFeedback(null);
    try {
      const res = await window.electronAPI.ensureGitignore(collectionFilePath);
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      await refreshAll(selectedCommitRef);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBranchSwitch = async (targetBranch: string) => {
    if (!targetBranch || targetBranch === status?.branch) return;
    if (!window.electronAPI?.checkoutGitBranch) return;
    setBusyAction('checkout');
    setFeedback(null);
    try {
      const res = await window.electronAPI.checkoutGitBranch({
        collectionFilePath,
        branch: targetBranch,
        createNew: false,
      });
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      if (res.ok && onReloadCollection) {
        await onReloadCollection(collectionFilePath);
      }
      await refreshAll('HEAD');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateBranch = async () => {
    const trimmed = newBranchName.trim();
    if (!trimmed || !window.electronAPI?.checkoutGitBranch) return;
    setBusyAction('create-branch');
    setFeedback(null);
    try {
      const res = await window.electronAPI.checkoutGitBranch({
        collectionFilePath,
        branch: trimmed,
        createNew: true,
      });
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      if (res.ok) {
        setNewBranchName('');
        setNewBranchOpen(false);
      }
      await refreshAll('HEAD');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCommit = async () => {
    const trimmedMsg = commitMessage.trim();
    if (!trimmedMsg || !window.electronAPI?.commitGitChanges) return;
    setBusyAction('commit');
    setFeedback(null);
    try {
      if (isCollectionDirty && onSaveCollection) {
        await onSaveCollection(collectionFilePath);
      }
      const res = await window.electronAPI.commitGitChanges({
        collectionFilePath,
        message: trimmedMsg,
        scope: commitScope,
      });
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      if (res.ok) {
        setCommitMessage('');
        setSelectedCommitRef('HEAD');
      }
      await refreshAll('HEAD');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePull = async () => {
    if (!window.electronAPI?.pullGit) return;
    setBusyAction('pull');
    setFeedback(null);
    try {
      const res = await window.electronAPI.pullGit(collectionFilePath);
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      if (res.ok && onReloadCollection) {
        await onReloadCollection(collectionFilePath);
      }
      await refreshAll(selectedCommitRef);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevert = async (targetRef = selectedCommitRef) => {
    if (!window.electronAPI?.revertGitChanges) return;
    setConfirmingRevertRef(null);
    setBusyAction('revert');
    setFeedback(null);
    try {
      const res = await window.electronAPI.revertGitChanges({
        collectionFilePath,
        commitRef: targetRef,
      });
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      if (res.ok && onReloadCollection) {
        await onReloadCollection(collectionFilePath);
      }
      await refreshAll(targetRef);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePush = async () => {
    if (!window.electronAPI?.pushGit) return;
    setBusyAction('push');
    setFeedback(null);
    try {
      const res = await window.electronAPI.pushGit(collectionFilePath);
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.ok ? res.message : res.error || res.message,
      });
      await refreshAll(selectedCommitRef);
    } finally {
      setBusyAction(null);
    }
  };

  const stateBadge = getGitFileStateBadge(status?.fileStatus ?? 'not_a_repo', isCollectionDirty);

  const actionBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };

  const resizeHandles: Array<{
    dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
    style: React.CSSProperties;
  }> = [
    { dir: 'n', style: { top: 0, left: 10, right: 10, height: 6, cursor: 'ns-resize' } },
    { dir: 's', style: { bottom: 0, left: 10, right: 10, height: 6, cursor: 'ns-resize' } },
    { dir: 'w', style: { left: 0, top: 10, bottom: 10, width: 6, cursor: 'ew-resize' } },
    { dir: 'e', style: { right: 0, top: 10, bottom: 10, width: 6, cursor: 'ew-resize' } },
    { dir: 'nw', style: { top: 0, left: 0, width: 12, height: 12, cursor: 'nwse-resize' } },
    { dir: 'ne', style: { top: 0, right: 0, width: 12, height: 12, cursor: 'nesw-resize' } },
    { dir: 'sw', style: { bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize' } },
    { dir: 'se', style: { bottom: 0, right: 0, width: 16, height: 16, cursor: 'nwse-resize' } },
  ];

  return (
    <div
      data-testid="git-modal-backdrop"
      onMouseDown={e => {
        backdropMouseDownTargetRef.current = e.target;
      }}
      onClick={e => {
        if (
          e.target === e.currentTarget &&
          backdropMouseDownTargetRef.current === e.currentTarget &&
          !isInteracting
        ) {
          onClose();
        }
        backdropMouseDownTargetRef.current = null;
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 185,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Git Source Control & YAML Diff"
        data-testid="git-source-control-modal"
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          ...(isMaximized
            ? {
                left: 12,
                top: 12,
                width: 'calc(100vw - 24px)',
                height: 'calc(100vh - 24px)',
              }
            : {
                left: modalRect.x,
                top: modalRect.y,
                width: modalRect.width,
                height: modalRect.height,
              }),
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 22px 55px rgba(0, 0, 0, 0.55)',
          userSelect: isInteracting ? 'none' : 'auto',
        }}
      >
        {/* 8-Directional Edge & Corner Resize Handles */}
        {!isMaximized &&
          resizeHandles.map(h => (
            <div
              key={h.dir}
              data-testid={`git-modal-resize-${h.dir}`}
              onMouseDown={e => handleResizeMouseDown(h.dir, e)}
              style={{
                position: 'absolute',
                zIndex: 40,
                ...h.style,
              }}
            >
              {h.dir === 'se' && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  style={{
                    position: 'absolute',
                    right: 2,
                    bottom: 2,
                    opacity: 0.55,
                    pointerEvents: 'none',
                  }}
                >
                  <path
                    d="M10 2L2 10M10 6L6 10M10 10L10 10"
                    stroke={colors.textSecondary}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
          ))}

        {/* Draggable Modal Header */}
        <div
          data-testid="git-modal-header"
          onMouseDown={handleHeaderMouseDown}
          onDoubleClick={() => setIsMaximized(prev => !prev)}
          title="Drag to move • Double-click to maximize/restore"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
            gap: 12,
            cursor: isMaximized ? 'default' : 'move',
            userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <GripHorizontal size={15} color={colors.textMuted} />
            <FolderGit2 size={18} color={colors.accent} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: colors.textPrimary }}>
                  Git Source Control — {collection?.metadata.name ?? fileName}
                </span>
                <span
                  data-testid="git-modal-file-status-badge"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    backgroundColor: `${stateBadge.color}22`,
                    color: stateBadge.color,
                    border: `1px solid ${stateBadge.color}55`,
                  }}
                >
                  {stateBadge.label}
                </span>
              </div>
              <div
                data-testid="git-modal-folder-path"
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Folder: {folderDisplay}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              data-testid="git-modal-maximize-btn"
              aria-label={isMaximized ? 'Restore modal size' : 'Maximize modal'}
              title={isMaximized ? 'Restore size' : 'Maximize'}
              onClick={() => setIsMaximized(prev => !prev)}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 4,
                display: 'inline-flex',
              }}
            >
              {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              data-testid="close-git-modal-btn"
              aria-label="Close Git Source Control Modal"
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 4,
                display: 'inline-flex',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Unsaved Collection State */}
        {isUnsaved ? (
          <div
            data-testid="git-unsaved-collection-prompt"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
              gap: 12,
              textAlign: 'center',
            }}
          >
            <FolderGit2 size={36} color={colors.textSecondary} />
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.textPrimary }}>
              Save this collection to disk to enable Git integration
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, maxWidth: 460 }}>
              AwapiLasso uses each collection&apos;s folder on disk as its Git working directory.
              Save this collection as a <code>.awjc</code> file first.
            </div>
            {onSaveCollection && (
              <button
                type="button"
                data-testid="git-save-unsaved-collection-btn"
                onClick={() => void onSaveCollection(collectionFilePath)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: colors.accent,
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save Collection…
              </button>
            )}
          </div>
        ) : status && !status.isGitRepo ? (
          /* Non-Git Folder -> Offer git init */
          <div
            data-testid="git-not-a-repo-view"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
              gap: 14,
              textAlign: 'center',
            }}
          >
            <FolderGit2 size={40} color={colors.accent} />
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.textPrimary }}>
              Collection folder is not a Git repository yet
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, maxWidth: 520 }}>
              Initialize a Git repository in <code>{status.folderPath}</code> to version-control{' '}
              <code>{fileName}</code>. AwapiLasso will automatically configure{' '}
              <code>.gitignore</code> to exclude <code>*.secrets.awjc</code> sidecar files.
            </div>
            <button
              type="button"
              data-testid="git-init-repo-btn"
              disabled={busyAction === 'init'}
              onClick={() => void handleInitRepo()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: colors.accent,
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <GitBranch size={14} />
              {busyAction === 'init'
                ? 'Initializing…'
                : 'Initialize Git Repository in Collection Folder'}
            </button>
          </div>
        ) : (
          /* Active Git Repository View */
          <>
            {/* Branch Switcher, Pull/Push, and Pre-Commit Safety Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: `1px solid ${colors.border}`,
                backgroundColor: colors.bgPrimary,
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              {/* Left: Branch Selector & New Branch */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                  }}
                >
                  <GitBranch size={13} color={colors.accent} />
                  <select
                    aria-label="Active Git Branch"
                    data-testid="git-branch-select"
                    value={status?.branch ?? ''}
                    onChange={e => void handleBranchSwitch(e.target.value)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: colors.textPrimary,
                      fontSize: 12,
                      fontWeight: 700,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {(status?.branches ?? [status?.branch ?? 'main']).map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                {!newBranchOpen ? (
                  <button
                    type="button"
                    data-testid="git-new-branch-toggle-btn"
                    onClick={() => setNewBranchOpen(true)}
                    style={actionBtnStyle}
                  >
                    <Plus size={12} />
                    New Branch
                  </button>
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="text"
                      aria-label="New branch name"
                      data-testid="git-new-branch-input"
                      placeholder="feat/new-endpoint"
                      value={newBranchName}
                      onChange={e => setNewBranchName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleCreateBranch();
                        if (e.key === 'Escape') setNewBranchOpen(false);
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 5,
                        border: `1px solid ${colors.accent}`,
                        backgroundColor: colors.bgSecondary,
                        color: colors.textPrimary,
                        fontSize: 12,
                        width: 160,
                      }}
                    />
                    <button
                      type="button"
                      data-testid="git-create-branch-btn"
                      onClick={() => void handleCreateBranch()}
                      style={{
                        ...actionBtnStyle,
                        backgroundColor: colors.accent,
                        color: '#ffffff',
                        borderColor: colors.accent,
                      }}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewBranchOpen(false)}
                      style={actionBtnStyle}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Pull & Push Controls */}
                <button
                  type="button"
                  data-testid="git-pull-btn"
                  disabled={busyAction !== null}
                  onClick={() => void handlePull()}
                  title="Pull latest commits from remote"
                  style={actionBtnStyle}
                >
                  <ArrowDown size={13} />
                  Pull{status && status.behind > 0 ? ` (${status.behind})` : ''}
                </button>

                <button
                  type="button"
                  data-testid="git-push-btn"
                  disabled={busyAction !== null}
                  onClick={() => void handlePush()}
                  title="Push local commits to remote"
                  style={actionBtnStyle}
                >
                  <ArrowUp size={13} />
                  Push{status && status.ahead > 0 ? ` (${status.ahead})` : ''}
                </button>

                <button
                  type="button"
                  data-testid="git-refresh-btn"
                  disabled={busyAction !== null}
                  onClick={() => void refreshAll(selectedCommitRef)}
                  title="Refresh Git status and diff"
                  aria-label="Refresh Git status and diff"
                  style={{ ...actionBtnStyle, padding: 6 }}
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {/* Right: Pre-Commit Safety Status */}
              {status?.safety.safe ? (
                <div
                  data-testid="git-safety-badge-safe"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 6,
                    backgroundColor: `${colors.success}18`,
                    color: colors.success,
                    border: `1px solid ${colors.success}44`,
                  }}
                >
                  <ShieldCheck size={13} />
                  Secrets Safe (*.secrets.awjc ignored)
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <div
                    data-testid="git-safety-badge-unsafe"
                    title={status?.safety.issues.join('\n')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: 6,
                      backgroundColor: `${colors.danger}18`,
                      color: colors.danger,
                      border: `1px solid ${colors.danger}44`,
                    }}
                  >
                    <ShieldAlert size={13} />
                    Pre-commit warning ({status?.safety.issues.length ?? 1})
                  </div>
                  {status && !status.safety.secretsSidecarIgnored && (
                    <button
                      type="button"
                      data-testid="git-fix-gitignore-btn"
                      onClick={() => void handleFixGitignore()}
                      style={{
                        ...actionBtnStyle,
                        fontSize: 11,
                        padding: '3px 8px',
                        borderColor: colors.warning,
                        color: colors.warning,
                      }}
                    >
                      Fix .gitignore
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Operation Feedback Banner */}
            {feedback && (
              <div
                data-testid="git-operation-feedback"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  backgroundColor:
                    feedback.type === 'success' ? `${colors.success}1a` : `${colors.danger}1a`,
                  color: feedback.type === 'success' ? colors.success : colors.danger,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {feedback.type === 'success' ? (
                    <Check size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )}
                  {feedback.text}
                </span>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Main Split Body: Resizable Left (Commit + History) <-> Right (Monaco YAML Diff) */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <ResizableSplitPane
                testId="git-modal-split"
                direction="horizontal"
                initialSize={320}
                minSize={240}
                maxSize={560}
                firstPane={
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: colors.bgSecondary,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                    }}
                  >
                {/* Commit Section */}
                <div
                  style={{
                    padding: 12,
                    borderBottom: `1px solid ${colors.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.textPrimary }}>
                    Commit Changes
                  </div>

                  {isCollectionDirty && (
                    <div
                      data-testid="git-unsaved-dirty-notice"
                      style={{
                        fontSize: 11,
                        color: colors.warning,
                        backgroundColor: `${colors.warning}15`,
                        padding: '4px 8px',
                        borderRadius: 4,
                      }}
                    >
                      In-editor changes detected — committing will save <code>{fileName}</code>{' '}
                      first.
                    </div>
                  )}

                  {/* Commit Scope Selection */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        color: colors.textPrimary,
                      }}
                    >
                      <input
                        type="radio"
                        name="git-commit-scope"
                        data-testid="git-scope-collection-only"
                        checked={commitScope === 'collection_only'}
                        onChange={() => setCommitScope('collection_only')}
                      />
                      <span>
                        Collection file only (<code>{fileName}</code>)
                      </span>
                    </label>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        color: colors.textPrimary,
                      }}
                    >
                      <input
                        type="radio"
                        name="git-commit-scope"
                        data-testid="git-scope-folder"
                        checked={commitScope === 'folder'}
                        onChange={() => setCommitScope('folder')}
                      />
                      <span>
                        All folder changes ({status?.folderChangedFiles.length ?? 0} file(s))
                      </span>
                    </label>
                  </div>

                  <textarea
                    aria-label="Commit message"
                    data-testid="git-commit-message-input"
                    placeholder={`Update ${collection?.metadata.name ?? fileName}...`}
                    rows={3}
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgPrimary,
                      color: colors.textPrimary,
                      fontSize: 12,
                      resize: 'vertical',
                      fontFamily: 'inherit',
                    }}
                  />

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      data-testid="git-commit-submit-btn"
                      disabled={!commitMessage.trim() || busyAction === 'commit'}
                      onClick={() => void handleCommit()}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: commitMessage.trim() ? colors.accent : colors.border,
                        color: commitMessage.trim() ? '#ffffff' : colors.textSecondary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: commitMessage.trim() ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <GitCommit size={14} />
                      {busyAction === 'commit' ? 'Committing…' : 'Commit .awjc Changes'}
                    </button>

                    <button
                      type="button"
                      data-testid="git-revert-btn"
                      disabled={
                        busyAction !== null ||
                        (!diff?.hasChanges &&
                          !isCollectionDirty &&
                          status?.fileStatus !== 'modified' &&
                          status?.fileStatus !== 'staged')
                      }
                      onClick={() => setConfirmingRevertRef(selectedCommitRef)}
                      title={
                        selectedCommitRef === 'HEAD'
                          ? 'Discard uncommitted changes and revert .awjc to HEAD'
                          : `Restore .awjc collection to revision ${selectedCommitRef.slice(0, 7)}`
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: `1px solid ${colors.border}`,
                        backgroundColor: colors.bgPrimary,
                        color:
                          diff?.hasChanges ||
                          isCollectionDirty ||
                          status?.fileStatus === 'modified' ||
                          status?.fileStatus === 'staged'
                            ? colors.danger
                            : colors.textMuted,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor:
                          diff?.hasChanges ||
                          isCollectionDirty ||
                          status?.fileStatus === 'modified' ||
                          status?.fileStatus === 'staged'
                            ? 'pointer'
                            : 'not-allowed',
                      }}
                    >
                      <RotateCcw size={13} />
                      {busyAction === 'revert'
                        ? 'Reverting…'
                        : selectedCommitRef === 'HEAD'
                          ? 'Revert'
                          : `Restore ${selectedCommitRef.slice(0, 7)}`}
                    </button>
                  </div>

                  {confirmingRevertRef !== null && (
                    <div
                      data-testid="git-revert-confirm-prompt"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px solid ${colors.danger}66`,
                        backgroundColor: `${colors.danger}14`,
                        fontSize: 11,
                        color: colors.textPrimary,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <AlertTriangle
                          size={14}
                          color={colors.danger}
                          style={{ flexShrink: 0, marginTop: 1 }}
                        />
                        <span>
                          {confirmingRevertRef === 'HEAD' ? (
                            <>
                              Discard all uncommitted changes in <code>{fileName}</code> and revert
                              to <code>HEAD</code>? This cannot be undone.
                            </>
                          ) : (
                            <>
                              Restore <code>{fileName}</code> to revision{' '}
                              <code>{confirmingRevertRef.slice(0, 7)}</code>? Uncommitted changes in
                              this collection will be replaced.
                            </>
                          )}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          type="button"
                          data-testid="git-cancel-revert-btn"
                          onClick={() => setConfirmingRevertRef(null)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 5,
                            border: `1px solid ${colors.border}`,
                            backgroundColor: colors.bgPrimary,
                            color: colors.textPrimary,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid="git-confirm-revert-btn"
                          onClick={() => void handleRevert(confirmingRevertRef)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 5,
                            border: 'none',
                            backgroundColor: colors.danger,
                            color: '#ffffff',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {confirmingRevertRef === 'HEAD'
                            ? 'Confirm Revert'
                            : `Restore ${confirmingRevertRef.slice(0, 7)}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Commit History List */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      borderBottom: `1px solid ${colors.border}`,
                    }}
                  >
                    <History size={12} />
                    Compare Revision vs. Working Copy
                  </div>

                  <div
                    data-testid="git-history-list"
                    style={{ flex: 1, overflowY: 'auto', padding: 6 }}
                  >
                    <button
                      type="button"
                      data-testid="git-diff-ref-HEAD"
                      onClick={() => void handleSelectCommitRef('HEAD')}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '7px 8px',
                        borderRadius: 5,
                        border: `1px solid ${
                          selectedCommitRef === 'HEAD' ? colors.accent : 'transparent'
                        }`,
                        backgroundColor:
                          selectedCommitRef === 'HEAD' ? `${colors.accent}1f` : 'transparent',
                        color: colors.textPrimary,
                        cursor: 'pointer',
                        marginBottom: 4,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Working Copy vs. HEAD (Latest)
                    </button>

                    {commits.map(c => {
                      const isSelected = selectedCommitRef === c.hash;
                      return (
                        <button
                          key={c.hash}
                          type="button"
                          data-testid={`git-commit-item-${c.shortHash}`}
                          onClick={() => void handleSelectCommitRef(c.hash)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '7px 8px',
                            borderRadius: 5,
                            border: `1px solid ${isSelected ? colors.accent : 'transparent'}`,
                            backgroundColor: isSelected ? `${colors.accent}1f` : 'transparent',
                            color: colors.textPrimary,
                            cursor: 'pointer',
                            marginBottom: 2,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.subject}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: colors.textMuted,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span style={{ fontFamily: 'monospace' }}>{c.shortHash}</span>
                            <span>{c.author}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
                }
                secondPane={
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                    }}
                  >
                <div
                  style={{
                    padding: '8px 14px',
                    borderBottom: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: 600, color: colors.textPrimary }}>
                    <code>{selectedCommitRef === 'HEAD' ? 'HEAD' : selectedCommitRef.slice(0, 7)}</code>{' '}
                    ↔ <code>Working Copy ({fileName})</code>
                  </span>
                  <span
                    data-testid="git-diff-change-summary"
                    style={{
                      fontSize: 11,
                      color: diff?.hasChanges ? colors.warning : colors.success,
                      fontWeight: 600,
                    }}
                  >
                    {diff?.hasChanges
                      ? 'Changes detected in .awjc YAML'
                      : `Working copy matches ${selectedCommitRef === 'HEAD' ? 'HEAD' : selectedCommitRef.slice(0, 7)}`}
                  </span>
                </div>

                <div
                  data-testid="git-yaml-diff-viewer"
                  style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto' }}
                >
                  {isTestEnv ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        padding: 12,
                        height: '100%',
                      }}
                    >
                      <pre
                        data-testid="git-diff-original"
                        style={{
                          margin: 0,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {diff?.headContent ?? ''}
                      </pre>
                      <pre
                        data-testid="git-diff-modified"
                        style={{
                          margin: 0,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {diff?.workingContent ?? ''}
                      </pre>
                    </div>
                  ) : (
                    <DiffEditor
                      height="100%"
                      language="yaml"
                      theme={isLight ? 'light' : 'vs-dark'}
                      original={diff?.headContent ?? ''}
                      modified={diff?.workingContent ?? ''}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                      }}
                    />
                  )}
                </div>
              </div>
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
