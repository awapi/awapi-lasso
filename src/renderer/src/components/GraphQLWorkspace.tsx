import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FolderOpen,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type {
  AuthConfig,
  AuthProfile,
  GraphQLConfig,
  KeyValueEntry,
  PathParamEntry,
  QueryParamEntry,
} from '../../../shared/collectionSchema';
import {
  createEmptyDesignerSelectionState,
  extractSelectionStateFromAst,
  prettifyGraphQLQuery,
  setFieldArgument,
  setNestedArgumentValue,
  toggleFieldSelection,
  toggleInlineFragment,
  toggleVariableBinding,
  type DesignerSelectionState,
  type GraphQLOperationType,
} from '../../../shared/graphqlAstSync';
import type { NormalizedGraphQLSchemaMetadata } from '../../../shared/graphqlSchemaLoader';
import type { PreparedHttpRequest } from '../../../shared/httpTypes';
import type { VariableInterpolationContext } from '../../../shared/interpolation';
import { buildResolvedRequestUrl } from '../../../shared/urlParams';
import type { GraphQLCachedSchemaRecord } from '../../../main/graphqlIntrospection';
import { useTheme } from '../context/ThemeContext';
import { ResizableSplitPane } from './ResizableSplitPane';
import { GraphQLQueryDesigner } from './GraphQLQueryDesigner';
import { GraphQLSchemaExplorer } from './GraphQLSchemaExplorer';
import { publishGraphqlSchemaForAi, publishGraphqlSchemaLoaderForAi } from '../aiGraphqlSchema';

export interface GraphQLWorkspaceProps {
  graphql: GraphQLConfig;
  onChange: (next: GraphQLConfig) => void;
  /** Request & environment context used to run live Main-process Introspection */
  url: string;
  queryParams?: QueryParamEntry[];
  pathParams?: PathParamEntry[];
  headers?: KeyValueEntry[];
  inheritedHeaders?: KeyValueEntry[];
  auth?: AuthConfig;
  collectionDefaultAuth?: AuthConfig;
  authProfiles?: AuthProfile[];
  interpolationContext?: VariableInterpolationContext;
  collectionId?: string;
  environmentId?: string;
  collectionFilePath?: string;
}

export interface SchemaCompletionSuggestion {
  label: string;
  detail: string;
  documentation?: string;
  insertText: string;
  kind: 'field' | 'argument' | 'type' | 'directive' | 'variable';
}

/**
 * Builds schema-aware autocomplete items (fields, arguments, types, directives, and `{{variables}}`)
 * for Monaco completion providers and unit tests.
 */
