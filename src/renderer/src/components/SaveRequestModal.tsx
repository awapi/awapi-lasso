import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Save,
  X,
} from 'lucide-react';
import type {
  CollectionTreeItem,
  FolderItem,
  RequestItem,
} from '../../../shared/collectionSchema';
import type { WorkspaceCollectionEntry } from './CollectionSidebar';
import { useTheme } from '../context/ThemeContext';

export interface SaveRequestModalProps {
  isOpen: boolean;
  request: RequestItem;
  collections: WorkspaceCollectionEntry[];
  activeCollectionPath: string | null;
  onCreateCollection: (name: string) => string;
  onOpenCollectionDialog: () => Promise<string | null>;
  onCreateFolder: (
    collectionPath: string,
    folderName: string,
    parentFolderId: string | null,
  ) => string;
  onConfirmSave: (options: {
    collectionPath: string;
    parentFolderId: string | null;
    requestName: string;
  }) => void;
  onClose: () => void;
}

function findFolderTrail(
  items: CollectionTreeItem[],
  targetFolderId: string,
  trail: string[] = [],
): string[] | null {
  for (const item of items) {
    if (item.kind === 'folder') {
      const nextTrail = [...trail, item.name];
      if (item.id === targetFolderId) {
        return nextTrail;
      }
      const childFound = findFolderTrail(item.items, targetFolderId, nextTrail);
      if (childFound) return childFound;
    }
  }
  return null;
}

