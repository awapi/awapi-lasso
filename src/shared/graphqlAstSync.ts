import {
  Kind,
  OperationTypeNode,
  parse,
  parseType,
  parseValue,
  print,
  type ArgumentNode,
  type DefinitionNode,
  type DocumentNode,
  type FieldNode,
  type InlineFragmentNode,
  type ListValueNode,
  type ObjectFieldNode,
  type ObjectValueNode,
  type OperationDefinitionNode,
  type SelectionNode,
  type SelectionSetNode,
  type ValueNode,
  type VariableDefinitionNode,
} from 'graphql';
import {
  createSampleValueForType,
  type NormalizedGraphQLInputField,
  type NormalizedGraphQLSchemaMetadata,
  type NormalizedGraphQLTypeKind,
} from './graphqlSchemaLoader';

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription';

export interface DesignerArgumentState {
  value: string;
  isVariable: boolean;
  variableName?: string;
  /** Flattened nested input object / list values, e.g. `availableQuantity.gte -> "10"`, `0.field -> "UNIT_PRICE"` */
  nestedValues?: Record<string, string>;
}

export interface DesignerSelectionState {
  /** Whether the current query string parsed without syntax errors */
  valid: boolean;
  /** Parse error message and line/column when `valid === false` */
  syntaxError?: {
    message: string;
    line?: number;
    column?: number;
  };
  /** Active operation type (`query`, `mutation`, `subscription`) */
  operationType: GraphQLOperationType;
  /** Active operation name if named */
  operationName?: string;
  /** All operation names defined in the document (for the operation selector dropdown) */
  allOperations: Array<{
    name: string;
    operationType: GraphQLOperationType;
  }>;
  /**
   * Dot-joined field paths currently selected in the active operation.
   * Inline fragments are represented as `... on TypeName` segments in the path,
   * e.g. `searchCatalog.... on InventoryItem.sku` or `inventoryItem.warehouse.name`.
   */
  selectedFieldPaths: string[];
  /**
   * Inline fragment paths present in the AST, e.g. `searchCatalog.... on InventoryItem`.
   */
  inlineFragmentPaths: string[];
  /**
   * Map from fieldPath -> argumentName -> DesignerArgumentState
   */
  fieldArguments: Record<string, Record<string, DesignerArgumentState>>;
  /**
   * Map of variableName -> GraphQL type signature defined on the operation header
   */
  operationVariables: Record<string, string>;
}

export const INLINE_FRAGMENT_PREFIX = '... on ';

export function toInlineFragmentSegment(typeName: string): string {
  return `${INLINE_FRAGMENT_PREFIX}${typeName}`;
}

export function isInlineFragmentSegment(segment: string): boolean {
  return segment.startsWith(INLINE_FRAGMENT_PREFIX);
}

export function extractInlineFragmentTypeName(segment: string): string {
  return segment.slice(INLINE_FRAGMENT_PREFIX.length).trim();
}

export function joinSelectionPath(pathSegments: string[]): string {
  return pathSegments.join('.');
}

export function createEmptyDesignerSelectionState(
  operationType: GraphQLOperationType = 'query',
): DesignerSelectionState {
  return {
    valid: true,
    operationType,
    operationName: undefined,
    allOperations: [],
    selectedFieldPaths: [],
    inlineFragmentPaths: [],
    fieldArguments: {},
    operationVariables: {},
  };
}

function toOperationTypeNode(op: GraphQLOperationType): OperationTypeNode {
  switch (op) {
    case 'mutation':
      return OperationTypeNode.MUTATION;
    case 'subscription':
      return OperationTypeNode.SUBSCRIPTION;
    default:
      return OperationTypeNode.QUERY;
  }
}

function fromOperationTypeNode(node: OperationTypeNode): GraphQLOperationType {
  switch (node) {
    case OperationTypeNode.MUTATION:
      return 'mutation';
    case OperationTypeNode.SUBSCRIPTION:
      return 'subscription';
    default:
      return 'query';
  }
}

function extractLeadingComments(queryText: string): string[] {
  const lines = queryText.split(/\r?\n/);
  const comments: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      comments.push(line);
    } else {
      break;
    }
  }
  return comments;
}

function printDocumentPreservingLeadingComments(
  doc: DocumentNode,
  originalQueryText: string,
): string {
  const leading = extractLeadingComments(originalQueryText);
  const printed = print(doc).trim();
  if (leading.length > 0) {
    return `${leading.join('\n')}\n${printed}\n`;
  }
  return `${printed}\n`;
}

/**
 * Formats (prettifies) a GraphQL document while preserving leading `#` comments.
 */
export function prettifyGraphQLQuery(queryText: string): string {
  if (!queryText.trim()) return queryText;
  const ast = parse(queryText);
  return printDocumentPreservingLeadingComments(ast, queryText);
}

/**
 * Parses a GraphQL query string into a `DesignerSelectionState`.
 * If `parse` throws a syntax error while the user is mid-keystroke, returns
 * `previousState` (marked with `valid: false` and `syntaxError` metadata) so the
 * visual Query Designer never blanks out or loses its tree state.
 */
