import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Edit3,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  MoreVertical,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AwjcCollection,
  CollectionTreeItem,
  FolderItem,
  RequestItem,
} from '../../../shared/collectionSchema';
import type { GitCollectionStatus } from '../../../shared/gitTypes';
import { getGitFileStateBadge } from './GitSourceControlModal';
import { useTheme } from '../context/ThemeContext';

export interface WorkspaceCollectionEntry {
  filePath: string;
  collection: AwjcCollection;
  isDirty?: boolean;
}

export interface RequestHistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  protocol: 'http' | 'graphql';
  url: string;
  status?: number;
  durationMs?: number;
  requestSnapshot?: RequestItem;
}

export interface CollectionSidebarProps {
  collections: WorkspaceCollectionEntry[];
  activeCollectionPath?: string | null;
  activeRequestId?: string | null;
  historyEntries?: RequestHistoryEntry[];
  onSelectCollection: (filePath: string) => void;
  onSelectRequest: (collectionPath: string, request: RequestItem) => void;
  onSelectHistoryEntry?: (entry: RequestHistoryEntry) => void;
  onSaveHistoryEntryToCollection?: (entry: RequestHistoryEntry) => void;
  onClearHistory?: () => void;
  onNewCollection: () => void;
  onImportCollection: () => void;
  onImportOpenApi?: () => void;
  onRunCollection?: (collectionPath: string, folderId?: string) => void;
  onSaveCollection: (collectionPath: string) => void;
  onSaveCollectionAs: (collectionPath: string) => void;
  onRevealInOs?: (collectionPath: string) => void;
  onCloseCollection?: (collectionPath: string) => void;
  onNewHttpRequest: (collectionPath: string, parentFolderId?: string) => void;
  onNewGraphQLRequest: (collectionPath: string, parentFolderId?: string) => void;
  onNewFolder: (collectionPath: string, parentFolderId?: string) => void;
  onDuplicateItem: (collectionPath: string, itemId: string) => void;
  onRenameCollection?: (collectionPath: string, newName: string) => void;
  onRenameItem: (collectionPath: string, itemId: string, newName: string) => void;
  onDeleteItem: (collectionPath: string, itemId: string) => void;
  onGenerateCodeForRequest?: (collectionPath: string, request: RequestItem) => void;
  gitStatusByCollectionPath?: Record<string, GitCollectionStatus>;
  onOpenGitSourceControl?: (collectionPath: string) => void;
}

export function getMethodBadgeColor(method: string, protocol: 'http' | 'graphql'): string {
  if (protocol === 'graphql' || method.toUpperCase() === 'GRAPHQL') {
    return '#e11d48'; // GraphQL magenta/pink
  }
  switch (method.toUpperCase()) {
    case 'GET':
      return '#22c55e';
    case 'POST':
      return '#f59e0b';
    case 'PUT':
      return '#3b82f6';
    case 'PATCH':
      return '#a855f7';
    case 'DELETE':
      return '#ef4444';
    default:
      return '#64748b';
  }
}

export function getMethodBadgeLabel(method: string, protocol: 'http' | 'graphql'): string {
  if (protocol === 'graphql') return 'GQL';
  return method.toUpperCase();
}

function filterTreeItems(items: CollectionTreeItem[], query: string): CollectionTreeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const result: CollectionTreeItem[] = [];
  for (const item of items) {
    if (item.kind === 'request') {
      const matches =
        item.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        item.method.toLowerCase().includes(q);
      if (matches) {
        result.push(item);
      }
    } else if (item.kind === 'folder') {
      const filteredChildren = filterTreeItems(item.items, q);
      if (item.name.toLowerCase().includes(q) || filteredChildren.length > 0) {
        result.push({
          ...item,
          items: filteredChildren,
        });
      }
    }
  }
  return result;
}

const MIN_COLLECTION_HEIGHT = 96;
const DEFAULT_COLLECTION_HEIGHT = 240;
const MAX_COLLECTION_HEIGHT = 900;