export const SaveRequestModal: React.FC<SaveRequestModalProps> = ({
  isOpen,
  request,
  collections,
  activeCollectionPath,
  onCreateCollection,
  onOpenCollectionDialog,
  onCreateFolder,
  onConfirmSave,
  onClose,
}) => {
  const { colors, isLight } = useTheme();
  const backdropMouseDownRef = useRef<boolean>(false);
  const [requestName, setRequestName] = useState<string>(request.name || 'New HTTP Request');
  const [selectedCollectionPath, setSelectedCollectionPath] = useState<string | null>(
    activeCollectionPath ?? collections[0]?.filePath ?? null,
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  // Inline new collection creation
  const [isCreatingCollection, setIsCreatingCollection] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');

  // Inline new folder / subfolder creation
  const [creatingFolderParentId, setCreatingFolderParentId] = useState<
    string | null | undefined
  >(undefined);
  const [newFolderName, setNewFolderName] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setRequestName(request.name || 'New HTTP Request');
    const defaultColPath =
      activeCollectionPath && collections.some(c => c.filePath === activeCollectionPath)
        ? activeCollectionPath
        : (collections[0]?.filePath ?? null);
    setSelectedCollectionPath(defaultColPath);
    setSelectedFolderId(null);
    setIsCreatingCollection(false);
    setNewCollectionName('');
    setCreatingFolderParentId(undefined);
    setNewFolderName('');
  }, [isOpen, request.id, request.name]);

  // Keep selectedCollectionPath synced if collections change while open
  useEffect(() => {
    if (!isOpen) return;
    if (
      selectedCollectionPath &&
      collections.some(c => c.filePath === selectedCollectionPath)
    ) {
      return;
    }
    setSelectedCollectionPath(activeCollectionPath ?? collections[0]?.filePath ?? null);
    setSelectedFolderId(null);
  }, [isOpen, collections, activeCollectionPath, selectedCollectionPath]);

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

  const selectedCollectionEntry = useMemo(
    () => collections.find(c => c.filePath === selectedCollectionPath) ?? null,
    [collections, selectedCollectionPath],
  );

  const destinationBreadcrumb = useMemo(() => {
    if (!selectedCollectionEntry) return 'No collection selected';
    const colName = selectedCollectionEntry.collection.metadata.name;
    if (!selectedFolderId) {
      return `${colName} / (Collection Root)`;
    }
    const trail = findFolderTrail(selectedCollectionEntry.collection.items, selectedFolderId);
    return trail ? `${colName} / ${trail.join(' / ')}` : `${colName} / (Collection Root)`;
  }, [selectedCollectionEntry, selectedFolderId]);

  if (!isOpen) return null;

  const handleStartNewCollection = () => {
    setIsCreatingCollection(true);
    setNewCollectionName(`New Collection ${collections.length + 1}`);
  };

  const handleConfirmNewCollection = () => {
    const trimmed = newCollectionName.trim() || `New Collection ${collections.length + 1}`;
    const newPath = onCreateCollection(trimmed);
    setSelectedCollectionPath(newPath);
    setSelectedFolderId(null);
    setIsCreatingCollection(false);
    setNewCollectionName('');
  };

  const handleOpenExistingCollection = async () => {
    const openedPath = await onOpenCollectionDialog();
    if (openedPath) {
      setSelectedCollectionPath(openedPath);
      setSelectedFolderId(null);
    }
  };

  const handleStartNewFolder = (parentFolderId: string | null) => {
    setCreatingFolderParentId(parentFolderId);
    setNewFolderName('');
    if (parentFolderId) {
      setCollapsedFolders(prev => ({ ...prev, [parentFolderId]: false }));
    }
  };

  const handleConfirmNewFolder = () => {
    if (!selectedCollectionPath || creatingFolderParentId === undefined) return;
    const trimmed = newFolderName.trim() || 'New Folder';
    const createdFolderId = onCreateFolder(
      selectedCollectionPath,
      trimmed,
      creatingFolderParentId,
    );
    if (creatingFolderParentId) {
      setCollapsedFolders(prev => ({ ...prev, [creatingFolderParentId]: false }));
    }
    setSelectedFolderId(createdFolderId);
    setCreatingFolderParentId(undefined);
    setNewFolderName('');
  };

  const handleSave = () => {
    if (!selectedCollectionPath) return;
    onConfirmSave({
      collectionPath: selectedCollectionPath,
      parentFolderId: selectedFolderId,
      requestName: requestName.trim() || request.name || 'Untitled Request',
    });
  };

  const renderFolderTree = (items: CollectionTreeItem[], depth: number): React.ReactNode => {
    const folders = items.filter((item): item is FolderItem => item.kind === 'folder');
    return folders.map(folder => {
      const isSelected = selectedFolderId === folder.id;
      const isCollapsed = Boolean(collapsedFolders[folder.id]);
      const hasSubfolders = folder.items.some(child => child.kind === 'folder');
      const isCreatingChildHere = creatingFolderParentId === folder.id;

      return (
        <div key={folder.id} data-testid={`save-modal-folder-node-${folder.id}`}>
          <div
            data-testid={`save-modal-folder-item-${folder.id}`}
            data-selected={String(isSelected)}
            onClick={() => setSelectedFolderId(folder.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              paddingLeft: 10 + depth * 18,
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: isSelected
                ? isLight
                  ? '#dbeafe'
                  : 'rgba(59, 130, 246, 0.22)'
                : 'transparent',
              border: isSelected
                ? `1px solid ${colors.accent}`
                : '1px solid transparent',
              color: colors.textPrimary,
              fontSize: 12,
              marginBottom: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <button
                type="button"
                aria-label={isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
                onClick={e => {
                  e.stopPropagation();
                  setCollapsedFolders(prev => ({ ...prev, [folder.id]: !prev[folder.id] }));
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: colors.textSecondary,
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                  visibility: hasSubfolders ? 'visible' : 'hidden',
                }}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
              {isCollapsed ? (
                <Folder size={14} color={colors.accent} />
              ) : (
                <FolderOpen size={14} color={colors.accent} />
              )}
              <span
                style={{
                  fontWeight: isSelected ? 700 : 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {folder.name}
              </span>
            </div>

            <button
              type="button"
              data-testid={`save-modal-add-subfolder-btn-${folder.id}`}
              title={`New Subfolder in ${folder.name}`}
              onClick={e => {
                e.stopPropagation();
                setSelectedFolderId(folder.id);
                handleStartNewFolder(folder.id);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <FolderPlus size={11} />
              + Subfolder
            </button>
          </div>

          {isCreatingChildHere && (
            <div
              data-testid="save-modal-new-folder-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                paddingLeft: 28 + depth * 18,
                marginBottom: 4,
              }}
            >
              <FolderPlus size={13} color={colors.accent} />
              <input
                type="text"
                aria-label="New Subfolder Name"
                data-testid="save-modal-new-folder-input"
                value={newFolderName}
                autoFocus
                placeholder="Subfolder name..."
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmNewFolder();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setCreatingFolderParentId(undefined);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.accent}`,
                  backgroundColor: colors.bgPrimary,
                  color: colors.textPrimary,
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                data-testid="save-modal-confirm-new-folder-btn"
                onClick={handleConfirmNewFolder}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: colors.accent,
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
              <button
                type="button"
                data-testid="save-modal-cancel-new-folder-btn"
                onClick={() => setCreatingFolderParentId(undefined)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: 'transparent',
                  color: colors.textSecondary,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {!isCollapsed && hasSubfolders && renderFolderTree(folder.items, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div
      data-testid="save-request-modal-backdrop"
      onMouseDown={e => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 210,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save Request to Collection"
        data-testid="save-request-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          backgroundColor: colors.bgPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: colors.textPrimary }}>
              Save Request to Collection
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
              Every request must belong to a collection. Choose a collection and optional folder.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Save Request Modal"
            data-testid="save-request-modal-close-btn"
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

        {/* Request Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="save-request-name-input"
            style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary }}
          >
            Request Name
          </label>
          <input
            id="save-request-name-input"
            type="text"
            data-testid="save-request-name-input"
            value={requestName}
            placeholder="e.g. Create Order"
            onChange={e => setRequestName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && selectedCollectionPath && !isCreatingCollection) {
                e.preventDefault();
                handleSave();
              }
            }}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textPrimary,
              fontSize: 13,
            }}
          />
        </div>

        {/* Target Collection Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary }}>
              Select Collection
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                data-testid="save-modal-new-collection-btn"
                onClick={handleStartNewCollection}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Plus size={12} /> New Collection
              </button>
              <button
                type="button"
                data-testid="save-modal-open-collection-btn"
                onClick={() => void handleOpenExistingCollection()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <FolderOpen size={12} /> Open Collection…
              </button>
            </div>
          </div>

          {isCreatingCollection && (
            <div
              data-testid="save-modal-new-collection-form"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${colors.accent}`,
                backgroundColor: colors.bgSecondary,
              }}
            >
              <input
                type="text"
                aria-label="New Collection Name"
                data-testid="save-modal-new-collection-input"
                value={newCollectionName}
                autoFocus
                placeholder="Collection name..."
                onChange={e => setNewCollectionName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmNewCollection();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setIsCreatingCollection(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgPrimary,
                  color: colors.textPrimary,
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                data-testid="save-modal-confirm-new-collection-btn"
                onClick={handleConfirmNewCollection}
                style={{
                  padding: '6px 12px',
                  borderRadius: 5,
                  border: 'none',
                  backgroundColor: colors.accent,
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
              <button
                type="button"
                data-testid="save-modal-cancel-new-collection-btn"
                onClick={() => setIsCreatingCollection(false)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 5,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: 'transparent',
                  color: colors.textSecondary,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {collections.length === 0 ? (
            <div
              data-testid="save-modal-empty-collections"
              style={{
                padding: '18px 14px',
                borderRadius: 8,
                border: `1px dashed ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textSecondary,
                fontSize: 12,
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div>
                No collection is currently open in the workspace. Create a new collection or open an
                existing <code>.awjc</code> file to save this request.
              </div>
              {!isCreatingCollection && (
                <button
                  type="button"
                  data-testid="save-modal-empty-new-collection-cta"
                  onClick={handleStartNewCollection}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: colors.accent,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Create New Collection
                </button>
              )}
            </div>
          ) : (
            <div
              data-testid="save-modal-collection-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxHeight: 130,
                overflowY: 'auto',
                padding: 6,
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
              }}
            >
              {collections.map(entry => {
                const isSelected = entry.filePath === selectedCollectionPath;
                return (
                  <div
                    key={entry.filePath}
                    data-testid={`save-modal-collection-item-${entry.filePath}`}
                    data-selected={String(isSelected)}
                    onClick={() => {
                      setSelectedCollectionPath(entry.filePath);
                      setSelectedFolderId(null);
                      setCreatingFolderParentId(undefined);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: 5,
                      cursor: 'pointer',
                      backgroundColor: isSelected
                        ? isLight
                          ? '#dbeafe'
                          : 'rgba(59, 130, 246, 0.22)'
                        : 'transparent',
                      border: isSelected
                        ? `1px solid ${colors.accent}`
                        : '1px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: isSelected ? 700 : 600,
                          color: colors.textPrimary,
                        }}
                      >
                        {entry.collection.metadata.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: colors.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.filePath}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Folder / Subfolder Tree inside Selected Collection */}
        {selectedCollectionEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.textPrimary }}>
                Folder Location (Optional)
              </span>
              <button
                type="button"
                data-testid="save-modal-new-folder-btn"
                onClick={() => handleStartNewFolder(selectedFolderId)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 10px',
                  borderRadius: 5,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bgSecondary,
                  color: colors.textPrimary,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <FolderPlus size={12} />
                {selectedFolderId ? '+ New Subfolder' : '+ New Folder'}
              </button>
            </div>

            <div
              data-testid="save-modal-folder-tree"
              style={{
                maxHeight: 190,
                overflowY: 'auto',
                padding: 6,
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
              }}
            >
              {/* Collection Root Option */}
              <div
                data-testid="save-modal-folder-root"
                data-selected={String(selectedFolderId === null)}
                onClick={() => setSelectedFolderId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  backgroundColor:
                    selectedFolderId === null
                      ? isLight
                        ? '#dbeafe'
                        : 'rgba(59, 130, 246, 0.22)'
                      : 'transparent',
                  border:
                    selectedFolderId === null
                      ? `1px solid ${colors.accent}`
                      : '1px solid transparent',
                  color: colors.textPrimary,
                  fontSize: 12,
                  fontWeight: selectedFolderId === null ? 700 : 500,
                  marginBottom: 2,
                }}
              >
                <span>/ (Collection Root — {selectedCollectionEntry.collection.metadata.name})</span>
                <button
                  type="button"
                  data-testid="save-modal-add-root-folder-btn"
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedFolderId(null);
                    handleStartNewFolder(null);
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
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <FolderPlus size={11} />
                  + Folder
                </button>
              </div>

              {creatingFolderParentId === null && (
                <div
                  data-testid="save-modal-new-folder-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    paddingLeft: 18,
                    marginBottom: 4,
                  }}
                >
                  <FolderPlus size={13} color={colors.accent} />
                  <input
                    type="text"
                    aria-label="New Folder Name"
                    data-testid="save-modal-new-folder-input"
                    value={newFolderName}
                    autoFocus
                    placeholder="Folder name..."
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirmNewFolder();
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setCreatingFolderParentId(undefined);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: `1px solid ${colors.accent}`,
                      backgroundColor: colors.bgPrimary,
                      color: colors.textPrimary,
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    data-testid="save-modal-confirm-new-folder-btn"
                    onClick={handleConfirmNewFolder}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: colors.accent,
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    data-testid="save-modal-cancel-new-folder-btn"
                    onClick={() => setCreatingFolderParentId(undefined)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: 'transparent',
                      color: colors.textSecondary,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {renderFolderTree(selectedCollectionEntry.collection.items, 1)}
            </div>
          </div>
        )}

        {/* Footer with destination preview and actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderTop: `1px solid ${colors.border}`,
            paddingTop: 12,
          }}
        >
          <div
            data-testid="save-modal-destination-summary"
            style={{
              fontSize: 11,
              color: colors.textSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Destination: <strong style={{ color: colors.textPrimary }}>{destinationBreadcrumb}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              data-testid="save-request-modal-cancel-btn"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: 'transparent',
                color: colors.textPrimary,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="save-request-modal-confirm-btn"
              disabled={!selectedCollectionPath}
              onClick={handleSave}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: selectedCollectionPath ? colors.accent : colors.border,
                color: selectedCollectionPath ? '#ffffff' : colors.textSecondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: selectedCollectionPath ? 'pointer' : 'not-allowed',
              }}
            >
              <Save size={13} />
              Save Request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
