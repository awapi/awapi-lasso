import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  generateStarterOperationForField,
  type NormalizedGraphQLField,
  type NormalizedGraphQLSchemaMetadata,
  type NormalizedGraphQLType,
} from '../../../shared/graphqlSchemaLoader';
import { useTheme } from '../context/ThemeContext';

export interface GraphQLSchemaExplorerProps {
  metadata: NormalizedGraphQLSchemaMetadata | null;
  onGenerateOperation: (generated: {
    operationName: string;
    query: string;
    variablesJson: string;
  }) => void;
  onClose?: () => void;
}

export const GraphQLSchemaExplorer: React.FC<GraphQLSchemaExplorerProps> = ({
  metadata,
  onGenerateOperation,
  onClose,
}) => {
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [historyStack, setHistoryStack] = useState<string[]>([]);

  const defaultSelectedTypeName = useMemo(() => {
    if (!metadata) return null;
    return (
      metadata.queryTypeName ||
      metadata.mutationTypeName ||
      metadata.subscriptionTypeName ||
      metadata.typeNames[0] ||
      null
    );
  }, [metadata]);

  const currentTypeName =
    historyStack.length > 0
      ? historyStack[historyStack.length - 1]
      : defaultSelectedTypeName;

  const navigateToType = (typeName: string) => {
    if (!metadata || !metadata.types[typeName]) return;
    setHistoryStack(prev => [...prev, typeName]);
  };

  const navigateBack = () => {
    setHistoryStack(prev => prev.slice(0, -1));
  };

  const filteredTypes = useMemo<NormalizedGraphQLType[]>(() => {
    if (!metadata) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = metadata.typeNames
      .map(name => metadata.types[name])
      .filter((t): t is NormalizedGraphQLType => Boolean(t));

    if (!q) return list;

    return list.filter(t => {
      if (t.name.toLowerCase().includes(q)) return true;
      if ((t.description ?? '').toLowerCase().includes(q)) return true;
      if (
        (t.fields ?? []).some(
          f =>
            f.name.toLowerCase().includes(q) ||
            (f.description ?? '').toLowerCase().includes(q),
        )
      ) {
        return true;
      }
      if ((t.inputFields ?? []).some(f => f.name.toLowerCase().includes(q))) {
        return true;
      }
      if ((t.enumValues ?? []).some(ev => ev.name.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }, [metadata, searchQuery]);

  if (!metadata) {
    return (
      <div
        data-testid="graphql-schema-explorer-empty"
        style={{
          padding: 16,
          fontSize: 12,
          color: colors.textMuted,
          textAlign: 'center',
        }}
      >
        No GraphQL schema loaded. Run introspection or load a local schema file to browse
        documentation.
      </div>
    );
  }

  const activeType: NormalizedGraphQLType | undefined = currentTypeName
    ? metadata.types[currentTypeName]
    : undefined;

  const rootOperationKindForType = (
    typeName: string | null | undefined,
  ): 'query' | 'mutation' | 'subscription' | null => {
    if (!typeName) return null;
    if (typeName === metadata.queryTypeName) return 'query';
    if (typeName === metadata.mutationTypeName) return 'mutation';
    if (typeName === metadata.subscriptionTypeName) return 'subscription';
    return null;
  };

  const activeRootOpKind = rootOperationKindForType(activeType?.name);

  const handleGenerateStarter = (field: NormalizedGraphQLField) => {
    if (!activeRootOpKind) return;
    const generated = generateStarterOperationForField(
      metadata,
      activeRootOpKind,
      field.name,
    );
    onGenerateOperation(generated);
  };

  return (
    <div
      data-testid="graphql-schema-explorer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: colors.bgPrimary,
        borderLeft: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          backgroundColor: colors.bgSecondary,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <BookOpen size={13} color={colors.accent} />
          <span>Schema Docs</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {historyStack.length > 0 && (
            <button
              type="button"
              data-testid="schema-explorer-back-btn"
              onClick={navigateBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 6px',
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgPrimary,
                color: colors.textSecondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={11} />
              Back
            </button>
          )}
          {onClose && (
            <button
              type="button"
              data-testid="schema-explorer-close-btn"
              onClick={onClose}
              aria-label="Close Schema Docs"
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: 2,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Search size={13} color={colors.textMuted} />
        <input
          type="text"
          data-testid="schema-explorer-search"
          value={searchQuery}
          placeholder="Search types, fields, enums…"
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            color: colors.textPrimary,
            fontSize: 12,
          }}
        />
      </div>

      {/* Type Pills Bar */}
      <div
        data-testid="schema-explorer-type-list"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: `1px solid ${colors.border}`,
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {filteredTypes.map(t => {
          const isCurrent = t.name === activeType?.name;
          return (
            <button
              key={t.name}
              type="button"
              data-testid={`schema-explorer-type-pill-${t.name}`}
              onClick={() => navigateToType(t.name)}
              style={{
                padding: '3px 8px',
                borderRadius: 999,
                border: `1px solid ${isCurrent ? colors.accent : colors.border}`,
                backgroundColor: isCurrent ? `${colors.accent}22` : colors.bgSecondary,
                color: isCurrent ? colors.accent : colors.textSecondary,
                fontSize: 11,
                fontWeight: isCurrent ? 700 : 500,
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {t.name}
            </button>
          );
        })}
      </div>

      {/* Selected Type Detail View */}
      <div
        data-testid="schema-explorer-detail"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {activeType ? (
          <>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    backgroundColor: `${colors.accent}22`,
                    color: colors.accent,
                    fontFamily: 'monospace',
                  }}
                >
                  {activeType.kind}
                </span>
                <span
                  data-testid="schema-explorer-active-type-name"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: colors.textPrimary,
                  }}
                >
                  {activeType.name}
                </span>
              </div>

              {activeType.description && (
                <div
                  data-testid="schema-explorer-active-type-desc"
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: colors.textSecondary,
                    lineHeight: 1.4,
                  }}
                >
                  {activeType.description}
                </div>
              )}

              {activeType.interfaces && activeType.interfaces.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: colors.textMuted }}>
                  Implements:{' '}
                  {activeType.interfaces.map(iface => (
                    <button
                      key={iface}
                      type="button"
                      data-testid={`schema-explorer-link-${iface}`}
                      onClick={() => navigateToType(iface)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: colors.accent,
                        fontFamily: 'monospace',
                        fontSize: 11,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        marginRight: 6,
                      }}
                    >
                      {iface}
                    </button>
                  ))}
                </div>
              )}

              {activeType.possibleTypes && activeType.possibleTypes.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: colors.textMuted }}>
                  Possible Types:{' '}
                  {activeType.possibleTypes.map(pt => (
                    <button
                      key={pt}
                      type="button"
                      data-testid={`schema-explorer-link-${pt}`}
                      onClick={() => navigateToType(pt)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: colors.accent,
                        fontFamily: 'monospace',
                        fontSize: 11,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        marginRight: 6,
                      }}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Object / Interface Fields */}
            {activeType.fields && activeType.fields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.textSecondary,
                    textTransform: 'uppercase',
                  }}
                >
                  Fields ({activeType.fields.length})
                </div>

                {activeType.fields.map(field => (
                  <div
                    key={field.name}
                    data-testid={`schema-explorer-field-${field.name}`}
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgSecondary,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          fontWeight: 600,
                          color: colors.textPrimary,
                        }}
                      >
                        <span>{field.name}</span>
                        {field.args.length > 0 && (
                          <span style={{ color: colors.textMuted, fontWeight: 400 }}>
                            (
                            {field.args
                              .map(a => `${a.name}: ${a.typeSignature}`)
                              .join(', ')}
                            )
                          </span>
                        )}
                        <span>: </span>
                        <button
                          type="button"
                          data-testid={`schema-explorer-field-type-link-${field.name}`}
                          onClick={() => navigateToType(field.namedType)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.accent,
                            fontFamily: 'monospace',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                          }}
                        >
                          {field.typeSignature}
                        </button>
                      </div>

                      {activeRootOpKind && (
                        <button
                          type="button"
                          data-testid={`schema-explorer-generate-btn-${field.name}`}
                          onClick={() => handleGenerateStarter(field)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 5,
                            border: `1px solid ${colors.accent}`,
                            backgroundColor: `${colors.accent}22`,
                            color: colors.accent,
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Sparkles size={11} />
                          Generate{' '}
                          {activeRootOpKind === 'mutation'
                            ? 'Starter Mutation'
                            : 'Starter Query'}
                        </button>
                      )}
                    </div>

                    {field.description && (
                      <div style={{ fontSize: 11, color: colors.textSecondary }}>
                        {field.description}
                      </div>
                    )}

                    {field.isDeprecated && (
                      <div
                        data-testid={`schema-explorer-deprecated-${field.name}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          color: '#f59e0b',
                        }}
                      >
                        <AlertTriangle size={12} />
                        <span>
                          Deprecated
                          {field.deprecationReason ? `: ${field.deprecationReason}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Input Object Fields */}
            {activeType.inputFields && activeType.inputFields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.textSecondary,
                    textTransform: 'uppercase',
                  }}
                >
                  Input Fields ({activeType.inputFields.length})
                </div>
                {activeType.inputFields.map(inf => (
                  <div
                    key={inf.name}
                    style={{
                      padding: 6,
                      borderRadius: 5,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgSecondary,
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    <span>{inf.name}: </span>
                    <button
                      type="button"
                      onClick={() => navigateToType(inf.namedType)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: colors.accent,
                        fontFamily: 'monospace',
                        fontSize: 12,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {inf.typeSignature}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Enum Values */}
            {activeType.enumValues && activeType.enumValues.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.textSecondary,
                    textTransform: 'uppercase',
                  }}
                >
                  Enum Values ({activeType.enumValues.length})
                </div>
                {activeType.enumValues.map(ev => (
                  <div
                    key={ev.name}
                    style={{
                      padding: 6,
                      borderRadius: 5,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgSecondary,
                      fontFamily: 'monospace',
                      fontSize: 12,
                    }}
                  >
                    {ev.name}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Select a type above to inspect its documentation.
          </div>
        )}
      </div>
    </div>
  );
};