export function extractSelectionStateFromAst(
  queryText: string,
  options?: {
    targetOperationName?: string;
    previousState?: DesignerSelectionState;
  },
): DesignerSelectionState {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return createEmptyDesignerSelectionState(
      options?.previousState?.operationType ?? 'query',
    );
  }

  let doc: DocumentNode;
  try {
    doc = parse(trimmed);
  } catch (err) {
    const gqlErr = err as {
      message?: string;
      locations?: Array<{ line: number; column: number }>;
    };
    const loc = gqlErr?.locations?.[0];
    const fallback =
      options?.previousState ?? createEmptyDesignerSelectionState('query');
    return {
      ...fallback,
      valid: false,
      syntaxError: {
        message: gqlErr?.message ?? String(err),
        line: loc?.line,
        column: loc?.column,
      },
    };
  }

  const operations = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );

  const allOperations = operations.map((op, index) => ({
    name: op.name?.value || `Anonymous_${index + 1}`,
    operationType: fromOperationTypeNode(op.operation),
  }));

  if (operations.length === 0) {
    return createEmptyDesignerSelectionState('query');
  }

  const activeOp =
    (options?.targetOperationName
      ? operations.find(o => o.name?.value === options.targetOperationName)
      : undefined) ?? operations[0];

  const operationType = fromOperationTypeNode(activeOp.operation);
  const operationName = activeOp.name?.value;

  const operationVariables: Record<string, string> = {};
  for (const varDef of activeOp.variableDefinitions ?? []) {
    operationVariables[varDef.variable.name.value] = print(varDef.type);
  }

  const selectedFieldPaths: string[] = [];
  const inlineFragmentPaths: string[] = [];
  const fieldArguments: Record<string, Record<string, DesignerArgumentState>> = {};

  const walkSelectionSet = (
    selectionSet: SelectionSetNode | undefined,
    parentSegments: string[],
  ) => {
    if (!selectionSet) return;
    for (const sel of selectionSet.selections) {
      if (sel.kind === Kind.FIELD) {
        const currentSegments = [...parentSegments, sel.name.value];
        const pathKey = joinSelectionPath(currentSegments);
        if (!selectedFieldPaths.includes(pathKey)) {
          selectedFieldPaths.push(pathKey);
        }

        if (sel.arguments && sel.arguments.length > 0) {
          const argMap: Record<string, DesignerArgumentState> = {};
          for (const arg of sel.arguments) {
            if (arg.value.kind === Kind.VARIABLE) {
              argMap[arg.name.value] = {
                value: `$${arg.value.name.value}`,
                isVariable: true,
                variableName: arg.value.name.value,
              };
            } else {
              const nestedValues: Record<string, string> = {};
              if (
                arg.value.kind === Kind.OBJECT ||
                arg.value.kind === Kind.LIST
              ) {
                flattenValueNode(arg.value, [], nestedValues);
              }
              argMap[arg.name.value] = {
                value: valueNodeToInputString(arg.value),
                isVariable: false,
                ...(Object.keys(nestedValues).length > 0 ? { nestedValues } : {}),
              };
            }
          }
          fieldArguments[pathKey] = argMap;
        }

        walkSelectionSet(sel.selectionSet, currentSegments);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        const typeConditionName = sel.typeCondition?.name.value;
        if (typeConditionName) {
          const fragSegment = toInlineFragmentSegment(typeConditionName);
          const fragPathSegments = [...parentSegments, fragSegment];
          const fragKey = joinSelectionPath(fragPathSegments);
          if (!inlineFragmentPaths.includes(fragKey)) {
            inlineFragmentPaths.push(fragKey);
          }
          walkSelectionSet(sel.selectionSet, fragPathSegments);
        } else {
          walkSelectionSet(sel.selectionSet, parentSegments);
        }
      }
    }
  };

  walkSelectionSet(activeOp.selectionSet, []);

  return {
    valid: true,
    operationType,
    operationName,
    allOperations,
    selectedFieldPaths,
    inlineFragmentPaths,
    fieldArguments,
    operationVariables,
  };
}

function valueNodeToInputString(node: ValueNode): string {
  if (node.kind === Kind.STRING) {
    return node.value;
  }
  return print(node);
}

function flattenValueNode(
  node: ValueNode,
  prefixSegments: Array<string | number>,
  out: Record<string, string>,
): void {
  if (node.kind === Kind.OBJECT) {
    for (const f of node.fields) {
      flattenValueNode(f.value, [...prefixSegments, f.name.value], out);
    }
    return;
  }
  if (node.kind === Kind.LIST) {
    node.values.forEach((item, idx) => {
      flattenValueNode(item, [...prefixSegments, idx], out);
    });
    return;
  }
  if (prefixSegments.length > 0) {
    out[prefixSegments.join('.')] = valueNodeToInputString(node);
  }
}

