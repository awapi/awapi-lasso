import React, { useMemo, useState } from 'react';
import {
  Clock,
  FolderPlus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  getMethodBadgeColor,
  getMethodBadgeLabel,
  type RequestHistoryEntry,
} from './CollectionSidebar';
import { useTheme } from '../context/ThemeContext';

export interface RequestHistoryDrawerProps {
  isOpen?: boolean;
  entries: RequestHistoryEntry[];
  onRestoreToTab: (entry: RequestHistoryEntry) => void;
  onSaveToCollection: (entry: RequestHistoryEntry) => void;
  onClearHistory?: () => void;
  onClose?: () => void;
}

function getStatusColor(status: number | undefined, success: string, danger: string): string {
  if (status === undefined) return '#64748b';
  if (status >= 200 && status < 300) return success;
  if (status >= 300 && status < 400) return '#f59e0b';
  return danger;
}

function formatHistoryTime(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    if (Number.isNaN(d.getTime())) return isoTimestamp;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoTimestamp;
  }
}

export const RequestHistoryDrawer: React.FC<RequestHistoryDrawerProps> = ({
  isOpen = true,
  entries,
  onRestoreToTab,
  onSaveToCollection,
  onClearHistory,
  onClose,
}) => {
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      e =>
        e.url.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        (e.requestSnapshot?.name?.toLowerCase().includes(q) ?? false) ||
        (e.status !== undefined && String(e.status).includes(q)),
    );
  }, [entries, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="request-history-drawer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: colors.bgPrimary,
        color: colors.textPrimary,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}>
          <Clock size={13} color={colors.accent} />
          <span>Request History ({entries.length})</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {entries.length > 0 && onClearHistory && (
            <button
              type="button"
              data-testid="history-drawer-clear-btn"
              onClick={onClearHistory}
              title="Clear Request History"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Trash2 size={12} />
              Clear
            </button>
          )}
          {onClose && (
            <button
              type="button"
              data-testid="history-drawer-close-btn"
              aria-label="Close History Drawer"
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Filter Input */}
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${colors.border}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgSecondary,
          }}
        >
          <Search size={12} color={colors.textSecondary} />
          <input
            type="text"
            aria-label="Filter request history"
            data-testid="history-drawer-search-input"
            placeholder="Filter by URL, method, or status..."
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

      {/* Entries List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {filteredEntries.length === 0 ? (
          <div
            data-testid="empty-history-msg"
            style={{ fontSize: 12, color: colors.textSecondary, padding: 8 }}
          >
            No request history yet. Send a request to record it here.
          </div>
        ) : (
          <ul
            data-testid="history-list"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {filteredEntries.map(entry => {
              const badgeColor = getMethodBadgeColor(entry.method, entry.protocol);
              const statusColor = getStatusColor(entry.status, colors.success, colors.danger);

              return (
                <li
                  key={entry.id}
                  data-testid={`history-entry-${entry.id}`}
                  onClick={() => onRestoreToTab(entry)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 6,
                    backgroundColor: colors.bgSecondary,
                    border: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {/* Top Row: Method Badge, URL, Status Badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
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
                        flexShrink: 0,
                      }}
                    >
                      {getMethodBadgeLabel(entry.method, entry.protocol)}
                    </span>

                    <span
                      title={entry.url}
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                        fontSize: 11,
                      }}
                    >
                      {entry.url}
                    </span>

                    {entry.status !== undefined && (
                      <span
                        data-testid={`history-status-badge-${entry.id}`}
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          backgroundColor: `${statusColor}22`,
                          color: statusColor,
                          flexShrink: 0,
                        }}
                      >
                        {entry.status}
                      </span>
                    )}
                  </div>

                  {/* Bottom Row: Timestamp & Duration + One-Click Actions */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      fontSize: 11,
                      color: colors.textSecondary,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span data-testid={`history-timestamp-${entry.id}`}>
                        {formatHistoryTime(entry.timestamp)}
                      </span>
                      {entry.durationMs !== undefined && (
                        <span data-testid={`history-duration-${entry.id}`}>
                          {Math.round(entry.durationMs)} ms
                        </span>
                      )}
                    </div>

                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        data-testid={`history-restore-btn-${entry.id}`}
                        onClick={() => onRestoreToTab(entry)}
                        title="Restore Request to Tab"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          border: `1px solid ${colors.border}`,
                          backgroundColor: colors.bgPrimary,
                          color: colors.textPrimary,
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <RotateCcw size={10} />
                        Restore to Tab
                      </button>

                      <button
                        type="button"
                        data-testid={`history-save-to-col-btn-${entry.id}`}
                        onClick={() => onSaveToCollection(entry)}
                        title="Save Request to Active Collection"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          border: `1px solid ${colors.border}`,
                          backgroundColor: colors.bgPrimary,
                          color: colors.textPrimary,
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <FolderPlus size={10} />
                        Save to Collection
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
