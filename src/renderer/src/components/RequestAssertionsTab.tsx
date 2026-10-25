import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  AssertionOperator,
  AssertionRule,
  AssertionTarget,
} from '../../../shared/collectionSchema';
import { useTheme } from '../context/ThemeContext';

export interface RequestAssertionsTabProps {
  assertions: AssertionRule[];
  onChange: (assertions: AssertionRule[]) => void;
}

const UNARY_OPERATORS = new Set<AssertionOperator>([
  'isDefined',
  'isUndefined',
  'isEmpty',
  'isNotEmpty',
  'isArray',
]);

export const RequestAssertionsTab: React.FC<RequestAssertionsTabProps> = ({
  assertions,
  onChange,
}) => {
  const { colors } = useTheme();

  const handleAddAssertion = () => {
    onChange([
      ...assertions,
      {
        target: 'status',
        operator: 'equals',
        expected: '200',
        enabled: true,
      },
    ]);
  };

  const handleUpdateAssertion = (index: number, patch: Partial<AssertionRule>) => {
    onChange(assertions.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const handleDeleteAssertion = (index: number) => {
    onChange(assertions.filter((_, idx) => idx !== index));
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
      data-testid="request-assertions-tab"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          Declarative response test assertions evaluated automatically when a response arrives.
        </span>
        <button
          type="button"
          data-testid="assertions-add-btn"
          onClick={handleAddAssertion}
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
          Add Assertion
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
              <th style={{ padding: '6px 8px', width: '20%' }}>Target</th>
              <th style={{ padding: '6px 8px', width: '25%' }}>Path / Header Name</th>
              <th style={{ padding: '6px 8px', width: '22%' }}>Operator</th>
              <th style={{ padding: '6px 8px' }}>Expected Value</th>
              <th style={{ width: 48, padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {assertions.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="assertions-empty-msg"
                  style={{ padding: 12, textAlign: 'center', color: colors.textMuted }}
                >
                  No test assertions defined.
                </td>
              </tr>
            ) : (
              assertions.map((rule, idx) => {
                const needsPath = rule.target === 'jsonpath' || rule.target === 'header';
                const isUnary = UNARY_OPERATORS.has(rule.operator);

                return (
                  <tr
                    key={idx}
                    data-testid={`assertion-row-${idx}`}
                    style={{
                      borderBottom:
                        idx < assertions.length - 1 ? `1px solid ${colors.border}` : 'none',
                    }}
                  >
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        data-testid={`assertion-enabled-${idx}`}
                        checked={rule.enabled !== false}
                        onChange={e => handleUpdateAssertion(idx, { enabled: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <select
                        data-testid={`assertion-target-${idx}`}
                        value={rule.target}
                        onChange={e =>
                          handleUpdateAssertion(idx, {
                            target: e.target.value as AssertionTarget,
                          })
                        }
                        style={inputStyle}
                      >
                        <option value="status">Status Code</option>
                        <option value="responseTime">Response Time (ms)</option>
                        <option value="header">Header</option>
                        <option value="jsonpath">JSONPath</option>
                        <option value="body">Raw Body</option>
                      </select>
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <input
                        type="text"
                        data-testid={`assertion-path-${idx}`}
                        disabled={!needsPath}
                        value={
                          rule.target === 'header'
                            ? (rule.headerName ?? rule.path ?? '')
                            : (rule.path ?? '')
                        }
                        placeholder={
                          rule.target === 'jsonpath'
                            ? '$.data.items[0].id'
                            : rule.target === 'header'
                              ? 'content-type'
                              : '—'
                        }
                        onChange={e =>
                          handleUpdateAssertion(
                            idx,
                            rule.target === 'header'
                              ? { headerName: e.target.value, path: e.target.value }
                              : { path: e.target.value },
                          )
                        }
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <select
                        data-testid={`assertion-operator-${idx}`}
                        value={rule.operator}
                        onChange={e =>
                          handleUpdateAssertion(idx, {
                            operator: e.target.value as AssertionOperator,
                          })
                        }
                        style={inputStyle}
                      >
                        <option value="equals">equals</option>
                        <option value="notEquals">notEquals</option>
                        <option value="contains">contains</option>
                        <option value="notContains">notContains</option>
                        <option value="matchesRegex">matchesRegex</option>
                        <option value="lessThan">lessThan</option>
                        <option value="greaterThan">greaterThan</option>
                        <option value="in">in</option>
                        <option value="isDefined">isDefined</option>
                        <option value="isUndefined">isUndefined</option>
                        <option value="isEmpty">isEmpty</option>
                        <option value="isNotEmpty">isNotEmpty</option>
                        <option value="isArray">isArray</option>
                      </select>
                    </td>
                    <td style={{ padding: '5px 6px' }}>
                      <input
                        type="text"
                        data-testid={`assertion-expected-${idx}`}
                        disabled={isUnary}
                        value={
                          Array.isArray(rule.expected)
                            ? rule.expected.join(', ')
                            : String(rule.expected ?? '')
                        }
                        placeholder={isUnary ? '—' : 'Expected value'}
                        onChange={e => handleUpdateAssertion(idx, { expected: e.target.value })}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      <button
                        type="button"
                        data-testid={`assertion-delete-${idx}`}
                        onClick={() => handleDeleteAssertion(idx)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: colors.danger,
                          cursor: 'pointer',
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
    </div>
  );
};