function inputStringToValueNode(
  rawValue: string,
  namedType: string,
  namedTypeKind?: string,
  isList?: boolean,
): ValueNode {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('$') && /^[$][a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return {
      kind: Kind.VARIABLE,
      name: { kind: Kind.NAME, value: trimmed.slice(1) },
    };
  }

  if (isList || namedTypeKind === 'INPUT_OBJECT') {
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return parseValue(trimmed);
      } catch {
        // fall through
      }
    }
    if (isList && trimmed.includes(',')) {
      const parts = trimmed
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
      return {
        kind: Kind.LIST,
        values: parts.map(p =>
          inputStringToValueNode(p, namedType, namedTypeKind, false),
        ),
      };
    }
    if (isList && namedTypeKind === 'ENUM') {
      const cleanEnum = trimmed.replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '').trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanEnum)) {
        return {
          kind: Kind.LIST,
          values: [{ kind: Kind.ENUM, value: cleanEnum }],
        };
      }
    }
  }

  if (namedTypeKind === 'ENUM') {
    const cleanEnum = trimmed.replace(/^["']|["']$/g, '');
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleanEnum)) {
      return {
        kind: Kind.ENUM,
        value: cleanEnum,
      };
    }
  }

  if (namedType === 'Int') {
    if (/^-?\d+$/.test(trimmed)) {
      return { kind: Kind.INT, value: trimmed };
    }
  }

  if (namedType === 'Float') {
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { kind: Kind.FLOAT, value: trimmed };
    }
  }

  if (namedType === 'Boolean') {
    if (trimmed === 'true' || trimmed === 'false') {
      return { kind: Kind.BOOLEAN, value: trimmed === 'true' };
    }
  }

  return {
    kind: Kind.STRING,
    value: rawValue,
  };
}

function getDefaultScalarChildName(
  metadata: NormalizedGraphQLSchemaMetadata | undefined,
  objectOrInterfaceTypeName: string | undefined,
): string {
  if (!metadata || !objectOrInterfaceTypeName) return 'id';
  const typeMeta = metadata.types[objectOrInterfaceTypeName];
  if (!typeMeta) return 'id';

  if (typeMeta.kind === 'UNION') {
    return '__typename';
  }

  const fields = typeMeta.fields ?? [];
  const preferredNames = ['id', 'sku', 'name', 'title', 'code', 'status'];
  for (const pref of preferredNames) {
    const match = fields.find(f => f.name === pref && f.isLeaf && !f.isDeprecated);
    if (match) return match.name;
  }

  const firstScalar = fields.find(f => f.isLeaf && !f.isDeprecated) ?? fields.find(f => f.isLeaf);
  if (firstScalar) return firstScalar.name;

  return '__typename';
}

function resolveFieldReturnTypeName(
  metadata: NormalizedGraphQLSchemaMetadata | undefined,
  operationType: GraphQLOperationType,
  pathSegments: string[],
): { namedType?: string; isComposite: boolean } {
  if (!metadata) return { isComposite: false };
  const rootTypeName =
    operationType === 'mutation'
      ? metadata.mutationTypeName
      : operationType === 'subscription'
        ? metadata.subscriptionTypeName
        : metadata.queryTypeName;

  if (!rootTypeName) return { isComposite: false };
  let currentTypeName: string | undefined = rootTypeName;

  for (const segment of pathSegments) {
    if (!currentTypeName) return { isComposite: false };
    if (isInlineFragmentSegment(segment)) {
      currentTypeName = extractInlineFragmentTypeName(segment);
      continue;
    }
    const currentType: NormalizedGraphQLSchemaMetadata['types'][string] | undefined =
      metadata.types[currentTypeName];
    if (!currentType || !currentType.fields) return { isComposite: false };
    const field: (typeof currentType.fields)[number] | undefined = currentType.fields.find(
      f => f.name === segment,
    );
    if (!field) return { isComposite: false };
    currentTypeName = field.namedType;
  }

  if (!currentTypeName) return { isComposite: false };
  const finalType = metadata.types[currentTypeName];
  if (!finalType) return { namedType: currentTypeName, isComposite: false };

  const isComposite =
    finalType.kind === 'OBJECT' ||
    finalType.kind === 'INTERFACE' ||
    finalType.kind === 'UNION';

  return { namedType: currentTypeName, isComposite };
}

function parseOrInitDocument(
  queryText: string,
  operationType: GraphQLOperationType,
  operationName?: string,
): { doc: DocumentNode; activeOpIndex: number } {
  const trimmed = queryText.trim();
  if (trimmed) {
    try {
      const parsed = parse(trimmed);
      const opIdx = parsed.definitions.findIndex(
        d =>
          d.kind === Kind.OPERATION_DEFINITION &&
          (!operationName || d.name?.value === operationName),
      );
      if (opIdx !== -1) {
        return { doc: parsed, activeOpIndex: opIdx };
      }
      const firstOpIdx = parsed.definitions.findIndex(
        d => d.kind === Kind.OPERATION_DEFINITION,
      );
      if (firstOpIdx !== -1) {
        return { doc: parsed, activeOpIndex: firstOpIdx };
      }
    } catch {
      // Fall back to fresh operation when editor has unparseable text and user clicks designer
    }
  }

  const defaultName =
    operationName ||
    (operationType === 'mutation'
      ? 'NewMutation'
      : operationType === 'subscription'
        ? 'NewSubscription'
        : 'NewQuery');

  const initialOp: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation: toOperationTypeNode(operationType),
    name: { kind: Kind.NAME, value: defaultName },
    variableDefinitions: [],
    directives: [],
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: [],
    },
  };

  return {
    doc: {
      kind: Kind.DOCUMENT,
      definitions: [initialOp],
    },
    activeOpIndex: 0,
  };
}

