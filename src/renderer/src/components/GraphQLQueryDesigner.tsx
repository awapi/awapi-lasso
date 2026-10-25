import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Filter,
  GitBranch,
  Layers,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  joinSelectionPath,
  toInlineFragmentSegment,
  type DesignerSelectionState,
  type GraphQLOperationType,
} from '../../../shared/graphqlAstSync';
import type {
  NormalizedGraphQLArgument,
  NormalizedGraphQLField,
  NormalizedGraphQLInputField,
  NormalizedGraphQLSchemaMetadata,
} from '../../../shared/graphqlSchemaLoader';
import { useTheme } from '../context/ThemeContext';

export interface GraphQLQueryDesignerProps {
  metadata: NormalizedGraphQLSchemaMetadata | null;
  selectionState: DesignerSelectionState;
  activeOperationType: GraphQLOperationType;
  onChangeOperationType: (operationType: GraphQLOperationType) => void;
  onToggleField: (fieldPath: string[], checked: boolean) => void;
  onToggleInlineFragment: (
    parentFieldPath: string[],
    typeName: string,
    checked: boolean,
  ) => void;
  onChangeArgument: (fieldPath: string[], argName: string, value: string) => void;
  onChangeNestedArgument?: (
    fieldPath: string[],
    argName: string,
    nestedPath: Array<string | number>,
    value: string,
  ) => void;
  onToggleVariableBinding: (
    fieldPath: string[],
    argName: string,
    enabled: boolean,
  ) => void;
  /** Maximum recursion depth for cyclic object references (default 4) */
  maxDepth?: number;
}

const ARG_BADGE_COLOR = '#f97316';