export function buildGraphQLCompletionItems(
  metadata: NormalizedGraphQLSchemaMetadata | null,
  interpolationContext?: VariableInterpolationContext,
): SchemaCompletionSuggestion[] {
  const items: SchemaCompletionSuggestion[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: SchemaCompletionSuggestion) => {
    const key = `${item.kind}:${item.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  if (metadata) {
    for (const typeName of metadata.typeNames) {
      const t = metadata.types[typeName];
      if (!t) continue;
      pushUnique({
        label: t.name,
        detail: t.kind,
        documentation: t.description,
        insertText: t.name,
        kind: 'type',
      });

      for (const f of t.fields ?? []) {
        pushUnique({
          label: f.name,
          detail: `${t.name}.${f.name}: ${f.typeSignature}`,
          documentation: f.description,
          insertText: f.name,
          kind: 'field',
        });

        for (const a of f.args) {
          pushUnique({
            label: a.name,
            detail: `${f.name}(${a.name}: ${a.typeSignature})`,
            documentation: a.description,
            insertText: `${a.name}: `,
            kind: 'argument',
          });
        }
      }
    }
  }

  for (const dir of ['@include(if: $var)', '@skip(if: $var)', '@deprecated']) {
    const name = dir.split('(')[0];
    pushUnique({
      label: name,
      detail: 'GraphQL Directive',
      insertText: dir,
      kind: 'directive',
    });
  }

  const allVars = [
    ...(interpolationContext?.capturedVariables ?? []),
    ...(interpolationContext?.environmentVariables ?? []),
    ...(interpolationContext?.collectionVariables ?? []),
  ];
  for (const v of allVars) {
    if (!v.key || v.enabled === false) continue;
    pushUnique({
      label: `{{${v.key}}}`,
      detail: 'Environment / Collection Variable',
      documentation: v.description,
      insertText: `{{${v.key}}}`,
      kind: 'variable',
    });
  }

  return items;
}

export const GraphQLWorkspace: React.FC<GraphQLWorkspaceProps> = ({
  graphql,
  onChange,
  url,
  queryParams,
  pathParams,
  headers,
  inheritedHeaders,
  auth,
  collectionDefaultAuth,
  authProfiles,
  interpolationContext,
  collectionId,
  environmentId,
  collectionFilePath,
}) => {
  const { colors, isLight } = useTheme();
  const [schemaRecord, setSchemaRecord] = useState<GraphQLCachedSchemaRecord | null>(
    null,
  );
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [activeOperationType, setActiveOperationType] =
    useState<GraphQLOperationType>('query');
  const [formatError, setFormatError] = useState<string | null>(null);

  const lastValidSelectionRef = useRef<DesignerSelectionState>(
    createEmptyDesignerSelectionState('query'),
  );
  const monacoDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const metadata: NormalizedGraphQLSchemaMetadata | null =
    schemaRecord?.metadata ?? null;

  const selectionState = useMemo(() => {
    const next = extractSelectionStateFromAst(graphql.query ?? '', {
      targetOperationName: graphql.operationName,
      previousState: lastValidSelectionRef.current,
    });
    if (next.valid) {
      lastValidSelectionRef.current = next;
    }
    return next;
  }, [graphql.query, graphql.operationName]);

  useEffect(() => {
    if (selectionState.valid && selectionState.operationType) {
      setActiveOperationType(selectionState.operationType);
    }
  }, [selectionState.valid, selectionState.operationType]);

  const resolvedEndpointUrl = useMemo(
    () =>
      buildResolvedRequestUrl({
        rawUrl: url ?? '',
        queryParams,
        pathParams: pathParams ?? [],
        context: interpolationContext ?? {},
      }),
    [url, queryParams, pathParams, interpolationContext],
  );

  const buildIntrospectionPreparedRequest = useCallback((): PreparedHttpRequest => {
    return {
      protocol: 'graphql',
      method: 'POST',
      url,
      queryParams,
      pathParams,
      headers,
      inheritedHeaders,
      auth,
      collectionDefaultAuth,
      authProfiles,
      interpolationContext,
      collectionId,
      environmentId,
    };
  }, [
    url,
    queryParams,
    pathParams,
    headers,
    inheritedHeaders,
    auth,
    collectionDefaultAuth,
    authProfiles,
    interpolationContext,
    collectionId,
    environmentId,
  ]);

  const handleDiscoverSchema = useCallback(async (): Promise<{ record?: GraphQLCachedSchemaRecord; error?: string }> => {
    const api = window.electronAPI;
    if (!api?.introspectGraphQLSchema) return { error: 'Schema discovery is not available.' };

    setIsLoadingSchema(true);
    setSchemaError(null);
    try {
      const res = await api.introspectGraphQLSchema({
        request: buildIntrospectionPreparedRequest(),
      });
      if (res.ok && res.record) {
        setSchemaRecord(res.record);
        setSchemaError(null);
        return { record: res.record };
      }
      // Fallback to localSchemaPath if configured when remote introspection fails
      const fallbackLocalPath = graphql.schemaSource?.localSchemaPath?.trim();
      if (fallbackLocalPath && api.loadLocalGraphQLSchema) {
        const localRes = await api.loadLocalGraphQLSchema({
          filePath: fallbackLocalPath,
          collectionFilePath,
          collectionId,
          environmentId,
          endpointUrl: resolvedEndpointUrl,
        });
        if (localRes.ok && localRes.record) {
          setSchemaRecord(localRes.record);
          setSchemaError(null);
          return { record: localRes.record };
        }
      }
      const error = res.error || 'Failed to introspect GraphQL schema.';
      setSchemaError(error);
      return { error };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setSchemaError(error);
      return { error };
    } finally {
      setIsLoadingSchema(false);
    }
  }, [
    buildIntrospectionPreparedRequest,
    graphql.schemaSource?.localSchemaPath,
    collectionFilePath,
    collectionId,
    environmentId,
    resolvedEndpointUrl,
  ]);

  const handleLoadLocalSchemaByPath = useCallback(
    async (filePath: string) => {
      const api = window.electronAPI;
      if (!api?.loadLocalGraphQLSchema) return;
      setIsLoadingSchema(true);
      setSchemaError(null);
      try {
        const res = await api.loadLocalGraphQLSchema({
          filePath,
          collectionFilePath,
          collectionId,
          environmentId,
          endpointUrl: resolvedEndpointUrl,
        });
        if (res.ok && res.record) {
          setSchemaRecord(res.record);
          onChange({
            ...graphql,
            schemaSource: {
              ...(graphql.schemaSource ?? { mode: 'sdl_file' }),
              mode: filePath.toLowerCase().endsWith('.json')
                ? 'json_file'
                : 'sdl_file',
              localSchemaPath: filePath,
            },
          });
        } else {
          setSchemaError(res.error || 'Failed to load local schema file.');
        }
      } catch (err) {
        setSchemaError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [collectionFilePath, collectionId, environmentId, resolvedEndpointUrl, graphql, onChange],
  );

  const handlePickLocalSchemaFile = async () => {
    const api = window.electronAPI;
    if (!api?.openGraphQLSchemaFileDialog) return;
    const picked = await api.openGraphQLSchemaFileDialog();
    if (picked) {
      await handleLoadLocalSchemaByPath(picked);
    }
  };

  // Check cached schema or auto-introspect when endpoint / environment changes
  const autoIntrospectEnabled =
    graphql.schemaSource?.autoIntrospectOnOpen ?? true;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;

    const initSchema = async () => {
      if (api.getCachedGraphQLSchema && resolvedEndpointUrl) {
        try {
          const cached = await api.getCachedGraphQLSchema({
            collectionId,
            environmentId,
            endpointUrl: resolvedEndpointUrl,
          });
          if (!cancelled && cached) {
            setSchemaRecord(cached);
            return;
          }
        } catch {
          // ignore cache lookup error
        }
      }

      if (
        (graphql.schemaSource?.mode === 'sdl_file' ||
          graphql.schemaSource?.mode === 'json_file') &&
        graphql.schemaSource.localSchemaPath
      ) {
        if (api.loadLocalGraphQLSchema) {
          const res = await api.loadLocalGraphQLSchema({
            filePath: graphql.schemaSource.localSchemaPath,
            collectionFilePath,
            collectionId,
            environmentId,
            endpointUrl: resolvedEndpointUrl,
          });
          if (!cancelled && res?.ok && res.record) {
            setSchemaRecord(res.record);
            return;
          }
        }
      }

      if (autoIntrospectEnabled && resolvedEndpointUrl) {
        await handleDiscoverSchema();
      }
    };

    void initSchema();
    return () => {
      cancelled = true;
    };
  }, [
    collectionId,
    environmentId,
    resolvedEndpointUrl,
    autoIntrospectEnabled,
    graphql.schemaSource?.mode,
    graphql.schemaSource?.localSchemaPath,
    collectionFilePath,
    handleDiscoverSchema,
  ]);

  useEffect(() => {
    publishGraphqlSchemaForAi(
      schemaRecord
        ? { introspection: schemaRecord.introspection, metadata: schemaRecord.metadata }
        : null,
    );
  }, [schemaRecord]);

  useEffect(() => {
    return () => publishGraphqlSchemaForAi(null);
  }, []);

  useEffect(() => {
    publishGraphqlSchemaLoaderForAi(async () => {
      const result = await handleDiscoverSchema();
      return result.record
        ? { ok: true, schema: { introspection: result.record.introspection, metadata: result.record.metadata } }
        : { ok: false, error: result.error ?? 'Failed to load the GraphQL schema.' };
    });
    return () => publishGraphqlSchemaLoaderForAi(null);
  }, [handleDiscoverSchema]);

  useEffect(() => {
    return () => {
      monacoDisposableRef.current?.dispose();
    };
  }, []);

  const handleConfigureMonaco = (monaco: Monaco) => {
    monacoDisposableRef.current?.dispose();
    const suggestions = buildGraphQLCompletionItems(metadata, interpolationContext);
    monacoDisposableRef.current = monaco.languages.registerCompletionItemProvider(
      'graphql',
      {
        provideCompletionItems: (
          model: {
            getWordUntilPosition: (pos: {
              lineNumber: number;
              column: number;
            }) => { startColumn: number; endColumn: number };
          },
          position: { lineNumber: number; column: number },
        ) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: suggestions.map(s => ({
              label: s.label,
              kind:
                s.kind === 'field'
                  ? monaco.languages.CompletionItemKind.Field
                  : s.kind === 'argument'
                    ? monaco.languages.CompletionItemKind.Property
                    : s.kind === 'type'
                      ? monaco.languages.CompletionItemKind.Struct
                      : monaco.languages.CompletionItemKind.Variable,
              detail: s.detail,
              documentation: s.documentation,
              insertText: s.insertText,
              range,
            })),
          };
        },
      },
    );
  };

  const handleToggleField = (fieldPath: string[], checked: boolean) => {
    const nextQuery = toggleFieldSelection({
      queryText: graphql.query ?? '',
      fieldPath,
      checked,
      metadata: metadata ?? undefined,
      operationType: activeOperationType,
      operationName: graphql.operationName,
    });
    onChange({
      ...graphql,
      query: nextQuery,
    });
  };

  const handleToggleInlineFragment = (
    parentFieldPath: string[],
    typeName: string,
    checked: boolean,
  ) => {
    const nextQuery = toggleInlineFragment({
      queryText: graphql.query ?? '',
      parentFieldPath,
      typeName,
      checked,
      metadata: metadata ?? undefined,
      operationType: activeOperationType,
      operationName: graphql.operationName,
    });
    onChange({
      ...graphql,
      query: nextQuery,
    });
  };

  const handleChangeArgument = (
    fieldPath: string[],
    argName: string,
    value: string,
  ) => {
    const nextQuery = setFieldArgument({
      queryText: graphql.query ?? '',
      fieldPath,
      argName,
      value,
      metadata: metadata ?? undefined,
      operationType: activeOperationType,
      operationName: graphql.operationName,
    });
    onChange({
      ...graphql,
      query: nextQuery,
    });
  };

  const handleChangeNestedArgument = (
    fieldPath: string[],
    argName: string,
    nestedPath: Array<string | number>,
    value: string,
  ) => {
    const nextQuery = setNestedArgumentValue({
      queryText: graphql.query ?? '',
      fieldPath,
      argName,
      nestedPath,
      value,
      metadata: metadata ?? undefined,
      operationType: activeOperationType,
      operationName: graphql.operationName,
    });
    onChange({
      ...graphql,
      query: nextQuery,
    });
  };

  const handleToggleVariableBinding = (
    fieldPath: string[],
    argName: string,
    enabled: boolean,
  ) => {
    const result = toggleVariableBinding({
      queryText: graphql.query ?? '',
      variablesJson: graphql.variables ?? '{}',
      fieldPath,
      argName,
      enabled,
      metadata: metadata ?? undefined,
      operationType: activeOperationType,
      operationName: graphql.operationName,
    });
    onChange({
      ...graphql,
      query: result.queryText,
      variables: result.variablesJson,
    });
  };

  const handlePrettify = () => {
    setFormatError(null);
    try {
      const nextQuery = prettifyGraphQLQuery(graphql.query ?? '');
      let nextVars = graphql.variables ?? '';
      if (nextVars.trim()) {
        nextVars = JSON.stringify(JSON.parse(nextVars), null, 2);
      }
      onChange({
        ...graphql,
        query: nextQuery,
        variables: nextVars,
      });
    } catch (err) {
      setFormatError(
        err instanceof Error ? err.message : 'Unable to format GraphQL document',
      );
    }
  };

  const isTestEnv = typeof process !== 'undefined' && Boolean(process.env.VITEST);

  return (
    <div
      data-testid="graphql-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        minHeight: 260,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: colors.bgPrimary,
      }}
    >
      {/* Top Schema Discovery & Actions Toolbar */}
      <div
        data-testid="graphql-schema-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '6px 10px',
          backgroundColor: colors.bgSecondary,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Schema Status Badge */}
          {schemaRecord ? (
            <span
              data-testid="graphql-schema-status-badge"
              title={`Source: ${schemaRecord.sourceLabel} • Fetched at ${schemaRecord.fetchedAt} • ${schemaRecord.diffSummary.summaryText}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 999,
                backgroundColor: '#22c55e22',
                color: '#22c55e',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <CheckCircle2 size={12} />
              Loaded • {schemaRecord.metadata.typeCount} types
              {schemaRecord.diffSummary.hasChanges
                ? ` (${schemaRecord.diffSummary.summaryText})`
                : ''}
            </span>
          ) : (
            <span
              data-testid="graphql-schema-status-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 999,
                backgroundColor: colors.bgPrimary,
                color: colors.textMuted,
                border: `1px solid ${colors.border}`,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {isLoadingSchema ? 'Introspecting…' : 'No Schema Loaded'}
            </span>
          )}

          {/* Discover / Refresh Schema Button */}
          <button
            type="button"
            data-testid="graphql-refresh-schema-btn"
            disabled={isLoadingSchema}
            onClick={() => void handleDiscoverSchema()}
            title={schemaRecord ? 'Refresh Schema' : 'Discover Schema'}
            aria-label={schemaRecord ? 'Refresh Schema' : 'Discover Schema'}
            aria-busy={isLoadingSchema}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: 6,
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textPrimary,
              fontSize: 11,
              fontWeight: 600,
              cursor: isLoadingSchema ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw size={12} />
          </button>

          {/* Load Local .graphql / .json File Button */}
          <button
            type="button"
            data-testid="graphql-load-local-schema-btn"
            onClick={() => void handlePickLocalSchemaFile()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={12} />
            Load .graphql / .json File
          </button>

          {/* Auto-Introspect Toggle */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: colors.textSecondary,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              data-testid="graphql-auto-introspect-checkbox"
              checked={autoIntrospectEnabled}
              onChange={e =>
                onChange({
                  ...graphql,
                  schemaSource: {
                    ...(graphql.schemaSource ?? { mode: 'introspect' }),
                    autoIntrospectOnOpen: e.target.checked,
                  },
                })
              }
            />
            Auto-Introspect
          </label>
        </div>

        {/* Right Controls: Operation Selector + Prettify + Docs Explorer Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selectionState.allOperations.length > 0 && (
            <select
              aria-label="GraphQL Operation Name"
              data-testid="graphql-operation-select"
              value={
                graphql.operationName ?? selectionState.operationName ?? ''
              }
              onChange={e =>
                onChange({
                  ...graphql,
                  operationName: e.target.value || undefined,
                })
              }
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgPrimary,
                color: colors.textPrimary,
                fontSize: 11,
                fontFamily: 'monospace',
              }}
            >
              {selectionState.allOperations.map(op => (
                <option key={op.name} value={op.name}>
                  {op.operationType}: {op.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            data-testid="graphql-prettify-btn"
            onClick={handlePrettify}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bgPrimary,
              color: colors.textPrimary,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Sparkles size={12} />
            Prettify
          </button>

          <button
            type="button"
            data-testid="graphql-docs-toggle-btn"
            onClick={() => setDocsOpen(prev => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 9px',
              borderRadius: 5,
              border: `1px solid ${docsOpen ? colors.accent : colors.border}`,
              backgroundColor: docsOpen ? `${colors.accent}22` : colors.bgPrimary,
              color: docsOpen ? colors.accent : colors.textSecondary,
              fontSize: 11,
              fontWeight: docsOpen ? 700 : 500,
              cursor: 'pointer',
            }}
          >
            <BookOpen size={12} />
            Docs Explorer
          </button>
        </div>
      </div>

      {/* Actionable Schema Error Banner with Try Again */}
      {schemaError && (
        <div
          data-testid="graphql-schema-error-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 10px',
            backgroundColor: `${colors.danger}18`,
            borderBottom: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} />
            <span>{schemaError}</span>
          </div>
          <button
            type="button"
            data-testid="graphql-schema-try-again-btn"
            onClick={() => void handleDiscoverSchema()}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: `1px solid ${colors.danger}`,
              backgroundColor: colors.bgPrimary,
              color: colors.danger,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* AST Syntax Diagnostic Banner when user is mid-keystroke */}
      {!selectionState.valid && selectionState.syntaxError && (
        <div
          data-testid="graphql-ast-syntax-warning"
          style={{
            padding: '4px 10px',
            backgroundColor: '#f59e0b22',
            borderBottom: `1px solid #f59e0b`,
            color: '#f59e0b',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          Syntax Error
          {selectionState.syntaxError.line
            ? ` (line ${selectionState.syntaxError.line}:${selectionState.syntaxError.column ?? 1})`
            : ''}
          : {selectionState.syntaxError.message}
        </div>
      )}

      {formatError && (
        <div
          data-testid="graphql-format-error"
          style={{
            padding: '4px 10px',
            color: colors.danger,
            fontSize: 11,
          }}
        >
          {formatError}
        </div>
      )}

      {/* Main Split Area: Left Visual Query Designer <-> Right Query + Variables Editors (+ Optional Docs Drawer) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
          <ResizableSplitPane
            testId="graphql-designer-editor-split"
            direction="horizontal"
            initialSize={290}
            minSize={200}
            maxSize={560}
            collapsible
            firstPane={
              <GraphQLQueryDesigner
                metadata={metadata}
                selectionState={selectionState}
                activeOperationType={activeOperationType}
                onChangeOperationType={setActiveOperationType}
                onToggleField={handleToggleField}
                onToggleInlineFragment={handleToggleInlineFragment}
                onChangeArgument={handleChangeArgument}
                onChangeNestedArgument={handleChangeNestedArgument}
                onToggleVariableBinding={handleToggleVariableBinding}
              />
            }
            secondPane={
              <ResizableSplitPane
                testId="graphql-query-variables-split"
                direction="horizontal"
                primaryPane="second"
                initialSize={280}
                minSize={180}
                maxSize={560}
                storageKey="graphql-variables"
                collapsibleBoth
                firstPane={
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: colors.textSecondary,
                        backgroundColor: colors.bgSecondary,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      GraphQL Query / Mutation
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      {isTestEnv ? (
                        <textarea
                          aria-label="GraphQL Query Editor"
                          data-testid="graphql-query-textarea"
                          value={graphql.query ?? ''}
                          onChange={e =>
                            onChange({ ...graphql, query: e.target.value })
                          }
                          style={{
                            width: '100%',
                            height: '100%',
                            padding: 10,
                            border: 'none',
                            backgroundColor: colors.bgPrimary,
                            color: colors.textPrimary,
                            fontFamily: 'monospace',
                            fontSize: 12,
                            resize: 'none',
                          }}
                        />
                      ) : (
                        <Editor
                          height="100%"
                          language="graphql"
                          theme={isLight ? 'light' : 'vs-dark'}
                          value={graphql.query ?? ''}
                          beforeMount={handleConfigureMonaco}
                          onChange={val =>
                            onChange({ ...graphql, query: val ?? '' })
                          }
                          options={{
                            minimap: { enabled: false },
                            stickyScroll: { enabled: false },
                            fontSize: 12,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                          }}
                        />
                      )}
                    </div>
                  </div>
                }
                secondPane={
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                    }}
                  >
                    <div
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: colors.textSecondary,
                        backgroundColor: colors.bgSecondary,
                        borderBottom: `1px solid ${colors.border}`,
                      }}
                    >
                      GraphQL Variables (JSON)
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      {isTestEnv ? (
                        <textarea
                          aria-label="GraphQL Variables Editor"
                          data-testid="graphql-variables-textarea"
                          value={graphql.variables ?? ''}
                          onChange={e =>
                            onChange({ ...graphql, variables: e.target.value })
                          }
                          style={{
                            width: '100%',
                            height: '100%',
                            padding: 10,
                            border: 'none',
                            backgroundColor: colors.bgPrimary,
                            color: colors.textPrimary,
                            fontFamily: 'monospace',
                            fontSize: 12,
                            resize: 'none',
                          }}
                        />
                      ) : (
                        <Editor
                          height="100%"
                          language="json"
                          theme={isLight ? 'light' : 'vs-dark'}
                          value={graphql.variables ?? ''}
                          onChange={val =>
                            onChange({ ...graphql, variables: val ?? '' })
                          }
                          options={{
                            minimap: { enabled: false },
                            stickyScroll: { enabled: false },
                            fontSize: 12,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                          }}
                        />
                      )}
                    </div>
                  </div>
                }
              />
            }
          />
        </div>

        {/* Collapsible Right Schema Documentation Drawer */}
        {docsOpen && (
          <div
            data-testid="graphql-docs-drawer"
            style={{ width: 320, flexShrink: 0, height: '100%' }}
          >
            <GraphQLSchemaExplorer
              metadata={metadata}
              onGenerateOperation={generated => {
                onChange({
                  ...graphql,
                  operationName: generated.operationName,
                  query: generated.query,
                  variables: generated.variablesJson,
                });
              }}
              onClose={() => setDocsOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