function ensurePathSelectedInSet(
  selections: readonly SelectionNode[],
  remainingSegments: string[],
  fullPathSegments: string[],
  metadata: NormalizedGraphQLSchemaMetadata | undefined,
  operationType: GraphQLOperationType,
): SelectionNode[] {
  if (remainingSegments.length === 0) {
    return [...selections];
  }

  const [head, ...tail] = remainingSegments;

  if (isInlineFragmentSegment(head)) {
    const typeName = extractInlineFragmentTypeName(head);
    const existingIdx = selections.findIndex(
      s =>
        s.kind === Kind.INLINE_FRAGMENT && s.typeCondition?.name.value === typeName,
    );

    const nextSelections = [...selections];
    if (existingIdx !== -1) {
      const existingFrag = nextSelections[existingIdx] as InlineFragmentNode;
      const updatedChildren = ensurePathSelectedInSet(
        existingFrag.selectionSet.selections,
        tail,
        fullPathSegments,
        metadata,
        operationType,
      );
      nextSelections[existingIdx] = {
        ...existingFrag,
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: updatedChildren,
        },
      };
      return nextSelections;
    }

    const childSelections =
      tail.length > 0
        ? ensurePathSelectedInSet([], tail, fullPathSegments, metadata, operationType)
        : [
            {
              kind: Kind.FIELD,
              name: {
                kind: Kind.NAME,
                value: getDefaultScalarChildName(metadata, typeName),
              },
            } satisfies FieldNode,
          ];

    const newFrag: InlineFragmentNode = {
      kind: Kind.INLINE_FRAGMENT,
      typeCondition: {
        kind: Kind.NAMED_TYPE,
        name: { kind: Kind.NAME, value: typeName },
      },
      directives: [],
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: childSelections,
      },
    };
    nextSelections.push(newFrag);
    return nextSelections;
  }

  const existingFieldIdx = selections.findIndex(
    s => s.kind === Kind.FIELD && s.name.value === head,
  );

  const nextSelections = [...selections];

  if (existingFieldIdx !== -1) {
    const existingField = nextSelections[existingFieldIdx] as FieldNode;
    if (tail.length === 0) {
      // Field already exists; if it's a composite type with no selections yet, ensure a default scalar child
      const resolved = resolveFieldReturnTypeName(
        metadata,
        operationType,
        fullPathSegments,
      );
      if (
        resolved.isComposite &&
        (!existingField.selectionSet ||
          existingField.selectionSet.selections.length === 0)
      ) {
        const defaultChild = getDefaultScalarChildName(metadata, resolved.namedType);
        nextSelections[existingFieldIdx] = {
          ...existingField,
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: defaultChild },
              },
            ],
          },
        };
      }
      return nextSelections;
    }

    const updatedSubSelections = ensurePathSelectedInSet(
      existingField.selectionSet?.selections ?? [],
      tail,
      fullPathSegments,
      metadata,
      operationType,
    );
    nextSelections[existingFieldIdx] = {
      ...existingField,
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: updatedSubSelections,
      },
    };
    return nextSelections;
  }

  // Creating a new FieldNode for `head`
  if (tail.length > 0) {
    const childSelections = ensurePathSelectedInSet(
      [],
      tail,
      fullPathSegments,
      metadata,
      operationType,
    );
    const newField: FieldNode = {
      kind: Kind.FIELD,
      name: { kind: Kind.NAME, value: head },
      arguments: [],
      directives: [],
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: childSelections,
      },
    };
    nextSelections.push(newField);
    return nextSelections;
  }

  // `head` is the target leaf or composite node
  const resolved = resolveFieldReturnTypeName(
    metadata,
    operationType,
    fullPathSegments,
  );
  let autoSelectionSet: SelectionSetNode | undefined;
  if (resolved.isComposite) {
    const defaultChild = getDefaultScalarChildName(metadata, resolved.namedType);
    autoSelectionSet = {
      kind: Kind.SELECTION_SET,
      selections: [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: defaultChild },
        },
      ],
    };
  }

  const newField: FieldNode = {
    kind: Kind.FIELD,
    name: { kind: Kind.NAME, value: head },
    arguments: [],
    directives: [],
    selectionSet: autoSelectionSet,
  };
  nextSelections.push(newField);
  return nextSelections;
}

function removePathFromSet(
  selections: readonly SelectionNode[],
  remainingSegments: string[],
): SelectionNode[] {
  if (remainingSegments.length === 0) return [...selections];
  const [head, ...tail] = remainingSegments;

  const result: SelectionNode[] = [];
  for (const sel of selections) {
    if (isInlineFragmentSegment(head)) {
      const targetType = extractInlineFragmentTypeName(head);
      if (
        sel.kind === Kind.INLINE_FRAGMENT &&
        sel.typeCondition?.name.value === targetType
      ) {
        if (tail.length === 0) {
          // Remove entire inline fragment
          continue;
        }
        const remainingChildren = removePathFromSet(
          sel.selectionSet.selections,
          tail,
        );
        if (remainingChildren.length === 0) {
          continue;
        }
        result.push({
          ...sel,
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: remainingChildren,
          },
        });
        continue;
      }
      result.push(sel);
      continue;
    }

    if (sel.kind === Kind.FIELD && sel.name.value === head) {
      if (tail.length === 0) {
        // Uncheck this field completely
        continue;
      }
      const remainingChildren = removePathFromSet(
        sel.selectionSet?.selections ?? [],
        tail,
      );
      if (remainingChildren.length === 0) {
        // Prune empty ancestor field when its last child was unchecked
        continue;
      }
      result.push({
        ...sel,
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: remainingChildren,
        },
      });
      continue;
    }

    result.push(sel);
  }

  return result;
}