function getDefaultScalarValue(
  metadata: NormalizedGraphQLSchemaMetadata,
  namedType: string,
  namedTypeKind: string,
  defaultValue?: string,
  isList?: boolean,
): string {
  if (defaultValue !== undefined) {
    return defaultValue.replace(/^["']|["']$/g, '');
  }
  if (namedTypeKind === 'ENUM') {
    const enumMeta = metadata.types[namedType];
    const firstEnum = enumMeta?.enumValues?.[0]?.name ?? '';
    if (!firstEnum) return '';
    return isList ? `[${firstEnum}]` : firstEnum;
  }
  if (namedType === 'Boolean') return 'true';
  if (namedType === 'Int' || namedType === 'Float') return '0';
  return '';
}

function parseEnumListString(rawVal: string): string[] {
  const cleaned = rawVal.trim().replace(/^\[|\]$/g, '');
  if (!cleaned) return [];
  return cleaned
    .split(',')
    .map(part => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function serializeEnumListString(values: string[]): string {
  if (values.length === 0) return '';
  return `[${values.join(', ')}]`;
}

export const GraphQLQueryDesigner: React.FC<GraphQLQueryDesignerProps> = ({
  metadata,
  selectionState,
  activeOperationType,
  onChangeOperationType,
  onToggleField,
  onToggleInlineFragment,
  onChangeArgument,
  onChangeNestedArgument,
  onToggleVariableBinding,
  maxDepth = 4,
}) => {
  const { colors } = useTheme();
  const [filterText, setFilterText] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [expandedInputObjects, setExpandedInputObjects] = useState<
    Record<string, boolean>
  >({});
  const [activeLeafEdits, setActiveLeafEdits] = useState<Record<string, boolean>>({});
  const [listItemCounts, setListItemCounts] = useState<Record<string, number>>({});

  const selectedPathSet = useMemo(
    () => new Set(selectionState.selectedFieldPaths),
    [selectionState.selectedFieldPaths],
  );
  const inlineFragmentSet = useMemo(
    () => new Set(selectionState.inlineFragmentPaths),
    [selectionState.inlineFragmentPaths],
  );

  const rootTypeName = useMemo(() => {
    if (!metadata) return null;
    if (activeOperationType === 'mutation') return metadata.mutationTypeName;
    if (activeOperationType === 'subscription') return metadata.subscriptionTypeName;
    return metadata.queryTypeName;
  }, [metadata, activeOperationType]);

  const rootFields = useMemo<NormalizedGraphQLField[]>(() => {
    if (!metadata || !rootTypeName) return [];
    const rootType = metadata.types[rootTypeName];
    const fields = rootType?.fields ?? [];
    const q = filterText.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.namedType.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q),
    );
  }, [metadata, rootTypeName, filterText]);

  const isNodeExpanded = (pathKey: string, defaultExpanded = false): boolean => {
    if (pathKey in expandedNodes) return expandedNodes[pathKey];
    if (selectedPathSet.has(pathKey) || inlineFragmentSet.has(pathKey)) return true;
    return defaultExpanded;
  };

  const toggleNodeExpanded = (pathKey: string) => {
    const current = isNodeExpanded(pathKey);
    setExpandedNodes(prev => ({ ...prev, [pathKey]: !current }));
  };

  if (!metadata) {
    return (
      <div
        data-testid="graphql-designer-empty"
        style={{
          padding: 16,
          fontSize: 12,
          color: colors.textMuted,
          textAlign: 'center',
        }}
      >
        Discover a remote schema or load a local <code>.graphql</code> / <code>.json</code>{' '}
        schema file to use the visual Query Designer.
      </div>
    );
  }

  const availableOps: Array<{
    type: GraphQLOperationType;
    label: string;
    enabled: boolean;
  }> = [
    { type: 'query', label: 'Query', enabled: Boolean(metadata.queryTypeName) },
    { type: 'mutation', label: 'Mutation', enabled: Boolean(metadata.mutationTypeName) },
    {
      type: 'subscription',
      label: 'Subscription',
      enabled: Boolean(metadata.subscriptionTypeName),
    },
  ];

  const isInputObjectExpanded = (
    inputObjKey: string,
    defaultExpanded = false,
  ): boolean => {
    if (inputObjKey in expandedInputObjects) {
      return expandedInputObjects[inputObjKey];
    }
    return defaultExpanded;
  };

  const toggleInputObjectExpanded = (
    inputObjKey: string,
    defaultExpanded = false,
  ) => {
    const current = isInputObjectExpanded(inputObjKey, defaultExpanded);
    setExpandedInputObjects(prev => ({ ...prev, [inputObjKey]: !current }));
  };

  const renderArgBadge = () => (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        fontFamily: 'monospace',
        color: ARG_BADGE_COLOR,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      }}
    >
      ARG
    </span>
  );

  const renderInputFieldRow = (
    fieldPath: string[],
    pathKey: string,
    rootArgName: string,
    inputField: NormalizedGraphQLInputField,
    nestedPath: Array<string | number>,
    nestedValues: Record<string, string>,
    depth: number,
  ): React.ReactNode => {
    const fieldNestedPath = [...nestedPath, inputField.name];
    const nestedKey = fieldNestedPath.join('.');
    const testIdKey = `${pathKey}-${rootArgName}-${nestedKey}`;
    const hasLeafInAst = nestedKey in nestedValues;
    const currentLeafVal = nestedValues[nestedKey] ?? '';

    const nestedInputTypeMeta =
      inputField.namedTypeKind === 'INPUT_OBJECT'
        ? metadata.types[inputField.namedType]
        : undefined;
    const enumType =
      inputField.namedTypeKind === 'ENUM'
        ? metadata.types[inputField.namedType]
        : undefined;

    // Nested INPUT_OBJECT branch (e.g. `availableQuantity: IntComparisonFilter` or `AND: [InventoryWhereInput!]` inside `where`)
    if (
      nestedInputTypeMeta &&
      nestedInputTypeMeta.inputFields &&
      nestedInputTypeMeta.inputFields.length > 0 &&
      depth < 3
    ) {
      const hasActiveNested = Object.keys(nestedValues).some(k =>
        k.startsWith(`${nestedKey}.`),
      );
      const isOpen = isInputObjectExpanded(testIdKey, hasActiveNested);
      const upperFieldName = inputField.name.toUpperCase();
      const isLogicalCombinator =
        upperFieldName === 'AND' ||
        upperFieldName === 'OR' ||
        upperFieldName === 'NOT' ||
        upperFieldName === '_AND' ||
        upperFieldName === '_OR' ||
        upperFieldName === '_NOT';

      // Compute active list item count for list-of-input-object nested fields (e.g. AND: [InventoryWhereInput!])
      let maxNestedIdx = -1;
      if (inputField.isList) {
        const prefix = `${nestedKey}.`;
        for (const k of Object.keys(nestedValues)) {
          if (k.startsWith(prefix)) {
            const rest = k.slice(prefix.length);
            const segIdx = Number.parseInt(rest.split('.')[0], 10);
            if (!Number.isNaN(segIdx) && segIdx > maxNestedIdx) {
              maxNestedIdx = segIdx;
            }
          }
        }
      }
      const nestedConfiguredCount = listItemCounts[testIdKey] ?? 1;
      const activeNestedListCount = Math.max(
        nestedConfiguredCount,
        maxNestedIdx + 1,
        1,
      );

      const handleToggleGroupCheckbox = (checked: boolean) => {
        if (checked) {
          setExpandedInputObjects(prev => ({ ...prev, [testIdKey]: true }));
        } else {
          setExpandedInputObjects(prev => ({ ...prev, [testIdKey]: false }));
          onChangeNestedArgument?.(fieldPath, rootArgName, fieldNestedPath, '');
        }
      };

      return (
        <div
          key={nestedKey}
          data-testid={`designer-nested-input-group-${testIdKey}`}
          style={{
            marginLeft: 16,
            borderLeft: `1px solid ${colors.border}`,
            paddingLeft: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 4px',
              fontSize: 12,
            }}
          >
            <button
              type="button"
              data-testid={`designer-nested-expand-btn-${testIdKey}`}
              onClick={() => toggleInputObjectExpanded(testIdKey, hasActiveNested)}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>

            <input
              type="checkbox"
              data-testid={`designer-nested-checkbox-${testIdKey}`}
              checked={isOpen || hasActiveNested}
              onChange={e => handleToggleGroupCheckbox(e.target.checked)}
              style={{ cursor: 'pointer', margin: 0 }}
            />

            {isLogicalCombinator && (
              <span
                data-testid={`designer-logical-group-icon-${testIdKey}`}
                title={`Logical ${upperFieldName} Condition Group`}
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                <GitBranch size={12} color={ARG_BADGE_COLOR} />
              </span>
            )}

            <span
              onClick={() => toggleInputObjectExpanded(testIdKey, hasActiveNested)}
              style={{
                fontFamily: 'monospace',
                fontWeight: hasActiveNested ? 700 : 500,
                color: hasActiveNested ? colors.accent : colors.textPrimary,
                cursor: 'pointer',
              }}
            >
              {inputField.name}
            </span>

            <span
              style={{
                fontSize: 11,
                color: colors.textMuted,
                fontFamily: 'monospace',
              }}
            >
              {inputField.typeSignature}
            </span>

            {renderArgBadge()}
          </div>

          {isOpen && (
            <div data-testid={`designer-nested-children-${testIdKey}`}>
              {inputField.isList ? (
                <>
                  {Array.from({ length: activeNestedListCount }).map((_, groupIdx) => (
                    <div
                      key={groupIdx}
                      data-testid={`designer-nested-list-item-${testIdKey}-${groupIdx}`}
                    >
                      {(activeNestedListCount > 1 || isLogicalCombinator) && (
                        <div
                          style={{
                            marginLeft: 16,
                            padding: '2px 6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: 10,
                            fontWeight: 700,
                            color: colors.textMuted,
                            fontFamily: 'monospace',
                          }}
                        >
                          <span>
                            {isLogicalCombinator
                              ? `${upperFieldName} Condition #${groupIdx + 1}`
                              : `Group #${groupIdx + 1}`}
                          </span>
                          {activeNestedListCount > 1 && (
                            <button
                              type="button"
                              data-testid={`designer-nested-list-remove-${testIdKey}-${groupIdx}`}
                              onClick={() => {
                                onChangeNestedArgument?.(
                                  fieldPath,
                                  rootArgName,
                                  [...fieldNestedPath, groupIdx],
                                  '',
                                );
                                setListItemCounts(prev => ({
                                  ...prev,
                                  [testIdKey]: Math.max(
                                    1,
                                    activeNestedListCount - 1,
                                  ),
                                }));
                              }}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: colors.danger,
                                cursor: 'pointer',
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      )}
                      {nestedInputTypeMeta.inputFields!.map(childIf =>
                        renderInputFieldRow(
                          fieldPath,
                          pathKey,
                          rootArgName,
                          childIf,
                          [...fieldNestedPath, groupIdx],
                          nestedValues,
                          depth + 1,
                        ),
                      )}
                    </div>
                  ))}
                  <div style={{ marginLeft: 24, padding: '3px 0' }}>
                    <button
                      type="button"
                      data-testid={`designer-nested-list-add-${testIdKey}`}
                      onClick={() =>
                        setListItemCounts(prev => ({
                          ...prev,
                          [testIdKey]: activeNestedListCount + 1,
                        }))
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 7px',
                        borderRadius: 4,
                        border: `1px solid ${colors.border}`,
                        backgroundColor: colors.bgSecondary,
                        color: colors.accent,
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Plus size={10} />
                      {isLogicalCombinator
                        ? `Add ${upperFieldName} Condition`
                        : `Add ${inputField.namedType}`}
                    </button>
                  </div>
                </>
              ) : (
                nestedInputTypeMeta.inputFields.map(childIf =>
                  renderInputFieldRow(
                    fieldPath,
                    pathKey,
                    rootArgName,
                    childIf,
                    fieldNestedPath,
                    nestedValues,
                    depth + 1,
                  ),
                )
              )}
            </div>
          )}
        </div>
      );
    }

    // Leaf input field inside INPUT_OBJECT (e.g. `gte: Int`, `category: ProductCategory`, `field: InventorySortField!`)
    const isLeafChecked = hasLeafInAst || Boolean(activeLeafEdits[testIdKey]);

    const handleToggleLeafCheckbox = (checked: boolean) => {
      if (checked) {
        setActiveLeafEdits(prev => ({ ...prev, [testIdKey]: true }));
        if (!hasLeafInAst) {
          const initialVal = getDefaultScalarValue(
            metadata,
            inputField.namedType,
            inputField.namedTypeKind,
            inputField.defaultValue,
          );
          if (initialVal !== '') {
            onChangeNestedArgument?.(
              fieldPath,
              rootArgName,
              fieldNestedPath,
              initialVal,
            );
          }
        }
      } else {
        setActiveLeafEdits(prev => ({ ...prev, [testIdKey]: false }));
        onChangeNestedArgument?.(fieldPath, rootArgName, fieldNestedPath, '');
      }
    };

    return (
      <div
        key={nestedKey}
        data-testid={`designer-nested-input-row-${testIdKey}`}
        style={{
          marginLeft: 16,
          borderLeft: `1px solid ${colors.border}`,
          paddingLeft: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 4px',
            fontSize: 12,
          }}
        >
          <span style={{ width: 13, display: 'inline-block' }} />

          <input
            type="checkbox"
            data-testid={`designer-nested-checkbox-${testIdKey}`}
            checked={isLeafChecked}
            onChange={e => handleToggleLeafCheckbox(e.target.checked)}
            style={{ cursor: 'pointer', margin: 0 }}
          />

          <span
            title={
              inputField.description ||
              `${inputField.name}: ${inputField.typeSignature}`
            }
            onClick={() => handleToggleLeafCheckbox(!isLeafChecked)}
            style={{
              color: isLeafChecked ? colors.accent : colors.textPrimary,
              fontWeight: isLeafChecked ? 700 : 500,
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            {inputField.name}
            {inputField.isNonNull ? '*' : ''}
          </span>

          <span
            style={{
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
          >
            {inputField.typeSignature}
          </span>

          {renderArgBadge()}

          {isLeafChecked && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 110,
                maxWidth: 180,
              }}
            >
              {enumType && enumType.enumValues && enumType.enumValues.length > 0 ? (
                <select
                  data-testid={`designer-nested-input-${testIdKey}`}
                  value={currentLeafVal}
                  onChange={e =>
                    onChangeNestedArgument?.(
                      fieldPath,
                      rootArgName,
                      fieldNestedPath,
                      e.target.value,
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                >
                  <option value="">(select)</option>
                  {enumType.enumValues.map(ev => (
                    <option key={ev.name} value={ev.name}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              ) : inputField.namedType === 'Boolean' && !inputField.isList ? (
                <select
                  data-testid={`designer-nested-input-${testIdKey}`}
                  value={currentLeafVal}
                  onChange={e =>
                    onChangeNestedArgument?.(
                      fieldPath,
                      rootArgName,
                      fieldNestedPath,
                      e.target.value,
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type="text"
                  data-testid={`designer-nested-input-${testIdKey}`}
                  value={currentLeafVal}
                  placeholder={
                    inputField.defaultValue !== undefined
                      ? `${inputField.defaultValue}`
                      : inputField.typeSignature
                  }
                  onChange={e =>
                    onChangeNestedArgument?.(
                      fieldPath,
                      rootArgName,
                      fieldNestedPath,
                      e.target.value,
                    )
                  }
                  style={{
                    width: '100%',
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderArgumentRow = (
    fieldPath: string[],
    pathKey: string,
    arg: NormalizedGraphQLArgument,
  ) => {
    const argState = selectionState.fieldArguments[pathKey]?.[arg.name];
    const isVar = Boolean(argState?.isVariable);
    const currentVal = argState?.value ?? '';
    const nestedValues = argState?.nestedValues ?? {};
    const hasNestedData = Object.keys(nestedValues).length > 0;
    const isArgInAst = Boolean(argState);

    const enumType =
      arg.namedTypeKind === 'ENUM' ? metadata.types[arg.namedType] : undefined;
    const inputObjectType =
      arg.namedTypeKind === 'INPUT_OBJECT' ? metadata.types[arg.namedType] : undefined;
    const isInputObjectArg = Boolean(
      inputObjectType &&
        inputObjectType.inputFields &&
        inputObjectType.inputFields.length > 0 &&
        onChangeNestedArgument,
    );

    const isEnumListArg = Boolean(
      arg.isList &&
        enumType &&
        enumType.enumValues &&
        enumType.enumValues.length > 0,
    );
    const isExpandableArg = isInputObjectArg || isEnumListArg;

    const lowerArgName = arg.name.toLowerCase();
    const isWhereArg =
      lowerArgName === 'where' ||
      lowerArgName === 'filter' ||
      lowerArgName.endsWith('filter');
    const isOrderByArg =
      lowerArgName === 'orderby' ||
      lowerArgName === 'order_by' ||
      lowerArgName === 'sort' ||
      lowerArgName === 'sortby';
    const isGroupByArg =
      lowerArgName === 'groupby' ||
      lowerArgName === 'group_by' ||
      lowerArgName === 'by';

    const builderKey = `${pathKey}-${arg.name}`;
    const isArgExpanded =
      isExpandableArg &&
      !isVar &&
      isInputObjectExpanded(builderKey, hasNestedData || (isEnumListArg && isArgInAst));
    const isScalarArgChecked =
      !isExpandableArg && (isArgInAst || Boolean(activeLeafEdits[builderKey]));
    const isRowChecked = isExpandableArg
      ? isArgExpanded || hasNestedData || isVar || (isEnumListArg && isArgInAst)
      : isScalarArgChecked;

    // Compute how many list items exist for list of INPUT_OBJECT (e.g. orderBy: [InventoryOrderByInput!])
    let maxExistingIndex = -1;
    for (const k of Object.keys(nestedValues)) {
      const firstSeg = k.split('.')[0];
      const idx = Number.parseInt(firstSeg, 10);
      if (!Number.isNaN(idx) && idx > maxExistingIndex) {
        maxExistingIndex = idx;
      }
    }
    const configuredCount = listItemCounts[builderKey] ?? 1;
    const activeListCount = Math.max(configuredCount, maxExistingIndex + 1, 1);

    const handleToggleArgCheckbox = (checked: boolean) => {
      if (isEnumListArg) {
        if (checked) {
          setExpandedInputObjects(prev => ({ ...prev, [builderKey]: true }));
          if (!isArgInAst) {
            const defaultVal = getDefaultScalarValue(
              metadata,
              arg.namedType,
              arg.namedTypeKind,
              arg.defaultValue,
              true,
            );
            if (defaultVal !== '') {
              onChangeArgument(fieldPath, arg.name, defaultVal);
            }
          }
        } else {
          setExpandedInputObjects(prev => ({ ...prev, [builderKey]: false }));
          if (isVar) {
            onToggleVariableBinding(fieldPath, arg.name, false);
          }
          onChangeArgument(fieldPath, arg.name, '');
        }
        return;
      }

      if (isInputObjectArg) {
        if (checked) {
          setExpandedInputObjects(prev => ({ ...prev, [builderKey]: true }));
        } else {
          setExpandedInputObjects(prev => ({ ...prev, [builderKey]: false }));
          if (isVar) {
            onToggleVariableBinding(fieldPath, arg.name, false);
          }
          onChangeArgument(fieldPath, arg.name, '');
        }
        return;
      }

      if (checked) {
        setActiveLeafEdits(prev => ({ ...prev, [builderKey]: true }));
        if (!isArgInAst) {
          const defaultVal = getDefaultScalarValue(
            metadata,
            arg.namedType,
            arg.namedTypeKind,
            arg.defaultValue,
            arg.isList,
          );
          if (defaultVal !== '') {
            onChangeArgument(fieldPath, arg.name, defaultVal);
          }
        }
      } else {
        setActiveLeafEdits(prev => ({ ...prev, [builderKey]: false }));
        if (isVar) {
          onToggleVariableBinding(fieldPath, arg.name, false);
        } else {
          onChangeArgument(fieldPath, arg.name, '');
        }
      }
    };

    return (
      <div
        key={arg.name}
        data-testid={`designer-arg-row-${pathKey}-${arg.name}`}
        style={{
          marginLeft: 16,
          borderLeft: `1px solid ${colors.border}`,
          paddingLeft: 8,
        }}
      >
        {/* Main Unified Tree Row for Argument */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 4px',
            fontSize: 12,
          }}
        >
          {isExpandableArg ? (
            <button
              type="button"
              data-testid={`designer-arg-builder-toggle-${pathKey}-${arg.name}`}
              onClick={() =>
                toggleInputObjectExpanded(
                  builderKey,
                  hasNestedData || (isEnumListArg && isArgInAst),
                )
              }
              title={`Expand ${arg.name} (${arg.typeSignature})`}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {isArgExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span style={{ width: 13, display: 'inline-block' }} />
          )}

          <input
            type="checkbox"
            data-testid={`designer-arg-checkbox-${pathKey}-${arg.name}`}
            checked={isRowChecked}
            onChange={e => handleToggleArgCheckbox(e.target.checked)}
            style={{ cursor: 'pointer', margin: 0 }}
          />

          {isWhereArg && (
            <span
              data-testid={`designer-where-icon-${pathKey}-${arg.name}`}
              title="Where / Filter Argument"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <Filter size={12} color={ARG_BADGE_COLOR} />
            </span>
          )}

          {isOrderByArg && (
            <span
              data-testid={`designer-orderby-icon-${pathKey}-${arg.name}`}
              title="OrderBy / Sort Argument"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <ArrowUpDown size={12} color={ARG_BADGE_COLOR} />
            </span>
          )}

          {isGroupByArg && (
            <span
              data-testid={`designer-groupby-icon-${pathKey}-${arg.name}`}
              title="GroupBy / Aggregation Dimension Argument"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <Layers size={12} color={ARG_BADGE_COLOR} />
            </span>
          )}

          <span
            title={arg.description || `${arg.name}: ${arg.typeSignature}`}
            onClick={() => {
              if (isExpandableArg) {
                toggleInputObjectExpanded(
                  builderKey,
                  hasNestedData || (isEnumListArg && isArgInAst),
                );
              } else {
                handleToggleArgCheckbox(!isRowChecked);
              }
            }}
            style={{
              fontFamily: 'monospace',
              fontWeight: isRowChecked ? 700 : 500,
              color: isRowChecked ? colors.accent : colors.textPrimary,
              cursor: 'pointer',
            }}
          >
            {arg.name}
            {arg.isNonNull ? '*' : ''}
          </span>

          <span
            style={{
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
          >
            {arg.typeSignature}
          </span>

          {renderArgBadge()}

          {/* Inline Input + $var button when checked (or for $var promotion on input objects) */}
          {isRowChecked && !isExpandableArg && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {isVar ? (
                <input
                  type="text"
                  readOnly
                  data-testid={`designer-arg-input-${pathKey}-${arg.name}`}
                  value={currentVal || `$${arg.name}`}
                  style={{
                    width: 110,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.accent}`,
                    backgroundColor: `${colors.accent}18`,
                    color: colors.accent,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />
              ) : enumType &&
                enumType.enumValues &&
                enumType.enumValues.length > 0 ? (
                <select
                  data-testid={`designer-arg-input-${pathKey}-${arg.name}`}
                  value={currentVal}
                  onChange={e =>
                    onChangeArgument(fieldPath, arg.name, e.target.value)
                  }
                  style={{
                    width: 120,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                >
                  <option value="">(unset)</option>
                  {enumType.enumValues.map(ev => (
                    <option key={ev.name} value={ev.name}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  data-testid={`designer-arg-input-${pathKey}-${arg.name}`}
                  value={currentVal}
                  placeholder={
                    arg.defaultValue !== undefined
                      ? `${arg.defaultValue}`
                      : arg.typeSignature
                  }
                  onChange={e =>
                    onChangeArgument(fieldPath, arg.name, e.target.value)
                  }
                  style={{
                    width: 110,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgSecondary,
                    color: colors.textPrimary,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />
              )}

              <button
                type="button"
                data-testid={`designer-arg-var-btn-${pathKey}-${arg.name}`}
                onClick={() => onToggleVariableBinding(fieldPath, arg.name, !isVar)}
                title={
                  isVar
                    ? 'Bound to GraphQL operation $variable (click to use literal)'
                    : 'Promote argument to GraphQL operation $variable'
                }
                style={{
                  padding: '2px 5px',
                  borderRadius: 4,
                  border: `1px solid ${isVar ? colors.accent : colors.border}`,
                  backgroundColor: isVar ? colors.accent : colors.bgSecondary,
                  color: isVar ? '#ffffff' : colors.textSecondary,
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                $var
              </button>
            </div>
          )}

          {isExpandableArg && isRowChecked && (
            <button
              type="button"
              data-testid={`designer-arg-var-btn-${pathKey}-${arg.name}`}
              onClick={() => onToggleVariableBinding(fieldPath, arg.name, !isVar)}
              title={
                isVar
                  ? 'Bound to GraphQL operation $variable (click to use inline fields)'
                  : 'Bind argument to a GraphQL $variable'
              }
              style={{
                marginLeft: 'auto',
                padding: '2px 5px',
                borderRadius: 4,
                border: `1px solid ${isVar ? colors.accent : colors.border}`,
                backgroundColor: isVar ? colors.accent : colors.bgSecondary,
                color: isVar ? '#ffffff' : colors.textSecondary,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'monospace',
                cursor: 'pointer',
              }}
            >
              {isVar ? `$${arg.name}` : '$var'}
            </button>
          )}
        </div>

        {/* Expanded Multi-Select Enum List Checkboxes (e.g. groupBy: [InventoryGroupField!]!) */}
        {isArgExpanded && isEnumListArg && enumType && enumType.enumValues && (
          <div data-testid={`designer-arg-enum-list-${pathKey}-${arg.name}`}>
            {enumType.enumValues.map(ev => {
              const selectedEnums = parseEnumListString(currentVal);
              const isOptionChecked = selectedEnums.includes(ev.name);
              return (
                <div
                  key={ev.name}
                  data-testid={`designer-arg-enum-option-${pathKey}-${arg.name}-${ev.name}`}
                  style={{
                    marginLeft: 16,
                    borderLeft: `1px solid ${colors.border}`,
                    paddingLeft: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    paddingTop: 2,
                    paddingBottom: 2,
                    fontSize: 12,
                  }}
                >
                  <span style={{ width: 13, display: 'inline-block' }} />
                  <input
                    type="checkbox"
                    data-testid={`designer-arg-enum-checkbox-${pathKey}-${arg.name}-${ev.name}`}
                    checked={isOptionChecked}
                    onChange={e => {
                      const nextList = e.target.checked
                        ? [...selectedEnums, ev.name]
                        : selectedEnums.filter(item => item !== ev.name);
                      onChangeArgument(
                        fieldPath,
                        arg.name,
                        serializeEnumListString(nextList),
                      );
                    }}
                    style={{ cursor: 'pointer', margin: 0 }}
                  />
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: isOptionChecked ? 700 : 500,
                      color: isOptionChecked ? colors.accent : colors.textPrimary,
                    }}
                  >
                    {ev.name}
                  </span>
                  {renderArgBadge()}
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded Nested Children for INPUT_OBJECT / Where / OrderBy */}
        {isArgExpanded && inputObjectType && inputObjectType.inputFields && (
          <div data-testid={`designer-arg-builder-${pathKey}-${arg.name}`}>
            {arg.isList ? (
              <>
                {Array.from({ length: activeListCount }).map((_, itemIdx) => (
                  <div
                    key={itemIdx}
                    data-testid={`designer-arg-list-item-${pathKey}-${arg.name}-${itemIdx}`}
                  >
                    {activeListCount > 1 && (
                      <div
                        style={{
                          marginLeft: 16,
                          padding: '2px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 10,
                          fontWeight: 700,
                          color: colors.textMuted,
                          fontFamily: 'monospace',
                        }}
                      >
                        <span>
                          {isOrderByArg
                            ? `Sort #${itemIdx + 1}`
                            : `Item #${itemIdx + 1}`}
                        </span>
                        <button
                          type="button"
                          data-testid={`designer-arg-list-remove-${pathKey}-${arg.name}-${itemIdx}`}
                          onClick={() => {
                            onChangeNestedArgument?.(
                              fieldPath,
                              arg.name,
                              [itemIdx],
                              '',
                            );
                            setListItemCounts(prev => ({
                              ...prev,
                              [builderKey]: Math.max(1, activeListCount - 1),
                            }));
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: colors.danger,
                            cursor: 'pointer',
                            padding: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                    {inputObjectType.inputFields!.map(inf =>
                      renderInputFieldRow(
                        fieldPath,
                        pathKey,
                        arg.name,
                        inf,
                        [itemIdx],
                        nestedValues,
                        0,
                      ),
                    )}
                  </div>
                ))}
                <div style={{ marginLeft: 24, padding: '3px 0' }}>
                  <button
                    type="button"
                    data-testid={`designer-arg-list-add-${pathKey}-${arg.name}`}
                    onClick={() =>
                      setListItemCounts(prev => ({
                        ...prev,
                        [builderKey]: activeListCount + 1,
                      }))
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      borderRadius: 4,
                      border: `1px solid ${colors.border}`,
                      backgroundColor: colors.bgSecondary,
                      color: colors.accent,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={10} />
                    {isOrderByArg ? 'Add Sort Rule' : `Add ${arg.namedType}`}
                  </button>
                </div>
              </>
            ) : (
              inputObjectType.inputFields.map(inf =>
                renderInputFieldRow(
                  fieldPath,
                  pathKey,
                  arg.name,
                  inf,
                  [],
                  nestedValues,
                  0,
                ),
              )
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFieldNode = (
    field: NormalizedGraphQLField,
    parentSegments: string[],
    depth: number,
  ): React.ReactNode => {
    const fieldPath = [...parentSegments, field.name];
    const pathKey = joinSelectionPath(fieldPath);
    const isChecked = selectedPathSet.has(pathKey);

    const targetType = metadata.types[field.namedType];
    const hasReturnSubFields =
      depth < maxDepth &&
      targetType &&
      ((targetType.fields && targetType.fields.length > 0) ||
        (targetType.possibleTypes && targetType.possibleTypes.length > 0));
    const hasArgs = field.args.length > 0;
    const isExpandable = Boolean(hasReturnSubFields || hasArgs);

    const expanded = Boolean(isExpandable && isNodeExpanded(pathKey));

    return (
      <div
        key={pathKey}
        data-testid={`designer-field-node-${pathKey}`}
        style={{
          marginLeft: depth === 0 ? 0 : 16,
          borderLeft: depth === 0 ? 'none' : `1px solid ${colors.border}`,
          paddingLeft: depth === 0 ? 0 : 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 4px',
            borderRadius: 4,
          }}
        >
          {isExpandable ? (
            <button
              type="button"
              data-testid={`designer-expand-btn-${pathKey}`}
              onClick={() => toggleNodeExpanded(pathKey)}
              aria-label={expanded ? `Collapse ${field.name}` : `Expand ${field.name}`}
              style={{
                border: 'none',
                background: 'transparent',
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span style={{ width: 13, display: 'inline-block' }} />
          )}

          <input
            type="checkbox"
            data-testid={`designer-checkbox-${pathKey}`}
            checked={isChecked}
            onChange={e => onToggleField(fieldPath, e.target.checked)}
            style={{ cursor: 'pointer', margin: 0 }}
          />

          <span
            title={field.description || `${field.name}: ${field.typeSignature}`}
            onClick={() => {
              if (isExpandable) toggleNodeExpanded(pathKey);
            }}
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: isChecked ? 700 : 500,
              color: isChecked ? colors.accent : colors.textPrimary,
              cursor: isExpandable ? 'pointer' : 'default',
              textDecoration: field.isDeprecated ? 'line-through' : 'none',
            }}
          >
            {field.name}
          </span>

          <span
            data-testid={`designer-type-badge-${pathKey}`}
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: colors.textMuted,
            }}
          >
            {field.typeSignature}
          </span>

          {field.isDeprecated && (
            <span
              data-testid={`designer-deprecated-badge-${pathKey}`}
              title={
                field.deprecationReason
                  ? `@deprecated: ${field.deprecationReason}`
                  : '@deprecated'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 10,
                color: '#f59e0b',
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={11} />
              deprecated
            </span>
          )}
        </div>

        {/* Unified Children List (Arguments with ARG badge first, followed by Return Sub-Fields & Fragments) */}
        {expanded && (
          <div data-testid={`designer-children-${pathKey}`}>
            {field.description && depth === 0 && (
              <div
                style={{
                  marginLeft: 20,
                  padding: '2px 4px 4px 4px',
                  fontSize: 11,
                  color: colors.textMuted,
                }}
              >
                {field.description}
              </div>
            )}

            {/* 1. Arguments directly in the unified tree */}
            {hasArgs && (
              <div data-testid={`designer-args-panel-${pathKey}`}>
                {field.args.map(arg => renderArgumentRow(fieldPath, pathKey, arg))}
              </div>
            )}

            {/* 2. Direct return fields on Object or Interface */}
            {targetType &&
              (targetType.fields ?? []).map(childField =>
                renderFieldNode(childField, fieldPath, depth + 1),
              )}

            {/* 3. Inline Fragments (... on ConcreteType) for Union or Interface */}
            {targetType &&
              (targetType.kind === 'UNION' || targetType.kind === 'INTERFACE') &&
              (targetType.possibleTypes ?? []).map(memberTypeName => {
                const fragSegment = toInlineFragmentSegment(memberTypeName);
                const fragPath = [...fieldPath, fragSegment];
                const fragPathKey = joinSelectionPath(fragPath);
                const fragChecked =
                  inlineFragmentSet.has(fragPathKey) ||
                  selectionState.selectedFieldPaths.some(p =>
                    p.startsWith(`${fragPathKey}.`),
                  );
                const fragExpanded = isNodeExpanded(fragPathKey, fragChecked);
                const memberTypeMeta = metadata.types[memberTypeName];

                return (
                  <div
                    key={fragPathKey}
                    data-testid={`designer-fragment-node-${fragPathKey}`}
                    style={{
                      marginLeft: 16,
                      borderLeft: `1px dashed ${colors.border}`,
                      paddingLeft: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 4px',
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`designer-expand-btn-${fragPathKey}`}
                        onClick={() => toggleNodeExpanded(fragPathKey)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: colors.textSecondary,
                          cursor: 'pointer',
                          padding: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        {fragExpanded ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>

                      <input
                        type="checkbox"
                        data-testid={`designer-fragment-checkbox-${fragPathKey}`}
                        checked={fragChecked}
                        onChange={e =>
                          onToggleInlineFragment(
                            fieldPath,
                            memberTypeName,
                            e.target.checked,
                          )
                        }
                        style={{ cursor: 'pointer', margin: 0 }}
                      />

                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          color: fragChecked ? colors.accent : colors.textSecondary,
                        }}
                      >
                        ... on {memberTypeName}
                      </span>
                    </div>

                    {fragExpanded &&
                      memberTypeMeta &&
                      (memberTypeMeta.fields ?? []).map(memberField =>
                        renderFieldNode(memberField, fragPath, depth + 2),
                      )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="graphql-query-designer"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: colors.bgPrimary,
        overflow: 'hidden',
      }}
    >
      {/* Root Operation Tabs: Query | Mutation | Subscription */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.bgSecondary,
        }}
      >
        {availableOps.map(op => {
          const isActive = activeOperationType === op.type;
          return (
            <button
              key={op.type}
              type="button"
              disabled={!op.enabled}
              data-testid={`designer-op-tab-${op.type}`}
              onClick={() => onChangeOperationType(op.type)}
              style={{
                padding: '4px 9px',
                borderRadius: 5,
                border: `1px solid ${isActive ? colors.accent : colors.border}`,
                backgroundColor: isActive ? `${colors.accent}22` : 'transparent',
                color: !op.enabled
                  ? colors.textMuted
                  : isActive
                    ? colors.accent
                    : colors.textSecondary,
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                cursor: op.enabled ? 'pointer' : 'not-allowed',
                opacity: op.enabled ? 1 : 0.45,
              }}
            >
              {op.label}
            </button>
          );
        })}
      </div>

      {/* Field Search / Filter Input */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Search size={13} color={colors.textMuted} />
        <input
          type="text"
          data-testid="designer-field-search"
          value={filterText}
          placeholder={`Filter ${activeOperationType} fields…`}
          onChange={e => setFilterText(e.target.value)}
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

      {/* Recursive Field Tree */}
      <div
        data-testid="designer-field-tree"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 8px',
        }}
      >
        {rootFields.length === 0 ? (
          <div
            data-testid="designer-no-fields"
            style={{
              padding: 12,
              fontSize: 12,
              color: colors.textMuted,
              textAlign: 'center',
            }}
          >
            No matching fields found on {rootTypeName ?? activeOperationType}.
          </div>
        ) : (
          rootFields.map(field => renderFieldNode(field, [], 0))
        )}
      </div>
    </div>
  );
};