export const CollectionSidebar: React.FC<CollectionSidebarProps> = ({
  collections,
  activeCollectionPath,
  activeRequestId,
  historyEntries = [],
  onSelectCollection,
  onSelectRequest,
  onSelectHistoryEntry,
  onSaveHistoryEntryToCollection,
  onClearHistory,
  onNewCollection,
  onImportCollection,
  onImportOpenApi,
  onRunCollection,
  onSaveCollection,
  onSaveCollectionAs,
  onRevealInOs,
  onCloseCollection,
  onNewHttpRequest,
  onNewGraphQLRequest,
  onNewFolder,
  onDuplicateItem,
  onRenameCollection,
  onRenameItem,
  onDeleteItem,
  onGenerateCodeForRequest,
  gitStatusByCollectionPath = {},
  onOpenGitSourceControl,
}) => {
  const { colors, isLight } = useTheme();
  const [mode, setMode] = useState<'collections' | 'history'>('collections');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [collectionHeights, setCollectionHeights] = useState<Record<string, number>>({});
  const [draggingSplitterIndex, setDraggingSplitterIndex] = useState<number | null>(null);

  const collectionListRef = useRef<HTMLUListElement | null>(null);
  const collectionNodeRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const dragStateRef = useRef<{
    index: number;
    topId: string;
    bottomId: string;
    startY: number;
    topStartHeight: number;
    bottomStartHeight?: number;
    isBottomLastExpanded: boolean;
  } | null>(null);

  const handleSplitterMouseDown = useCallback(
    (index: number, e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      const topEntry = collections[index];
      const bottomEntry = collections[index + 1];
      if (!topEntry || !bottomEntry) return;

      const topId = topEntry.collection.metadata.id || topEntry.filePath;
      const bottomId = bottomEntry.collection.metadata.id || bottomEntry.filePath;

      if (collapsedIds[topId] || collapsedIds[bottomId]) return;

      const topRectHeight =
        collectionNodeRefs.current[topId]?.getBoundingClientRect().height ?? 0;
      const topStartHeight =
        topRectHeight > 0
          ? Math.round(topRectHeight)
          : (collectionHeights[topId] ?? DEFAULT_COLLECTION_HEIGHT);

      let lastExpandedIdx = -1;
      for (let i = collections.length - 1; i >= 0; i--) {
        const cId = collections[i].collection.metadata.id || collections[i].filePath;
        if (!collapsedIds[cId]) {
          lastExpandedIdx = i;
          break;
        }
      }
      const isBottomLastExpanded = index + 1 === lastExpandedIdx;

      const bottomRectHeight =
        collectionNodeRefs.current[bottomId]?.getBoundingClientRect().height ?? 0;
      const bottomStartHeight = isBottomLastExpanded
        ? undefined
        : bottomRectHeight > 0
          ? Math.round(bottomRectHeight)
          : collectionHeights[bottomId];

      dragStateRef.current = {
        index,
        topId,
        bottomId,
        startY: e.clientY,
        topStartHeight,
        bottomStartHeight,
        isBottomLastExpanded,
      };
      setDraggingSplitterIndex(index);
    },
    [collections, collapsedIds, collectionHeights],
  );

  const handleSplitterDoubleClick = useCallback(
    (index: number) => {
      const topEntry = collections[index];
      const bottomEntry = collections[index + 1];
      if (!topEntry || !bottomEntry) return;
      const topId = topEntry.collection.metadata.id || topEntry.filePath;
      const bottomId = bottomEntry.collection.metadata.id || bottomEntry.filePath;

      setCollectionHeights(prev => {
        const next = { ...prev };
        delete next[topId];
        delete next[bottomId];
        return next;
      });
    },
    [collections],
  );

  useEffect(() => {
    if (draggingSplitterIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const delta = e.clientY - dragState.startY;
      const listRectHeight =
        collectionListRef.current?.getBoundingClientRect().height ?? 0;
      const effectiveMax =
        listRectHeight > MIN_COLLECTION_HEIGHT * 2
          ? listRectHeight - MIN_COLLECTION_HEIGHT
          : MAX_COLLECTION_HEIGHT;

      const nextTopHeight = Math.max(
        MIN_COLLECTION_HEIGHT,
        Math.min(effectiveMax, Math.round(dragState.topStartHeight + delta)),
      );

      setCollectionHeights(prev => {
        const next: Record<string, number> = {
          ...prev,
          [dragState.topId]: nextTopHeight,
        };
        if (dragState.isBottomLastExpanded) {
          delete next[dragState.bottomId];
        } else if (dragState.bottomStartHeight !== undefined) {
          const actualDelta = nextTopHeight - dragState.topStartHeight;
          next[dragState.bottomId] = Math.max(
            MIN_COLLECTION_HEIGHT,
            Math.round(dragState.bottomStartHeight - actualDelta),
          );
        }
        return next;
      });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      setDraggingSplitterIndex(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingSplitterIndex]);

  useEffect(() => {
    if (!openMenuId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-sidebar-context-menu], [data-sidebar-menu-trigger]')) {
        return;
      }
      setOpenMenuId(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameDraft(currentName);
    setOpenMenuId(null);
  };

  const commitRename = (collectionPath: string, itemId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameItem(collectionPath, itemId, trimmed);
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  const commitCollectionRename = (collectionPath: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameCollection?.(collectionPath, trimmed);
    }
    setRenamingId(null);
    setRenameDraft('');
  };

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return historyEntries;
    return historyEntries.filter(
      h =>
        h.url.toLowerCase().includes(q) ||
        h.method.toLowerCase().includes(q) ||
        (h.requestSnapshot?.name?.toLowerCase().includes(q) ?? false),
    );
  }, [historyEntries, searchQuery]);

  const renderTreeItem = (
    collectionPath: string,
    item: CollectionTreeItem,
    depth: number,
  ): React.ReactNode => {
    const isMenuOpen = openMenuId === item.id;
    const isRenaming = renamingId === item.id;

    if (item.kind === 'folder') {
      const folder = item as FolderItem;
      const isCollapsed = Boolean(collapsedIds[folder.id]);

      return (
        <div key={folder.id} data-testid={`tree-folder-${folder.id}`}>
          <div
            onContextMenu={e => {
              e.preventDefault();
              setOpenMenuId(isMenuOpen ? null : folder.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 8px',
              paddingLeft: 8 + depth * 14,
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 12,
              color: colors.textPrimary,
              position: 'relative',
            }}
          >
            <div
              onClick={() => toggleCollapse(folder.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {isCollapsed ? (
                <Folder size={13} color={colors.accent} />
              ) : (
                <FolderOpen size={13} color={colors.accent} />
              )}
              {isRenaming ? (
                <input
                  type="text"
                  data-testid={`rename-input-${folder.id}`}
                  value={renameDraft}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onChange={e => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(collectionPath, folder.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(collectionPath, folder.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  style={{
                    fontSize: 12,
                    padding: '2px 4px',
                    borderRadius: 4,
                    border: `1px solid ${colors.accent}`,
                    backgroundColor: colors.bgPrimary,
                    color: colors.textPrimary,
                    width: '100%',
                  }}
                />
              ) : (
                <span
                  style={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {folder.name}
                </span>
              )}
            </div>

            <button
              type="button"
              data-sidebar-menu-trigger="true"
              data-testid={`item-menu-btn-${folder.id}`}
              aria-label={`Actions for ${folder.name}`}
              onClick={e => {
                e.stopPropagation();
                setOpenMenuId(isMenuOpen ? null : folder.id);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
              }}
            >
              <MoreVertical size={13} />
            </button>

            {isMenuOpen && (
              <div
                data-sidebar-context-menu="true"
                data-testid={`context-menu-${folder.id}`}
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 26,
                  zIndex: 30,
                  backgroundColor: colors.bgSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: 4,
                  minWidth: 165,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  data-testid={`menu-new-http-${folder.id}`}
                  onClick={() => {
                    setOpenMenuId(null);
                    onNewHttpRequest(collectionPath, folder.id);
                  }}
                  style={menuItemStyle(colors)}
                >
                  <Plus size={12} /> New HTTP Request
                </button>
                <button
                  type="button"
                  data-testid={`menu-new-gql-${folder.id}`}
                  onClick={() => {
                    setOpenMenuId(null);
                    onNewGraphQLRequest(collectionPath, folder.id);
                  }}
                  style={menuItemStyle(colors)}
                >
                  <Plus size={12} /> New GraphQL Request
                </button>
                <button
                  type="button"
                  data-testid={`menu-new-folder-${folder.id}`}
                  onClick={() => {
                    setOpenMenuId(null);
                    onNewFolder(collectionPath, folder.id);
                  }}
                  style={menuItemStyle(colors)}
                >
                  <FolderPlus size={12} /> New Folder
                </button>
                {onRunCollection && (
                  <button
                    type="button"
                    data-testid={`menu-run-folder-${folder.id}`}
                    onClick={() => {
                      setOpenMenuId(null);
                      onRunCollection(collectionPath, folder.id);
                    }}
                    style={menuItemStyle(colors)}
                  >
                    <Play size={12} /> Run Folder…
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`menu-duplicate-${folder.id}`}
                  onClick={() => {
                    setOpenMenuId(null);
                    onDuplicateItem(collectionPath, folder.id);
                  }}
                  style={menuItemStyle(colors)}
                >
                  <Copy size={12} /> Duplicate
                </button>
                <button
                  type="button"
                  data-testid={`menu-rename-${folder.id}`}
                  onClick={() => startRename(folder.id, folder.name)}
                  style={menuItemStyle(colors)}
                >
                  <Edit3 size={12} /> Rename
                </button>
                <button
                  type="button"
                  data-testid={`menu-delete-${folder.id}`}
                  onClick={() => {
                    setOpenMenuId(null);
                    onDeleteItem(collectionPath, folder.id);
                  }}
                  style={{ ...menuItemStyle(colors), color: colors.danger }}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>

          {!isCollapsed &&
            folder.items.map(child => renderTreeItem(collectionPath, child, depth + 1))}
        </div>
      );
    }

    const req = item as RequestItem;
    const isActive = activeRequestId === req.id;
    const badgeColor = getMethodBadgeColor(req.method, req.protocol);
    const badgeLabel = getMethodBadgeLabel(req.method, req.protocol);

    return (
      <div
        key={req.id}
        data-testid={`tree-request-${req.id}`}
        onClick={() => onSelectRequest(collectionPath, req)}
        onContextMenu={e => {
          e.preventDefault();
          setOpenMenuId(isMenuOpen ? null : req.id);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 8px',
          paddingLeft: 12 + depth * 14,
          borderRadius: 5,
          cursor: 'pointer',
          fontSize: 12,
          backgroundColor: isActive ? (isLight ? '#e2e8f0' : '#1e293b') : 'transparent',
          color: colors.textPrimary,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span
            data-testid={`request-badge-${req.id}`}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 4,
              backgroundColor: `${badgeColor}22`,
              color: badgeColor,
              minWidth: 36,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {badgeLabel}
          </span>

          {isRenaming ? (
            <input
              type="text"
              data-testid={`rename-input-${req.id}`}
              value={renameDraft}
              autoFocus
              onClick={e => e.stopPropagation()}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(collectionPath, req.id)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename(collectionPath, req.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              style={{
                fontSize: 12,
                padding: '2px 4px',
                borderRadius: 4,
                border: `1px solid ${colors.accent}`,
                backgroundColor: colors.bgPrimary,
                color: colors.textPrimary,
                width: '100%',
              }}
            />
          ) : (
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {req.name}
            </span>
          )}
        </div>

        <button
          type="button"
          data-sidebar-menu-trigger="true"
          data-testid={`item-menu-btn-${req.id}`}
          aria-label={`Actions for ${req.name}`}
          onClick={e => {
            e.stopPropagation();
            setOpenMenuId(isMenuOpen ? null : req.id);
          }}
          style={{
            border: 'none',
            background: 'transparent',
            color: colors.textSecondary,
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
          }}
        >
          <MoreVertical size={13} />
        </button>

        {isMenuOpen && (
          <div
            data-sidebar-context-menu="true"
            data-testid={`context-menu-${req.id}`}
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 8,
              top: 26,
              zIndex: 30,
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 4,
              minWidth: 150,
              boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {onGenerateCodeForRequest && (
              <button
                type="button"
                data-testid={`menu-generate-code-${req.id}`}
                onClick={() => {
                  setOpenMenuId(null);
                  onGenerateCodeForRequest(collectionPath, req);
                }}
                style={menuItemStyle(colors)}
              >
                <Code2 size={12} /> Generate Code Snippet…
              </button>
            )}
            <button
              type="button"
              data-testid={`menu-duplicate-${req.id}`}
              onClick={() => {
                setOpenMenuId(null);
                onDuplicateItem(collectionPath, req.id);
              }}
              style={menuItemStyle(colors)}
            >
              <Copy size={12} /> Duplicate
            </button>
            <button
              type="button"
              data-testid={`menu-rename-${req.id}`}
              onClick={() => startRename(req.id, req.name)}
              style={menuItemStyle(colors)}
            >
              <Edit3 size={12} /> Rename
            </button>
            <button
              type="button"
              data-testid={`menu-delete-${req.id}`}
              onClick={() => {
                setOpenMenuId(null);
                onDeleteItem(collectionPath, req.id);
              }}
              style={{ ...menuItemStyle(colors), color: colors.danger }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      data-testid="collections-sidebar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: colors.bgPrimary,
        borderRight: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Mode Switcher: Collections | History */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${colors.border}`,
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            borderRadius: 6,
            padding: 2,
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
          }}
        >
          <button
            type="button"
            data-testid="sidebar-mode-collections"
            onClick={() => setMode('collections')}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: mode === 'collections' ? colors.accent : 'transparent',
              color: mode === 'collections' ? '#ffffff' : colors.textSecondary,
            }}
          >
            Collections
          </button>
          <button
            type="button"
            data-testid="sidebar-mode-history"
            onClick={() => setMode('history')}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: mode === 'history' ? colors.accent : 'transparent',
              color: mode === 'history' ? '#ffffff' : colors.textSecondary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Clock size={12} />
            History
          </button>
        </div>

        {/* New & Open Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            data-testid="sidebar-new-collection-btn"
            onClick={onNewCollection}
            title="New Collection"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textPrimary,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <Plus size={12} />
            New
          </button>
          <button
            type="button"
            data-testid="open-collection-btn"
            onClick={onImportCollection}
            title="Open Collection (.awjc / .awj)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textPrimary,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={12} />
            Open
          </button>
        </div>
      </div>

      {/* Live Search / Filter Input */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${colors.border}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <Search size={13} color={colors.textSecondary} />
          <input
            type="text"
            aria-label="Filter collections or history"
            data-testid="sidebar-search-input"
            placeholder={
              mode === 'collections' ? 'Filter requests & folders...' : 'Filter history...'
            }
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              color: colors.textPrimary,
              fontSize: 12,
              outline: 'none',
              width: '100%',
            }}
          />
        </div>
      </div>

      {/* Content Area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflowY: mode === 'collections' ? 'hidden' : 'auto',
          padding: 8,
        }}
      >
        {mode === 'collections' ? (
          collections.length === 0 ? (
            <div
              data-testid="empty-collections-msg"
              style={{ fontSize: 12, color: colors.textSecondary, padding: 8 }}
            >
              Double-click any <code>.awjc</code> or <code>.awj</code> file or click Open to load a
              collection.
            </div>
          ) : (
            <ul
              ref={collectionListRef}
              data-testid="collection-list"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              {collections.map((entry, index) => {
                const colId = entry.collection.metadata.id || entry.filePath;
                const isCollapsed = Boolean(collapsedIds[colId]);
                const isSelected = activeCollectionPath === entry.filePath;
                const isColMenuOpen = openMenuId === `col:${entry.filePath}`;
                const isColRenaming = renamingId === `col:${entry.filePath}`;
                const filteredItems = filterTreeItems(entry.collection.items, searchQuery);
                const customHeight =
                  !isCollapsed && collections.length > 1 ? collectionHeights[colId] : undefined;

                const nextEntry = collections[index + 1];
                const nextColId = nextEntry
                  ? nextEntry.collection.metadata.id || nextEntry.filePath
                  : null;
                const isNextCollapsed = nextColId ? Boolean(collapsedIds[nextColId]) : false;
                const isSplitterDisabled = isCollapsed || isNextCollapsed;
                const isDraggingThisSplitter = draggingSplitterIndex === index;

                return (
                  <React.Fragment key={entry.filePath}>
                    <li
                      ref={el => {
                        collectionNodeRefs.current[colId] = el;
                      }}
                      data-testid={`collection-node-${entry.collection.metadata.id}`}
                      style={{
                        borderRadius: 6,
                        border: `1px solid ${isSelected ? colors.accent : colors.border}`,
                        backgroundColor: colors.bgSecondary,
                        display: 'flex',
                        flexDirection: 'column',
                        ...(isCollapsed
                          ? {
                              flex: '0 0 auto',
                            }
                          : customHeight !== undefined
                            ? {
                                height: customHeight,
                                minHeight: MIN_COLLECTION_HEIGHT,
                                flexShrink: 0,
                                flexGrow: 0,
                              }
                            : {
                                flex: '1 1 0%',
                                minHeight: MIN_COLLECTION_HEIGHT,
                              }),
                      }}
                    >
                      {/* Collection Header */}
                      <div
                        onClick={() => onSelectCollection(entry.filePath)}
                        onContextMenu={e => {
                          e.preventDefault();
                          setOpenMenuId(isColMenuOpen ? null : `col:${entry.filePath}`);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          cursor: 'pointer',
                          position: 'relative',
                          flexShrink: 0,
                        }}
                      >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <button
                          type="button"
                          data-testid={`toggle-collection-${entry.collection.metadata.id}`}
                          onClick={e => {
                            e.stopPropagation();
                            toggleCollapse(colId);
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                          }}
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                        {isColRenaming ? (
                          <input
                            type="text"
                            data-testid={`rename-collection-input-${entry.collection.metadata.id}`}
                            value={renameDraft}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenameDraft(e.target.value)}
                            onBlur={() => commitCollectionRename(entry.filePath)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitCollectionRename(entry.filePath);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '2px 4px',
                              borderRadius: 4,
                              border: `1px solid ${colors.accent}`,
                              backgroundColor: colors.bgPrimary,
                              color: colors.textPrimary,
                              width: '100%',
                            }}
                          />
                        ) : (
                          <span
                            title={entry.filePath}
                            onDoubleClick={e => {
                              e.stopPropagation();
                              startRename(`col:${entry.filePath}`, entry.collection.metadata.name);
                            }}
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {entry.collection.metadata.name}
                            {entry.isDirty ? ' •' : ''}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {onOpenGitSourceControl && (
                          <button
                            type="button"
                            data-testid={`collection-git-badge-${entry.collection.metadata.id}`}
                            title={
                              gitStatusByCollectionPath[entry.filePath]?.isGitRepo
                                ? `Git: ${gitStatusByCollectionPath[entry.filePath].branch} (${getGitFileStateBadge(gitStatusByCollectionPath[entry.filePath].fileStatus, entry.isDirty).label}) — Click for Diff & Source Control`
                                : 'Git Source Control & YAML Diff'
                            }
                            onClick={e => {
                              e.stopPropagation();
                              onOpenGitSourceControl(entry.filePath);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: `1px solid ${colors.border}`,
                              backgroundColor: colors.bgPrimary,
                              color: colors.textSecondary,
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                              marginRight: 2,
                            }}
                          >
                            <GitBranch size={11} color={colors.accent} />
                            {gitStatusByCollectionPath[entry.filePath]?.isGitRepo ? (
                              <>
                                <span>{gitStatusByCollectionPath[entry.filePath].branch}</span>
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    backgroundColor: getGitFileStateBadge(
                                      gitStatusByCollectionPath[entry.filePath].fileStatus,
                                      entry.isDirty,
                                    ).color,
                                    display: 'inline-block',
                                  }}
                                />
                              </>
                            ) : (
                              <span>Git</span>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid={`collection-save-btn-${entry.collection.metadata.id}`}
                          title="Save Collection (Cmd/Ctrl+S)"
                          onClick={e => {
                            e.stopPropagation();
                            onSaveCollection(entry.filePath);
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            padding: 3,
                            display: 'inline-flex',
                          }}
                        >
                          <Save size={13} />
                        </button>

                        <button
                          type="button"
                          data-sidebar-menu-trigger="true"
                          data-testid={`collection-menu-btn-${entry.collection.metadata.id}`}
                          aria-label={`Collection menu for ${entry.collection.metadata.name}`}
                          onClick={e => {
                            e.stopPropagation();
                            setOpenMenuId(isColMenuOpen ? null : `col:${entry.filePath}`);
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            padding: 3,
                            display: 'inline-flex',
                          }}
                        >
                          <MoreVertical size={13} />
                        </button>
                      </div>

                      {isColMenuOpen && (
                        <div
                          data-sidebar-context-menu="true"
                          data-testid={`collection-context-menu-${entry.collection.metadata.id}`}
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute',
                            right: 8,
                            top: 30,
                            zIndex: 35,
                            backgroundColor: colors.bgSecondary,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 6,
                            padding: 4,
                            minWidth: 175,
                            boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          <button
                            type="button"
                            data-testid={`col-menu-new-http-${entry.collection.metadata.id}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onNewHttpRequest(entry.filePath);
                            }}
                            style={menuItemStyle(colors)}
                          >
                            <Plus size={12} /> New HTTP Request
                          </button>
                          <button
                            type="button"
                            data-testid={`col-menu-new-gql-${entry.collection.metadata.id}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onNewGraphQLRequest(entry.filePath);
                            }}
                            style={menuItemStyle(colors)}
                          >
                            <Plus size={12} /> New GraphQL Request
                          </button>
                          <button
                            type="button"
                            data-testid={`col-menu-new-folder-${entry.collection.metadata.id}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onNewFolder(entry.filePath);
                            }}
                            style={menuItemStyle(colors)}
                          >
                            <FolderPlus size={12} /> New Folder
                          </button>
                          {onRunCollection && (
                            <button
                              type="button"
                              data-testid={`col-menu-run-${entry.collection.metadata.id}`}
                              onClick={() => {
                                setOpenMenuId(null);
                                onRunCollection(entry.filePath);
                              }}
                              style={menuItemStyle(colors)}
                            >
                              <Play size={12} /> Run Collection…
                            </button>
                          )}
                          {onOpenGitSourceControl && (
                            <button
                              type="button"
                              data-testid={`col-menu-git-${entry.collection.metadata.id}`}
                              onClick={() => {
                                setOpenMenuId(null);
                                onOpenGitSourceControl(entry.filePath);
                              }}
                              style={menuItemStyle(colors)}
                            >
                              <GitBranch size={12} /> Git Source Control &amp; Diff…
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid={`col-menu-rename-${entry.collection.metadata.id}`}
                            onClick={() =>
                              startRename(`col:${entry.filePath}`, entry.collection.metadata.name)
                            }
                            style={menuItemStyle(colors)}
                          >
                            <Edit3 size={12} /> Rename
                          </button>
                          <button
                            type="button"
                            data-testid={`col-menu-save-${entry.collection.metadata.id}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onSaveCollection(entry.filePath);
                            }}
                            style={menuItemStyle(colors)}
                          >
                            <Save size={12} /> Save Collection
                          </button>
                          <button
                            type="button"
                            data-testid={`col-menu-save-as-${entry.collection.metadata.id}`}
                            onClick={() => {
                              setOpenMenuId(null);
                              onSaveCollectionAs(entry.filePath);
                            }}
                            style={menuItemStyle(colors)}
                          >
                            <Save size={12} /> Save Collection As…
                          </button>
                          {onRevealInOs && (
                            <button
                              type="button"
                              data-testid={`col-menu-reveal-${entry.collection.metadata.id}`}
                              onClick={() => {
                                setOpenMenuId(null);
                                onRevealInOs(entry.filePath);
                              }}
                              style={menuItemStyle(colors)}
                            >
                              <FolderOpen size={12} /> Reveal in Finder/Explorer
                            </button>
                          )}
                          {onCloseCollection && (
                            <>
                              <div
                                style={{
                                  height: 1,
                                  backgroundColor: colors.border,
                                  margin: '2px 0',
                                }}
                              />
                              <button
                                type="button"
                                data-testid={`col-menu-close-${entry.collection.metadata.id}`}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onCloseCollection(entry.filePath);
                                }}
                                style={{ ...menuItemStyle(colors), color: colors.danger }}
                              >
                                <Trash2 size={12} /> Remove / Close Collection
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Subtitle path */}
                    <div
                      style={{
                        fontSize: 10,
                        color: colors.textMuted,
                        padding: '0 8px 4px 26px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {entry.filePath}
                    </div>

                    {/* Nested Tree */}
                    {!isCollapsed && (
                      <div
                        data-testid={`collection-tree-${entry.collection.metadata.id}`}
                        style={{
                          padding: '2px 4px 6px 4px',
                          flex: 1,
                          minHeight: 0,
                          overflowY: 'auto',
                          overflowX: 'hidden',
                        }}
                      >
                        {filteredItems.map(item => renderTreeItem(entry.filePath, item, 0))}
                      </div>
                    )}
                    </li>

                    {index < collections.length - 1 && (
                      <li
                        role="separator"
                        aria-orientation="horizontal"
                        data-testid={`collection-splitter-${index}`}
                        onMouseDown={e => handleSplitterMouseDown(index, e)}
                        onDoubleClick={() => handleSplitterDoubleClick(index)}
                        title="Drag to resize collections • Double-click to reset"
                        style={{
                          height: 6,
                          margin: '3px 0',
                          borderRadius: 3,
                          cursor: isSplitterDisabled ? 'default' : 'row-resize',
                          backgroundColor: isDraggingThisSplitter ? colors.accent : colors.border,
                          flexShrink: 0,
                          userSelect: 'none',
                          transition: isDraggingThisSplitter
                            ? 'none'
                            : 'background-color 0.12s ease',
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </ul>
          )
        ) : (
          /* History View */
          <div data-testid="sidebar-history-view">
            {filteredHistory.length === 0 ? (
              <div
                data-testid="empty-history-msg"
                style={{ fontSize: 12, color: colors.textSecondary, padding: 8 }}
              >
                No request history yet. Send a request to record it here.
              </div>
            ) : (
              <div>
                {onClearHistory && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                    <button
                      type="button"
                      data-testid="clear-history-btn"
                      onClick={onClearHistory}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: colors.textSecondary,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Clear History
                    </button>
                  </div>
                )}
                <ul
                  data-testid="history-list"
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {filteredHistory.map(entry => {
                    const badgeColor = getMethodBadgeColor(entry.method, entry.protocol);
                    return (
                      <li
                        key={entry.id}
                        data-testid={`history-entry-${entry.id}`}
                        onClick={() => onSelectHistoryEntry?.(entry)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          padding: '6px 8px',
                          borderRadius: 5,
                          backgroundColor: colors.bgSecondary,
                          border: `1px solid ${colors.border}`,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            backgroundColor: `${badgeColor}22`,
                            color: badgeColor,
                            minWidth: 34,
                            textAlign: 'center',
                          }}
                        >
                          {getMethodBadgeLabel(entry.method, entry.protocol)}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {entry.url}
                        </span>
                        {entry.status !== undefined && (
                          <span
                            data-testid={`history-status-badge-${entry.id}`}
                            style={{
                              fontSize: 10,
                              color:
                                entry.status >= 200 && entry.status < 300
                                  ? colors.success
                                  : colors.danger,
                            }}
                          >
                            {entry.status}
                          </span>
                        )}
                        {entry.durationMs !== undefined && (
                          <span
                            data-testid={`history-duration-${entry.id}`}
                            style={{ fontSize: 10, color: colors.textSecondary }}
                          >
                            {Math.round(entry.durationMs)}ms
                          </span>
                        )}
                        {onSaveHistoryEntryToCollection && (
                          <button
                            type="button"
                            data-testid={`history-save-to-col-btn-${entry.id}`}
                            title="Save to Collection"
                            onClick={e => {
                              e.stopPropagation();
                              onSaveHistoryEntryToCollection(entry);
                            }}
                            style={{
                              border: `1px solid ${colors.border}`,
                              borderRadius: 4,
                              backgroundColor: colors.bgPrimary,
                              color: colors.textSecondary,
                              fontSize: 10,
                              padding: '1px 5px',
                              cursor: 'pointer',
                            }}
                          >
                            Save
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

function menuItemStyle(colors: { textPrimary: string }): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: colors.textPrimary,
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  };
}