/**
 * Checks or unchecks a field path in the GraphQL operation AST (`Designer -> Monaco`).
 * Automatically selects a primary scalar field (`id`, `sku`, `name`, or first scalar)
 * when checking an Object/Interface field with no children, and prunes empty ancestor
 * selection sets when unchecking.
 */
export function toggleFieldSelection(options: {
  queryText: string;
  fieldPath: string[];
  checked: boolean;
  metadata?: NormalizedGraphQLSchemaMetadata;
  operationType?: GraphQLOperationType;
  operationName?: string;
}): string {
  const {
    queryText,
    fieldPath,
    checked,
    metadata,
    operationType = 'query',
    operationName,
  } = options;

  if (fieldPath.length === 0) return queryText;

  const { doc, activeOpIndex } = parseOrInitDocument(
    queryText,
    operationType,
    operationName,
  );
  const activeOp = doc.definitions[activeOpIndex] as OperationDefinitionNode;
  const targetOpType = options.operationType
    ? toOperationTypeNode(options.operationType)
    : activeOp.operation;
  const effectiveOpType = fromOperationTypeNode(targetOpType);

  const updatedSelections = checked
    ? ensurePathSelectedInSet(
        activeOp.selectionSet.selections,
        fieldPath,
        fieldPath,
        metadata,
        effectiveOpType,
      )
    : removePathFromSet(activeOp.selectionSet.selections, fieldPath);

  if (updatedSelections.length === 0) {
    return '';
  }

  const updatedOp: OperationDefinitionNode = {
    ...activeOp,
    operation: targetOpType,
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: updatedSelections,
    },
  };

  const nextDefs: DefinitionNode[] = doc.definitions.map((d, idx) =>
    idx === activeOpIndex ? updatedOp : d,
  );

  return printDocumentPreservingLeadingComments(
    { ...doc, definitions: nextDefs },
    queryText,
  );
}

/**
 * Toggles a `... on ConcreteType` inline fragment under a Union or Interface field path.
 */
export function toggleInlineFragment(options: {
  queryText: string;
  parentFieldPath: string[];
  typeName: string;
  checked: boolean;
  metadata?: NormalizedGraphQLSchemaMetadata;
  operationType?: GraphQLOperationType;
  operationName?: string;
}): string {
  const fragmentPath = [
    ...options.parentFieldPath,
    toInlineFragmentSegment(options.typeName),
  ];
  return toggleFieldSelection({
    queryText: options.queryText,
    fieldPath: fragmentPath,
    checked: options.checked,
    metadata: options.metadata,
    operationType: options.operationType,
    operationName: options.operationName,
  });
}

function updateArgumentOnPathInSet(
  selections: readonly SelectionNode[],
  remainingSegments: string[],
  updater: (existingArgs: readonly ArgumentNode[]) => ArgumentNode[],
): SelectionNode[] {
  if (remainingSegments.length === 0) return [...selections];
  const [head, ...tail] = remainingSegments;

  return selections.map(sel => {
    if (isInlineFragmentSegment(head)) {
      const targetType = extractInlineFragmentTypeName(head);
      if (
        sel.kind === Kind.INLINE_FRAGMENT &&
        sel.typeCondition?.name.value === targetType
      ) {
        return {
          ...sel,
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: updateArgumentOnPathInSet(
              sel.selectionSet.selections,
              tail,
              updater,
            ),
          },
        };
      }
      return sel;
    }

    if (sel.kind === Kind.FIELD && sel.name.value === head) {
      if (tail.length === 0) {
        return {
          ...sel,
          arguments: updater(sel.arguments ?? []),
        };
      }
      if (!sel.selectionSet) return sel;
      return {
        ...sel,
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: updateArgumentOnPathInSet(
            sel.selectionSet.selections,
            tail,
            updater,
          ),
        },
      };
    }

    return sel;
  });
}

function lookupFieldArgumentMetadata(
  metadata: NormalizedGraphQLSchemaMetadata | undefined,
  operationType: GraphQLOperationType,
  fieldPath: string[],
  argName: string,
) {
  if (!metadata || fieldPath.length === 0) return undefined;
  const parentPath = fieldPath.slice(0, -1);
  const targetFieldName = fieldPath[fieldPath.length - 1];

  let containerTypeName: string | undefined;
  if (parentPath.length === 0) {
    containerTypeName =
      operationType === 'mutation'
        ? (metadata.mutationTypeName ?? undefined)
        : operationType === 'subscription'
          ? (metadata.subscriptionTypeName ?? undefined)
          : (metadata.queryTypeName ?? undefined);
  } else {
    containerTypeName = resolveFieldReturnTypeName(
      metadata,
      operationType,
      parentPath,
    ).namedType;
  }

  if (!containerTypeName) return undefined;
  const containerType = metadata.types[containerTypeName];
  const fieldMeta = containerType?.fields?.find(f => f.name === targetFieldName);
  return fieldMeta?.args.find(a => a.name === argName);
}

