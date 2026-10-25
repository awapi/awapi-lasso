import React, { useState } from 'react';
import { Eye, EyeOff, FileText, Lock, Plus, Table, Trash2 } from 'lucide-react';
import type { KeyValueEntry } from '../../../shared/collectionSchema';
import { useTheme } from '../context/ThemeContext';

export interface KeyValueTableProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  descriptionPlaceholder?: string;
  keySuggestions?: string[];
  showEnabled?: boolean;
  showSecretToggle?: boolean;
  showBulkEdit?: boolean;
  testIdPrefix?: string;
  onSecretToggled?: (index: number, entry: KeyValueEntry, isSecret: boolean) => void;
}

export function serializeBulkKeyValue(entries: KeyValueEntry[]): string {
  return entries
    .map(entry => {
      const prefix = entry.enabled === false ? '# ' : '';
      return `${prefix}${entry.key}: ${entry.value ?? ''}`;
    })
    .join('\n');
}

export function parseBulkKeyValue(text: string): KeyValueEntry[] {
  const lines = text.split(/\r?\n/);
  const result: KeyValueEntry[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    let enabled = true;
    let lineContent = trimmed;
    if (lineContent.startsWith('#')) {
      enabled = false;
      lineContent = lineContent.replace(/^#\s*/, '');
    }
    const sepIdx = lineContent.indexOf(':');
    const eqIdx = lineContent.indexOf('=');
    let splitAt = -1;
    if (sepIdx !== -1 && (eqIdx === -1 || sepIdx < eqIdx)) {
      splitAt = sepIdx;
    } else if (eqIdx !== -1) {
      splitAt = eqIdx;
    }

    if (splitAt === -1) {
      result.push({ key: lineContent.trim(), value: '', enabled });
    } else {
      const key = lineContent.slice(0, splitAt).trim();
      const value = lineContent.slice(splitAt + 1).trim();
      if (key) {
        result.push({ key, value, enabled });
      }
    }
  }
  return result;
}

export const KeyValueTable: React.FC<KeyValueTableProps> = ({
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  descriptionPlaceholder = 'Description',
  keySuggestions = [],
  showEnabled = true,
  showSecretToggle = true,
  showBulkEdit = true,
  testIdPrefix = 'kv',
  onSecretToggled,
}) => {
  const { colors } = useTheme();
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [bulkText, setBulkText] = useState<string>('');
  const [revealedRows, setRevealedRows] = useState<Record<number, boolean>>({});

  const datalistId = `${testIdPrefix}-key-suggestions`;

  const handleToggleBulk = () => {
    if (!bulkMode) {
      setBulkText(serializeBulkKeyValue(entries));
      setBulkMode(true);
    } else {
      onChange(parseBulkKeyValue(bulkText));
      setBulkMode(false);
    }
  };

  const handleUpdateRow = (index: number, patch: Partial<KeyValueEntry>) => {
    const next = entries.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const handleDeleteRow = (index: number) => {
    onChange(entries.filter((_, idx) => idx !== index));
  };

  const handleAddRow = () => {
    onChange([...entries, { key: '', value: '', enabled: true, description: '' }]);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    borderRadius: 4,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    fontSize: 12,
    fontFamily: 'monospace',
  };

  return (
    <div
      data-testid={`${testIdPrefix}-table`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          data-testid={`${testIdPrefix}-add-row-btn`}
          onClick={handleAddRow}
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
          <Plus size={12} />
          Add Row
        </button>

        {showBulkEdit && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-bulk-toggle-btn`}
            onClick={handleToggleBulk}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgSecondary,
              color: colors.textSecondary,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {bulkMode ? <Table size={12} /> : <FileText size={12} />}
            {bulkMode ? 'Apply Key-Value Table' : 'Bulk Edit'}
          </button>
        )}
      </div>

      {keySuggestions.length > 0 && (
        <datalist id={datalistId}>
          {keySuggestions.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}

      {bulkMode ? (
        <textarea
          aria-label="Bulk key-value editor"
          data-testid={`${testIdPrefix}-bulk-textarea`}
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          rows={7}
          placeholder="# disabled_key: value&#10;key: value"
          style={{
            width: '100%',
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgPrimary,
            color: colors.textPrimary,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        />
      ) : (
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  backgroundColor: colors.bgSecondary,
                  color: colors.textSecondary,
                  textAlign: 'left',
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                {showEnabled && <th style={{ width: 32, padding: '6px 8px' }} />}
                <th style={{ padding: '6px 8px', width: '30%' }}>{keyPlaceholder}</th>
                <th style={{ padding: '6px 8px', width: '38%' }}>{valuePlaceholder}</th>
                <th style={{ padding: '6px 8px' }}>{descriptionPlaceholder}</th>
                <th style={{ width: 76, padding: '6px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={showEnabled ? 5 : 4}
                    data-testid={`${testIdPrefix}-empty-msg`}
                    style={{
                      padding: 12,
                      textAlign: 'center',
                      color: colors.textMuted,
                    }}
                  >
                    No entries defined. Click &ldquo;Add Row&rdquo; to add one.
                  </td>
                </tr>
              ) : (
                entries.map((entry, idx) => {
                  const isSecret = Boolean(entry.secret);
                  const isRevealed = Boolean(revealedRows[idx]);

                  return (
                    <tr
                      key={idx}
                      data-testid={`${testIdPrefix}-row-${idx}`}
                      style={{
                        borderBottom:
                          idx < entries.length - 1 ? `1px solid ${colors.border}` : 'none',
                        opacity: entry.enabled === false ? 0.55 : 1,
                      }}
                    >
                      {showEnabled && (
                        <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            aria-label={`Enable row ${idx}`}
                            data-testid={`${testIdPrefix}-enabled-${idx}`}
                            checked={entry.enabled !== false}
                            onChange={e => handleUpdateRow(idx, { enabled: e.target.checked })}
                          />
                        </td>
                      )}
                      <td style={{ padding: '5px 6px' }}>
                        <input
                          type="text"
                          aria-label={`${keyPlaceholder} ${idx}`}
                          data-testid={`${testIdPrefix}-key-${idx}`}
                          list={keySuggestions.length > 0 ? datalistId : undefined}
                          placeholder={keyPlaceholder}
                          value={entry.key}
                          onChange={e => handleUpdateRow(idx, { key: e.target.value })}
                          style={inputStyle}
                        />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type={isSecret && !isRevealed ? 'password' : 'text'}
                            aria-label={`${valuePlaceholder} ${idx}`}
                            data-testid={`${testIdPrefix}-value-${idx}`}
                            placeholder={valuePlaceholder}
                            value={entry.value ?? ''}
                            onChange={e => handleUpdateRow(idx, { value: e.target.value })}
                            style={inputStyle}
                          />
                          {isSecret && (
                            <button
                              type="button"
                              data-testid={`${testIdPrefix}-reveal-${idx}`}
                              aria-label={isRevealed ? 'Hide value' : 'Reveal value'}
                              onClick={() =>
                                setRevealedRows(prev => ({ ...prev, [idx]: !prev[idx] }))
                              }
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: colors.textSecondary,
                                cursor: 'pointer',
                                padding: 2,
                              }}
                            >
                              {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input
                          type="text"
                          aria-label={`${descriptionPlaceholder} ${idx}`}
                          data-testid={`${testIdPrefix}-desc-${idx}`}
                          placeholder={descriptionPlaceholder}
                          value={entry.description ?? ''}
                          onChange={e => handleUpdateRow(idx, { description: e.target.value })}
                          style={{ ...inputStyle, fontFamily: 'inherit' }}
                        />
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {showSecretToggle && (
                          <button
                            type="button"
                            data-testid={`${testIdPrefix}-secret-toggle-${idx}`}
                            aria-label={`Toggle secret for row ${idx}`}
                            title={isSecret ? 'Stored as Secret (OS Keychain)' : 'Mark as Secret'}
                            onClick={() => {
                              const nextSecret = !isSecret;
                              handleUpdateRow(idx, { secret: nextSecret });
                              onSecretToggled?.(idx, { ...entry, secret: nextSecret }, nextSecret);
                            }}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: isSecret ? colors.accent : colors.textMuted,
                              cursor: 'pointer',
                              padding: 3,
                            }}
                          >
                            <Lock size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid={`${testIdPrefix}-delete-${idx}`}
                          aria-label={`Delete row ${idx}`}
                          onClick={() => handleDeleteRow(idx)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.danger,
                            cursor: 'pointer',
                            padding: 3,
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
