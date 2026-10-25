import React from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type { CaptureRule, CaptureScope, CaptureSource } from '../../../shared/collectionSchema';
import { useTheme } from '../context/ThemeContext';

export interface RequestCapturesTabProps {
  captures: CaptureRule[];
  onChange: (captures: CaptureRule[]) => void;
}

export const RequestCapturesTab: React.FC<RequestCapturesTabProps> = ({ captures, onChange }) => {
  const { colors } = useTheme();

  const handleAddRule = () => {
    onChange([
      ...captures,
      {
        variable: '',
        scope: 'environment',
        source: 'jsonpath',
        expression: '$.data.id',
        enabled: true,
        secret: false,
      },
    ]);
  };

  const handleUpdateRule = (index: number, patch: Partial<CaptureRule>) => {
    onChange(captures.map((rule, idx) => (idx === index ? { ...rule, ...patch } : rule)));
  };

  const handleDeleteRule = (index: number) => {
    onChange(captures.filter((_, idx) => idx !== index));
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
      data-testid="request-captures-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          Extract values from HTTP/GraphQL responses into variables automatically after execution.
        </span>
        <button
          type="button"
          data-testid="captures-add-btn"
          onClick={handleAddRule}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
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
          Add Capture Rule
        </button>
      </div>

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
              <th style={{ width: 32, padding: '6px 8px' }} />
              <th style={{ padding: '6px 8px', width: '24%' }}>Variable Name</th>
              <th style={{ padding: '6px 8px', width: '18%' }}>Target Scope</th>
              <th style={{ padding: '6px 8px', width: '18%' }}>Source</th>
              <th style={{ padding: '6px 8px' }}>Expression (JSONPath / Header / Cookie)</th>
              <th style={{ width: 72, padding: '6px 8px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {captures.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="captures-empty-msg"
                  style={{ padding: 12, textAlign: 'center', color: colors.textMuted }}
                >
                  No post-response capture rules defined.
                </td>
              </tr>
            ) : (
              captures.map((rule, idx) => (
                <tr
                  key={idx}
                  data-testid={`capture-row-${idx}`}
                  style={{
                    borderBottom:
                      idx < captures.length - 1 ? `1px solid ${colors.border}` : 'none',
                  }}
                >
                  <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      data-testid={`capture-enabled-${idx}`}
                      checked={rule.enabled !== false}
                      onChange={e => handleUpdateRule(idx, { enabled: e.target.checked })}
                    />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input
                      type="text"
                      data-testid={`capture-variable-${idx}`}
                      value={rule.variable}
                      placeholder="authToken"
                      onChange={e => handleUpdateRule(idx, { variable: e.target.value })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <select
                      data-testid={`capture-scope-${idx}`}
                      value={rule.scope}
                      onChange={e =>
                        handleUpdateRule(idx, { scope: e.target.value as CaptureScope })
                      }
                      style={inputStyle}
                    >
                      <option value="environment">Environment</option>
                      <option value="collection">Collection</option>
                      <option value="runtime">Runtime</option>
                    </select>
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <select
                      data-testid={`capture-source-${idx}`}
                      value={rule.source}
                      onChange={e =>
                        handleUpdateRule(idx, { source: e.target.value as CaptureSource })
                      }
                      style={inputStyle}
                    >
                      <option value="jsonpath">JSONPath</option>
                      <option value="header">Header</option>
                      <option value="cookie">Cookie</option>
                      <option value="status">Status Code</option>
                      <option value="body">Raw Body</option>
                    </select>
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input
                      type="text"
                      data-testid={`capture-expression-${idx}`}
                      disabled={rule.source === 'status' || rule.source === 'body'}
                      value={rule.expression ?? ''}
                      placeholder={
                        rule.source === 'jsonpath'
                          ? '$.data.access_token'
                          : rule.source === 'header'
                            ? 'X-Request-Id'
                            : 'session_id'
                      }
                      onChange={e => handleUpdateRule(idx, { expression: e.target.value })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      data-testid={`capture-secret-${idx}`}
                      title="Mark captured variable as Secret"
                      onClick={() => handleUpdateRule(idx, { secret: !rule.secret })}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: rule.secret ? colors.accent : colors.textMuted,
                        cursor: 'pointer',
                        padding: 3,
                      }}
                    >
                      <Lock size={13} />
                    </button>
                    <button
                      type="button"
                      data-testid={`capture-delete-${idx}`}
                      onClick={() => handleDeleteRule(idx)}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