/**
 * Sets or clears a literal argument value on a field in the GraphQL AST.
 * If the field is not yet selected in the query, it is automatically added first.
 */
export function setFieldArgument(options: {
  queryText: string;
  fieldPath: string[];
  argName: string;
  value: string;
  metadata?: NormalizedGraphQLSchemaMetadata;
  operationType?: GraphQLOperationType;
  operationName?: string;
}): string {
  const {
    fieldPath,
    argName,
    value,
    metadata,
    operationType = 'query',
    operationName,
  } = options;

  // Ensure the field is selected first
  const ensuredQuery = toggleFieldSelection({
    queryText: options.queryText,
    fieldPath,
    checked: true,
    metadata,
    operationType,
    operationName,
  });

  const { doc, activeOpIndex } = parseOrInitDocument(
    ensuredQuery,
    operationType,
    operationName,
  );
  const activeOp = doc.definitions[activeOpIndex] as OperationDefinitionNode;
  const effectiveOpType = fromOperationTypeNode(activeOp.operation);
  const argMeta = lookupFieldArgumentMetadata(
    metadata,
    effectiveOpType,
    fieldPath,
    argName,
  );

  const updatedSelections = updateArgumentOnPathInSet(
    activeOp.selectionSet.selections,
    fieldPath,
    existingArgs => {
      const filtered = existingArgs.filter(a => a.name.value !== argName);
      if (value === '') {
        return filtered;
      }
      const valueNode = inputStringToValueNode(
        value,
        argMeta?.namedType ?? 'String',
        argMeta?.namedTypeKind,
        argMeta?.isList,
      );
      const nextArg: ArgumentNode = {
        kind: Kind.ARGUMENT,
        name: { kind: Kind.NAME, value: argName },
        value: valueNode,
      };
      return [...filtered, nextArg];
    },
  );

  const updatedOp: OperationDefinitionNode = {
    ...activeOp,
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: updatedSelections,
    },
  };

  const nextDefs: DefinitionNode[] = doc.definitions.map((d, idx) =>
    idx === activeOpIndex ? updatedOp : d,
  );

  return printDocumentPreservingLeadingComments(
    { ...doc, definitions: nextDefs },
    options.queryText,
  );
}

/**
 * Promotes or demotes a field argument to/from a GraphQL operation `$variable`:
 * - When `enabled: true`:
 *   1. Ensures the field is selected in the operation.
 *   2. Adds `$variableName: ArgType` to `OperationDefinitionNode.variableDefinitions`.
 *   3. Sets `argName: $variableName` on the field's `ArgumentNode`.
 *   4. Populates `"variableName": <defaultValue>` in the GraphQL Variables JSON string.
 * - When `enabled: false`:
 *   1. Replaces `$variableName` on the field argument with a literal value (from Variables JSON or default).
 *   2. Removes `$variableName` from `OperationDefinitionNode.variableDefinitions` if no longer referenced.
 */
