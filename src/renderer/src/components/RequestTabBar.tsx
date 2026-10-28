import React, { useEffect, useState } from 'react';
import { Code2, Copy, Edit3, Plus, RotateCcw, X } from 'lucide-react';
import type { RequestItem } from '../../../shared/collectionSchema';
import { getMethodBadgeColor, getMethodBadgeLabel } from './CollectionSidebar';
import { useTheme } from '../context/ThemeContext';

export interface RequestWorkspaceTab {
  id: string;
  collectionPath: string | null;
  request: RequestItem;
  savedRequest?: RequestItem;
  isDirty?: boolean;
}

export interface RequestTabBarProps {
  tabs: RequestWorkspaceTab[];
  activeTabId: string | null;
  hasClosedTabs?: boolean;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
  onReopenClosedTab: () => void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
  onGenerateCodeForTab?: (tab: RequestWorkspaceTab) => void;
  onRenameTab?: (tabId: string, newName: string) => void;
  onDuplicateTab?: (tabId: string) => void;
}

export const RequestTabBar: React.FC<RequestTabBarProps> = ({
  tabs,
  activeTabId,
  hasClosedTabs = false,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onReopenClosedTab,
  onReorderTabs,
  onGenerateCodeForTab,
  onRenameTab,
  onDuplicateTab,
}) => {
  const { colors, isLight } = useTheme();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const commitRename = (tabId: string) => {
    const trimmed = renameDraft.trim();
    const tab = tabs.find(t => t.id === tabId);
    if (trimmed && tab && trimmed !== tab.request.name) {
      onRenameTab?.(tabId, trimmed);
    }
    setRenamingTabId(null);
    setRenameDraft('');
  };
  const [menuState, setMenuState] = useState<{
    tabId: string;
    top: number;
    left: number;
  } | null>(null);
  const menuTabId = menuState?.tabId ?? null;

  const openMenuForTab = (tabId: string, anchorEl: HTMLElement) => {
    if (menuTabId === tabId) {
      setMenuState(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = 220;
    const clampedLeft = Math.max(
      8,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
    );
    setMenuState({
      tabId,
      top: rect.bottom + 4,
      left: clampedLeft,
    });
  };

  useEffect(() => {
    if (!menuTabId) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tab-context-menu], [data-tab-menu-trigger]')) {
        return;
      }
      setMenuState(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuState(null);
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuTabId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        if (activeTabId) {
          e.preventDefault();
          onCloseTab(activeTabId);
        }
      } else if (e.key.toLowerCase() === 't' && e.shiftKey) {
        e.preventDefault();
        onReopenClosedTab();
      } else if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault();
        onNewTab();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, onCloseTab, onReopenClosedTab, onNewTab]);

  return (
    <div
      data-testid="request-tab-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.bgSecondary,
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        minHeight: 38,
        padding: '0 6px',
        gap: 4,
      }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTabId;
        const badgeColor = getMethodBadgeColor(tab.request.method, tab.request.protocol);
        const badgeLabel = getMethodBadgeLabel(tab.request.method, tab.request.protocol);
        const isMenuOpen = menuTabId === tab.id;
        const isRenaming = renamingTabId === tab.id;

        return (
          <div
            key={tab.id}
            data-testid={`request-tab-${tab.id}`}
            data-active={String(isActive)}
            draggable={!isRenaming}
            onDragStart={() => setDragIndex(idx)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== idx) {
                onReorderTabs(dragIndex, idx);
              }
              setDragIndex(null);
            }}
            onClick={() => onSelectTab(tab.id)}
            onAuxClick={e => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            onContextMenu={e => {
              e.preventDefault();
              openMenuForTab(tab.id, e.currentTarget);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 10px',
              borderRadius: '6px 6px 0 0',
              borderTop: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
              borderLeft: `1px solid ${isActive ? colors.border : 'transparent'}`,
              borderRight: `1px solid ${isActive ? colors.border : 'transparent'}`,
              backgroundColor: isActive ? colors.bgPrimary : 'transparent',
              color: isActive ? colors.textPrimary : colors.textSecondary,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              position: 'relative',
              userSelect: 'none',
              maxWidth: 230,
              flexShrink: 0,
            }}
          >
            {/* Method / Protocol Badge */}
            <span
              data-testid={`tab-badge-${tab.id}`}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 4,
                backgroundColor: `${badgeColor}22`,
                color: badgeColor,
                flexShrink: 0,
              }}
            >
              {badgeLabel}
            </span>

            {/* Tab Title */}
            {isRenaming ? (
              <input
                type="text"
                data-testid={`tab-rename-input-${tab.id}`}
                aria-label="Request name"
                value={renameDraft}
                autoFocus
                onClick={e => e.stopPropagation()}
                onChange={e => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(tab.id)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(tab.id);
                  if (e.key === 'Escape') setRenamingTabId(null);
                }}
                style={{
                  fontSize: 12,
                  padding: '1px 4px',
                  borderRadius: 4,
                  border: `1px solid ${colors.accent}`,
                  backgroundColor: colors.bgPrimary,
                  color: colors.textPrimary,
                  width: 140,
                }}
              />
            ) : (
              <span
                data-testid={`tab-title-${tab.id}`}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.request.name || 'Untitled Request'}
              </span>
            )}

            {/* Dirty Indicator */}
            {tab.isDirty && (
              <span
                data-testid={`tab-dirty-${tab.id}`}
                title="Unsaved changes"
                style={{
                  color: colors.accent,
                  fontWeight: 800,
                  fontSize: 13,
                  lineHeight: 1,
                }}
              >
                •
              </span>
            )}

            {/* Close Button */}
            <button
              type="button"
              data-testid={`tab-close-btn-${tab.id}`}
              aria-label={`Close ${tab.request.name}`}
              onClick={e => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
                borderRadius: 4,
              }}
            >
              <X size={12} />
            </button>

            {/* Context Menu */}
            {isMenuOpen && menuState && (
              <div
                data-tab-context-menu="true"
                data-testid={`tab-context-menu-${tab.id}`}
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  top: menuState.top,
                  left: menuState.left,
                  zIndex: 9999,
                  backgroundColor: isLight ? '#ffffff' : '#1e293b',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: 4,
                  minWidth: 210,
                  boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {onGenerateCodeForTab && (
                  <button
                    type="button"
                    data-testid={`tab-ctx-generate-code-${tab.id}`}
                    onClick={() => {
                      setMenuState(null);
                      onGenerateCodeForTab(tab);
                    }}
                    style={{ ...ctxBtnStyle(colors), gap: 6 }}
                  >
                    <Code2 size={12} /> Generate Code Snippet…
                  </button>
                )}
                {onRenameTab && (
                  <button
                    type="button"
                    data-testid={`tab-ctx-rename-${tab.id}`}
                    onClick={() => {
                      setMenuState(null);
                      setRenameDraft(tab.request.name);
                      setRenamingTabId(tab.id);
                    }}
                    style={{ ...ctxBtnStyle(colors), gap: 6 }}
                  >
                    <Edit3 size={12} /> Rename
                  </button>
                )}
                {onDuplicateTab && (
                  <button
                    type="button"
                    data-testid={`tab-ctx-duplicate-${tab.id}`}
                    onClick={() => {
                      setMenuState(null);
                      onDuplicateTab(tab.id);
                    }}
                    style={{ ...ctxBtnStyle(colors), gap: 6 }}
                  >
                    <Copy size={12} /> Duplicate
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`tab-ctx-close-${tab.id}`}
                  onClick={() => {
                    setMenuState(null);
                    onCloseTab(tab.id);
                  }}
                  style={ctxBtnStyle(colors)}
                >
                  Close (Cmd/Ctrl+W)
                </button>
                <button
                  type="button"
                  data-testid={`tab-ctx-close-others-${tab.id}`}
                  onClick={() => {
                    setMenuState(null);
                    onCloseOtherTabs(tab.id);
                  }}
                  style={ctxBtnStyle(colors)}
                >
                  Close Others
                </button>
                <button
                  type="button"
                  data-testid={`tab-ctx-close-all-${tab.id}`}
                  onClick={() => {
                    setMenuState(null);
                    onCloseAllTabs();
                  }}
                  style={ctxBtnStyle(colors)}
                >
                  Close All
                </button>
                <button
                  type="button"
                  data-testid={`tab-ctx-reopen-${tab.id}`}
                  disabled={!hasClosedTabs}
                  onClick={() => {
                    setMenuState(null);
                    onReopenClosedTab();
                  }}
                  style={{
                    ...ctxBtnStyle(colors),
                    opacity: hasClosedTabs ? 1 : 0.5,
                  }}
                >
                  Reopen Closed Tab (Cmd/Ctrl+Shift+T)
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Quick New Tab Button (+) */}
      <button
        type="button"
        data-testid="new-request-tab-btn"
        aria-label="New request tab"
        title="New Request Tab (Cmd/Ctrl+T)"
        onClick={onNewTab}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 5,
          borderRadius: 5,
          border: `1px solid ${colors.border}`,
          backgroundColor: 'transparent',
          color: colors.textSecondary,
          cursor: 'pointer',
          marginLeft: 2,
        }}
      >
        <Plus size={14} />
      </button>

      {/* Reopen Closed Tab Quick Button */}
      {hasClosedTabs && (
        <button
          type="button"
          data-testid="reopen-closed-tab-btn"
          aria-label="Reopen closed tab"
          title="Reopen Closed Tab (Cmd/Ctrl+Shift+T)"
          onClick={onReopenClosedTab}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 5,
            border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent',
            color: colors.textSecondary,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={12} />
          Reopen
        </button>
      )}
    </div>
  );
};

function ctxBtnStyle(colors: { textPrimary: string }): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
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