export function toggleVariableBinding(options: {
  queryText: string;
  variablesJson?: string;
  fieldPath: string[];
  argName: string;
  variableName?: string;
  enabled: boolean;
  metadata?: NormalizedGraphQLSchemaMetadata;
  operationType?: GraphQLOperationType;
  operationName?: string;
}): {
  queryText: string;
  variablesJson: string;
} {
  const {
    fieldPath,
    argName,
    enabled,
    metadata,
    operationType = 'query',
    operationName,
  } = options;
  const varName = (options.variableName || argName).replace(/^\$/, '');

  const ensuredQuery = toggleFieldSelection({
    queryText: options.queryText,
    fieldPath,
    checked: true,
    metadata,
    operationType,
    operationName,
  });

  const { doc, activeOpIndex } = parseOrInitDocument(
    ensuredQuery,
    operationType,
    operationName,
  );
  const activeOp = doc.definitions[activeOpIndex] as OperationDefinitionNode;
  const effectiveOpType = fromOperationTypeNode(activeOp.operation);
  const argMeta = lookupFieldArgumentMetadata(
    metadata,
    effectiveOpType,
    fieldPath,
    argName,
  );
  const typeSignature = argMeta?.typeSignature ?? 'String';

  let varsObject: Record<string, unknown> = {};
  if (options.variablesJson && options.variablesJson.trim()) {
    try {
      const parsedVars = JSON.parse(options.variablesJson);
      if (parsedVars && typeof parsedVars === 'object' && !Array.isArray(parsedVars)) {
        varsObject = { ...(parsedVars as Record<string, unknown>) };
      }
    } catch {
      // keep empty object if invalid JSON
    }
  }

  let currentLiteralValue: string | undefined;

  const updatedSelections = updateArgumentOnPathInSet(
    activeOp.selectionSet.selections,
    fieldPath,
    existingArgs => {
      const existingArg = existingArgs.find(a => a.name.value === argName);
      if (existingArg && existingArg.value.kind !== Kind.VARIABLE) {
        currentLiteralValue = valueNodeToInputString(existingArg.value);
      }

      const otherArgs = existingArgs.filter(a => a.name.value !== argName);

      if (enabled) {
        const varArg: ArgumentNode = {
          kind: Kind.ARGUMENT,
          name: { kind: Kind.NAME, value: argName },
          value: {
            kind: Kind.VARIABLE,
            name: { kind: Kind.NAME, value: varName },
          },
        };
        return [...otherArgs, varArg];
      } else {
        const fallbackRaw =
          varsObject[varName] !== undefined
            ? typeof varsObject[varName] === 'string'
              ? (varsObject[varName] as string)
              : JSON.stringify(varsObject[varName])
            : '';

        if (!fallbackRaw) {
          return otherArgs;
        }
        const literalNode = inputStringToValueNode(
          fallbackRaw,
          argMeta?.namedType ?? 'String',
          argMeta?.namedTypeKind,
          argMeta?.isList,
        );
        return [
          ...otherArgs,
          {
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: argName },
            value: literalNode,
          },
        ];
      }
    },
  );

  const existingVarDefs = [...(activeOp.variableDefinitions ?? [])];
  let nextVarDefs: VariableDefinitionNode[] = existingVarDefs;

  if (enabled) {
    const alreadyDefined = existingVarDefs.some(
      v => v.variable.name.value === varName,
    );
    if (!alreadyDefined) {
      nextVarDefs = [
        ...existingVarDefs,
        {
          kind: Kind.VARIABLE_DEFINITION,
          variable: {
            kind: Kind.VARIABLE,
            name: { kind: Kind.NAME, value: varName },
          },
          type: parseType(typeSignature),
          directives: [],
        },
      ];
    }

    if (!(varName in varsObject)) {
      if (currentLiteralValue !== undefined && currentLiteralValue !== '') {
        varsObject[varName] = coerceLiteralForVariablesJson(
          currentLiteralValue,
          argMeta?.namedType,
        );
      } else if (metadata && argMeta) {
        varsObject[varName] = createSampleValueForType(
          metadata,
          argMeta.namedType,
          argMeta.isList,
          argMeta.defaultValue,
        );
      } else {
        varsObject[varName] = '';
      }
    }
  } else {
    nextVarDefs = existingVarDefs.filter(v => v.variable.name.value !== varName);
  }

  const opNameNode =
    activeOp.name ??
    ({
      kind: Kind.NAME,
      value:
        effectiveOpType === 'mutation'
          ? 'NewMutation'
          : effectiveOpType === 'subscription'
            ? 'NewSubscription'
            : 'NewQuery',
    } as const);

  const updatedOp: OperationDefinitionNode = {
    ...activeOp,
    name: opNameNode,
    variableDefinitions: nextVarDefs,
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: updatedSelections,
    },
  };

  const nextDefs: DefinitionNode[] = doc.definitions.map((d, idx) =>
    idx === activeOpIndex ? updatedOp : d,
  );

  const nextQueryText = printDocumentPreservingLeadingComments(
    { ...doc, definitions: nextDefs },
    options.queryText,
  );

  return {
    queryText: nextQueryText,
    variablesJson: JSON.stringify(varsObject, null, 2),
  };
}

function coerceLiteralForVariablesJson(
  raw: string,
  namedType?: string,
): unknown {
  if (namedType === 'Int') {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) return n;
  }
  if (namedType === 'Float') {
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) return n;
  }
  if (namedType === 'Boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return raw;
}

function resolveNestedInputTypeMeta(
  metadata: NormalizedGraphQLSchemaMetadata | undefined,
  rootArgNamedType: string | undefined,
  rootArgKind: NormalizedGraphQLTypeKind | undefined,
  rootArgIsList: boolean | undefined,
  nestedPath: Array<string | number>,
): {
  namedType: string;
  namedTypeKind?: NormalizedGraphQLTypeKind;
  isList?: boolean;
} {
  let currentNamed = rootArgNamedType ?? 'String';
  let currentKind = rootArgKind;
  let currentIsList = Boolean(rootArgIsList);

  for (const segment of nestedPath) {
    if (typeof segment === 'number') {
      currentIsList = false;
      continue;
    }
    if (!metadata) break;
    const typeObj = metadata.types[currentNamed];
    const inputField: NormalizedGraphQLInputField | undefined =
      typeObj?.inputFields?.find(f => f.name === segment);
    if (!inputField) {
      break;
    }
    currentNamed = inputField.namedType;
    currentKind = inputField.namedTypeKind;
    currentIsList = inputField.isList;
  }

  return {
    namedType: currentNamed,
    namedTypeKind: currentKind,
    isList: currentIsList,
  };
}

function updateNestedValueNode(
  currentNode: ValueNode | undefined,
  remainingPath: Array<string | number>,
  leafValueNode: ValueNode | null,
): ValueNode | null {
  if (remainingPath.length === 0) {
    return leafValueNode;
  }

  const [head, ...tail] = remainingPath;

  if (typeof head === 'number') {
    const existingItems: ValueNode[] =
      currentNode && currentNode.kind === Kind.LIST
        ? [...currentNode.values]
        : [];

    if (tail.length === 0 && leafValueNode === null) {
      // Remove list element at index `head`
      existingItems.splice(head, 1);
      return existingItems.length > 0
        ? ({ kind: Kind.LIST, values: existingItems } satisfies ListValueNode)
        : null;
    }

    while (existingItems.length <= head) {
      existingItems.push({ kind: Kind.OBJECT, fields: [] });
    }

    const updatedElement = updateNestedValueNode(
      existingItems[head],
      tail,
      leafValueNode,
    );

    if (updatedElement === null) {
      existingItems.splice(head, 1);
    } else {
      existingItems[head] = updatedElement;
    }

    return existingItems.length > 0
      ? ({ kind: Kind.LIST, values: existingItems } satisfies ListValueNode)
      : null;
  }

  // `head` is an ObjectField key (string)
  const existingFields: ObjectFieldNode[] =
    currentNode && currentNode.kind === Kind.OBJECT
      ? [...currentNode.fields]
      : [];

  const fieldIdx = existingFields.findIndex(f => f.name.value === head);
  const currentChild =
    fieldIdx !== -1 ? existingFields[fieldIdx].value : undefined;
  const updatedChild = updateNestedValueNode(currentChild, tail, leafValueNode);

  if (updatedChild === null) {
    if (fieldIdx !== -1) {
      existingFields.splice(fieldIdx, 1);
    }
  } else {
    const nextFieldNode: ObjectFieldNode = {
      kind: Kind.OBJECT_FIELD,
      name: { kind: Kind.NAME, value: head },
      value: updatedChild,
    };
    if (fieldIdx !== -1) {
      existingFields[fieldIdx] = nextFieldNode;
    } else {
      existingFields.push(nextFieldNode);
    }
  }

  return existingFields.length > 0
    ? ({ kind: Kind.OBJECT, fields: existingFields } satisfies ObjectValueNode)
    : null;
}

/**
 * Sets or clears a deeply nested field inside an `INPUT_OBJECT` or list argument
 * (such as `where: { availableQuantity: { gte: 10 }, category: { eq: ELECTRONICS } }`
 * or `orderBy: [{ field: UNIT_PRICE, direction: DESC }]`).
 * Automatically prunes empty parent input objects/lists when the last leaf is cleared.
 */
export function setNestedArgumentValue(options: {
  queryText: string;
  fieldPath: string[];
  argName: string;
  nestedPath: Array<string | number>;
  value: string;
  metadata?: NormalizedGraphQLSchemaMetadata;
  operationType?: GraphQLOperationType;
  operationName?: string;
}): string {
  const {
    fieldPath,
    argName,
    nestedPath,
    value,
    metadata,
    operationType = 'query',
    operationName,
  } = options;

  if (nestedPath.length === 0) {
    return setFieldArgument({
      queryText: options.queryText,
      fieldPath,
      argName,
      value,
      metadata,
      operationType,
      operationName,
    });
  }

  const ensuredQuery = toggleFieldSelection({
    queryText: options.queryText,
    fieldPath,
    checked: true,
    metadata,
    operationType,
    operationName,
  });

  const { doc, activeOpIndex } = parseOrInitDocument(
    ensuredQuery,
    operationType,
    operationName,
  );
  const activeOp = doc.definitions[activeOpIndex] as OperationDefinitionNode;
  const effectiveOpType = fromOperationTypeNode(activeOp.operation);
  const rootArgMeta = lookupFieldArgumentMetadata(
    metadata,
    effectiveOpType,
    fieldPath,
    argName,
  );

  const leafTypeMeta = resolveNestedInputTypeMeta(
    metadata,
    rootArgMeta?.namedType,
    rootArgMeta?.namedTypeKind,
    rootArgMeta?.isList,
    nestedPath,
  );

  const leafValueNode: ValueNode | null =
    value === ''
      ? null
      : inputStringToValueNode(
          value,
          leafTypeMeta.namedType,
          leafTypeMeta.namedTypeKind,
          leafTypeMeta.isList,
        );

  const updatedSelections = updateArgumentOnPathInSet(
    activeOp.selectionSet.selections,
    fieldPath,
    existingArgs => {
      const existingArg = existingArgs.find(a => a.name.value === argName);
      const otherArgs = existingArgs.filter(a => a.name.value !== argName);

      const updatedRootVal = updateNestedValueNode(
        existingArg?.value,
        nestedPath,
        leafValueNode,
      );

      if (!updatedRootVal) {
        return otherArgs;
      }

      return [
        ...otherArgs,
        {
          kind: Kind.ARGUMENT,
          name: { kind: Kind.NAME, value: argName },
          value: updatedRootVal,
        },
      ];
    },
  );

  const updatedOp: OperationDefinitionNode = {
    ...activeOp,
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: updatedSelections,
    },
  };

  const nextDefs: DefinitionNode[] = doc.definitions.map((d, idx) =>
    idx === activeOpIndex ? updatedOp : d,
  );

  return printDocumentPreservingLeadingComments(
    { ...doc, definitions: nextDefs },
    options.queryText,
  );
}

