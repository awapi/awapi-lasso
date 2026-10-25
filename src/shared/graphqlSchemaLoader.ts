import {
  buildClientSchema,
  buildSchema,
  getNamedType,
  introspectionFromSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  printType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  type IntrospectionQuery,
} from 'graphql';

export type NormalizedGraphQLTypeKind =
  | 'SCALAR'
  | 'OBJECT'
  | 'INTERFACE'
  | 'UNION'
  | 'ENUM'
  | 'INPUT_OBJECT';

export interface NormalizedGraphQLArgument {
  name: string;
  description?: string;
  /** Full GraphQL type signature, e.g. `ID!`, `[String!]`, `Int` */
  typeSignature: string;
  /** Base named type without list/non-null wrappers, e.g. `ID`, `String`, `ProductCategory` */
  namedType: string;
  namedTypeKind: NormalizedGraphQLTypeKind;
  isNonNull: boolean;
  isList: boolean;
  defaultValue?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface NormalizedGraphQLField {
  name: string;
  description?: string;
  /** Full GraphQL return type signature, e.g. `[InventoryItem!]!` */
  typeSignature: string;
  /** Base named return type, e.g. `InventoryItem` */
  namedType: string;
  namedTypeKind: NormalizedGraphQLTypeKind;
  isNonNull: boolean;
  isList: boolean;
  isLeaf: boolean;
  args: NormalizedGraphQLArgument[];
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface NormalizedGraphQLInputField {
  name: string;
  description?: string;
  typeSignature: string;
  namedType: string;
  namedTypeKind: NormalizedGraphQLTypeKind;
  isNonNull: boolean;
  isList: boolean;
  defaultValue?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface NormalizedGraphQLEnumValue {
  name: string;
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface NormalizedGraphQLType {
  name: string;
  kind: NormalizedGraphQLTypeKind;
  description?: string;
  fields?: NormalizedGraphQLField[];
  inputFields?: NormalizedGraphQLInputField[];
  enumValues?: NormalizedGraphQLEnumValue[];
  /** Interfaces implemented by an OBJECT or INTERFACE type */
  interfaces?: string[];
  /** Concrete OBJECT types implementing an INTERFACE or belonging to a UNION */
  possibleTypes?: string[];
  /** Printed SDL representation of this type */
  sdl?: string;
}

export interface NormalizedGraphQLSchemaMetadata {
  queryTypeName: string | null;
  mutationTypeName: string | null;
  subscriptionTypeName: string | null;
  types: Record<string, NormalizedGraphQLType>;
  typeNames: string[];
  typeCount: number;
}

export interface GraphQLSchemaDiffSummary {
  hasChanges: boolean;
  addedTypes: string[];
  removedTypes: string[];
  modifiedTypes: string[];
  addedFields: Array<{ typeName: string; fieldName: string }>;
  removedFields: Array<{ typeName: string; fieldName: string }>;
  summaryText: string;
}

export interface LoadedGraphQLSchemaBundle {
  schema: GraphQLSchema;
  introspection: IntrospectionQuery;
  metadata: NormalizedGraphQLSchemaMetadata;
  sourceFormat: 'introspection_json' | 'sdl';
}

const BUILTIN_SCALAR_NAMES = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

export function isIntrospectionTypeName(name: string): boolean {
  return name.startsWith('__');
}

export function isBuiltInScalarName(name: string): boolean {
  return BUILTIN_SCALAR_NAMES.has(name);
}

export function getNormalizedKindForNamedType(
  namedType: GraphQLNamedType,
): NormalizedGraphQLTypeKind {
  if (isScalarType(namedType)) return 'SCALAR';
  if (isEnumType(namedType)) return 'ENUM';
  if (isObjectType(namedType)) return 'OBJECT';
  if (isInterfaceType(namedType)) return 'INTERFACE';
  if (isUnionType(namedType)) return 'UNION';
  if (isInputObjectType(namedType)) return 'INPUT_OBJECT';
  return 'SCALAR';
}

export function inspectGraphQLTypeWrappers(type: GraphQLType): {
  typeSignature: string;
  namedType: string;
  namedTypeKind: NormalizedGraphQLTypeKind;
  isNonNull: boolean;
  isList: boolean;
  isLeaf: boolean;
} {
  const typeSignature = type.toString();
  const named = getNamedType(type);
  const namedTypeKind = getNormalizedKindForNamedType(named);
  const isNonNull = isNonNullType(type);

  let current: GraphQLType = type;
  let isList = false;
  while (isNonNullType(current) || isListType(current)) {
    if (isListType(current)) {
      isList = true;
    }
    current = current.ofType;
  }

  const isLeaf = namedTypeKind === 'SCALAR' || namedTypeKind === 'ENUM';
  return {
    typeSignature,
    namedType: named.name,
    namedTypeKind,
    isNonNull,
    isList,
    isLeaf,
  };
}

function serializeDefaultValue(defaultValue: unknown): string | undefined {
  if (defaultValue === undefined) return undefined;
  if (typeof defaultValue === 'string') return JSON.stringify(defaultValue);
  try {
    return JSON.stringify(defaultValue);
  } catch {
    return String(defaultValue);
  }
}

function normalizeArg(arg: GraphQLArgument): NormalizedGraphQLArgument {
  const inspected = inspectGraphQLTypeWrappers(arg.type);
  return {
    name: arg.name,
    description: arg.description ?? undefined,
    typeSignature: inspected.typeSignature,
    namedType: inspected.namedType,
    namedTypeKind: inspected.namedTypeKind,
    isNonNull: inspected.isNonNull,
    isList: inspected.isList,
    defaultValue: serializeDefaultValue(arg.defaultValue),
    isDeprecated: Boolean(arg.deprecationReason),
    deprecationReason: arg.deprecationReason ?? undefined,
  };
}

function normalizeField(field: GraphQLField<unknown, unknown>): NormalizedGraphQLField {
  const inspected = inspectGraphQLTypeWrappers(field.type);
  return {
    name: field.name,
    description: field.description ?? undefined,
    typeSignature: inspected.typeSignature,
    namedType: inspected.namedType,
    namedTypeKind: inspected.namedTypeKind,
    isNonNull: inspected.isNonNull,
    isList: inspected.isList,
    isLeaf: inspected.isLeaf,
    args: field.args.map(normalizeArg),
    isDeprecated: Boolean(field.deprecationReason),
    deprecationReason: field.deprecationReason ?? undefined,
  };
}

function normalizeInputField(field: GraphQLInputField): NormalizedGraphQLInputField {
  const inspected = inspectGraphQLTypeWrappers(field.type);
  return {
    name: field.name,
    description: field.description ?? undefined,
    typeSignature: inspected.typeSignature,
    namedType: inspected.namedType,
    namedTypeKind: inspected.namedTypeKind,
    isNonNull: inspected.isNonNull,
    isList: inspected.isList,
    defaultValue: serializeDefaultValue(field.defaultValue),
    isDeprecated: Boolean(field.deprecationReason),
    deprecationReason: field.deprecationReason ?? undefined,
  };
}

/**
 * Extracts normalized UI metadata from a `GraphQLSchema` for the Query Designer,
 * Schema Explorer, and Monaco autocomplete providers.
 */
export function extractSchemaMetadata(
  schema: GraphQLSchema,
): NormalizedGraphQLSchemaMetadata {
  const queryTypeName = schema.getQueryType()?.name ?? null;
  const mutationTypeName = schema.getMutationType()?.name ?? null;
  const subscriptionTypeName = schema.getSubscriptionType()?.name ?? null;

  const typeMap = schema.getTypeMap();
  const types: Record<string, NormalizedGraphQLType> = {};
  const userTypeNames: string[] = [];

  for (const [typeName, namedType] of Object.entries(typeMap)) {
    if (isIntrospectionTypeName(typeName)) continue;

    const kind = getNormalizedKindForNamedType(namedType);
    const normalized: NormalizedGraphQLType = {
      name: typeName,
      kind,
      description: namedType.description ?? undefined,
    };

    if (!isBuiltInScalarName(typeName)) {
      try {
        normalized.sdl = printType(namedType);
      } catch {
        // ignore if printing fails on custom synthetic types
      }
      userTypeNames.push(typeName);
    }

    if (isObjectType(namedType)) {
      const fieldsMap = namedType.getFields();
      normalized.fields = Object.values(fieldsMap).map(normalizeField);
      normalized.interfaces = namedType.getInterfaces().map(i => i.name);
    } else if (isInterfaceType(namedType)) {
      const fieldsMap = namedType.getFields();
      normalized.fields = Object.values(fieldsMap).map(normalizeField);
      normalized.interfaces = namedType.getInterfaces().map(i => i.name);
      normalized.possibleTypes = schema.getPossibleTypes(namedType).map(t => t.name);
    } else if (isUnionType(namedType)) {
      normalized.possibleTypes = schema.getPossibleTypes(namedType).map(t => t.name);
    } else if (isInputObjectType(namedType)) {
      const inputFieldsMap = namedType.getFields();
      normalized.inputFields = Object.values(inputFieldsMap).map(normalizeInputField);
    } else if (isEnumType(namedType)) {
      normalized.enumValues = namedType.getValues().map(v => ({
        name: v.name,
        description: v.description ?? undefined,
        isDeprecated: Boolean(v.deprecationReason),
        deprecationReason: v.deprecationReason ?? undefined,
      }));
    }

    types[typeName] = normalized;
  }

  userTypeNames.sort((a, b) => a.localeCompare(b));

  return {
    queryTypeName,
    mutationTypeName,
    subscriptionTypeName,
    types,
    typeNames: userTypeNames,
    typeCount: userTypeNames.length,
  };
}

/**
 * Unwraps an introspection payload that may be shaped as:
 * - `{ data: { __schema: ... } }` (standard HTTP GraphQL response)
 * - `{ __schema: ... }` (raw IntrospectionQuery)
 */
export function unwrapIntrospectionPayload(raw: unknown): IntrospectionQuery {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid GraphQL introspection JSON: expected an object.');
  }
  const record = raw as Record<string, unknown>;
  if (record.__schema && typeof record.__schema === 'object') {
    return record as unknown as IntrospectionQuery;
  }
  if (record.data && typeof record.data === 'object') {
    const dataObj = record.data as Record<string, unknown>;
    if (dataObj.__schema && typeof dataObj.__schema === 'object') {
      return dataObj as unknown as IntrospectionQuery;
    }
  }
  throw new Error(
    'Invalid GraphQL introspection JSON: missing "__schema" or "data.__schema" property.',
  );
}

/**
 * Builds a `LoadedGraphQLSchemaBundle` from a standard `IntrospectionQuery` object or JSON string.
 */
export function loadSchemaFromIntrospection(
  input: string | IntrospectionQuery | Record<string, unknown>,
): LoadedGraphQLSchemaBundle {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  const introspection = unwrapIntrospectionPayload(parsed);
  const schema = buildClientSchema(introspection);
  const metadata = extractSchemaMetadata(schema);
  return {
    schema,
    introspection,
    metadata,
    sourceFormat: 'introspection_json',
  };
}

/**
 * Builds a `LoadedGraphQLSchemaBundle` from `.graphql` / `.gql` SDL text.
 */
export function loadSchemaFromSdl(sdlText: string): LoadedGraphQLSchemaBundle {
  const trimmed = sdlText.trim();
  if (!trimmed) {
    throw new Error('GraphQL SDL content cannot be empty.');
  }
  const schema = buildSchema(trimmed);
  const introspection = introspectionFromSchema(schema);
  const metadata = extractSchemaMetadata(schema);
  return {
    schema,
    introspection,
    metadata,
    sourceFormat: 'sdl',
  };
}

/**
 * Auto-detects whether `content` is JSON Introspection or GraphQL SDL and builds the schema bundle.
 */
export function loadGraphQLSchemaAuto(
  content: string,
  fileHint?: string,
): LoadedGraphQLSchemaBundle {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Schema content is empty.');
  }
  const lowerHint = (fileHint ?? '').toLowerCase();
  if (lowerHint.endsWith('.json') || trimmed.startsWith('{')) {
    return loadSchemaFromIntrospection(trimmed);
  }
  return loadSchemaFromSdl(trimmed);
}

/**
 * Computes a concise diff between a previously cached schema metadata snapshot and a newly loaded one.
 */
export function diffSchemaMetadata(
  previous: NormalizedGraphQLSchemaMetadata | null | undefined,
  next: NormalizedGraphQLSchemaMetadata,
): GraphQLSchemaDiffSummary {
  if (!previous) {
    return {
      hasChanges: false,
      addedTypes: [],
      removedTypes: [],
      modifiedTypes: [],
      addedFields: [],
      removedFields: [],
      summaryText: 'Initial schema snapshot',
    };
  }

  const prevSet = new Set(previous.typeNames);
  const nextSet = new Set(next.typeNames);

  const addedTypes = next.typeNames.filter(t => !prevSet.has(t));
  const removedTypes = previous.typeNames.filter(t => !nextSet.has(t));
  const modifiedTypes: string[] = [];
  const addedFields: Array<{ typeName: string; fieldName: string }> = [];
  const removedFields: Array<{ typeName: string; fieldName: string }> = [];

  for (const typeName of next.typeNames) {
    if (!prevSet.has(typeName)) continue;
    const prevType = previous.types[typeName];
    const nextType = next.types[typeName];
    if (!prevType || !nextType) continue;

    let typeModified = prevType.kind !== nextType.kind;

    const prevFieldNames = new Map(
      (prevType.fields ?? []).map(f => [f.name, f.typeSignature]),
    );
    const nextFieldNames = new Map(
      (nextType.fields ?? []).map(f => [f.name, f.typeSignature]),
    );

    for (const [fName, fSig] of nextFieldNames.entries()) {
      if (!prevFieldNames.has(fName)) {
        addedFields.push({ typeName, fieldName: fName });
        typeModified = true;
      } else if (prevFieldNames.get(fName) !== fSig) {
        typeModified = true;
      }
    }

    for (const fName of prevFieldNames.keys()) {
      if (!nextFieldNames.has(fName)) {
        removedFields.push({ typeName, fieldName: fName });
        typeModified = true;
      }
    }

    const prevInputNames = new Map(
      (prevType.inputFields ?? []).map(f => [f.name, f.typeSignature]),
    );
    const nextInputNames = new Map(
      (nextType.inputFields ?? []).map(f => [f.name, f.typeSignature]),
    );
    if (prevInputNames.size !== nextInputNames.size) {
      typeModified = true;
    } else {
      for (const [k, v] of nextInputNames.entries()) {
        if (prevInputNames.get(k) !== v) {
          typeModified = true;
        }
      }
    }

    if (typeModified) {
      modifiedTypes.push(typeName);
    }
  }

  const hasChanges =
    addedTypes.length > 0 ||
    removedTypes.length > 0 ||
    modifiedTypes.length > 0 ||
    addedFields.length > 0 ||
    removedFields.length > 0;

  if (!hasChanges) {
    return {
      hasChanges: false,
      addedTypes: [],
      removedTypes: [],
      modifiedTypes: [],
      addedFields: [],
      removedFields: [],
      summaryText: 'No schema changes detected',
    };
  }

  const parts: string[] = [];
  if (addedTypes.length > 0) parts.push(`+${addedTypes.length} type(s)`);
  if (removedTypes.length > 0) parts.push(`-${removedTypes.length} type(s)`);
  if (addedFields.length > 0) parts.push(`+${addedFields.length} field(s)`);
  if (removedFields.length > 0) parts.push(`-${removedFields.length} field(s)`);
  if (parts.length === 0 && modifiedTypes.length > 0) {
    parts.push(`~${modifiedTypes.length} modified type(s)`);
  }

  return {
    hasChanges: true,
    addedTypes,
    removedTypes,
    modifiedTypes,
    addedFields,
    removedFields,
    summaryText: parts.join(', '),
  };
}

/**
 * Generates a starter GraphQL Query, Mutation, or Subscription operation string and
 * sample Variables JSON for a given root field on `Query`, `Mutation`, or `Subscription`.
 */
export function generateStarterOperationForField(
  metadata: NormalizedGraphQLSchemaMetadata,
  operationType: 'query' | 'mutation' | 'subscription',
  fieldName: string,
): {
  operationName: string;
  query: string;
  variablesJson: string;
} {
  const rootTypeName =
    operationType === 'query'
      ? metadata.queryTypeName
      : operationType === 'mutation'
        ? metadata.mutationTypeName
        : metadata.subscriptionTypeName;

  if (!rootTypeName || !metadata.types[rootTypeName]) {
    throw new Error(`Schema does not define a root ${operationType} type.`);
  }

  const rootType = metadata.types[rootTypeName];
  const field = (rootType.fields ?? []).find(f => f.name === fieldName);
  if (!field) {
    throw new Error(`Field "${fieldName}" not found on ${rootTypeName}.`);
  }

  const pascalField = field.name.charAt(0).toUpperCase() + field.name.slice(1);
  const operationName =
    operationType === 'query'
      ? `Get${pascalField}`
      : operationType === 'mutation'
        ? `${pascalField}Mutation`
        : `On${pascalField}`;

  const varDefs: string[] = [];
  const fieldArgCalls: string[] = [];
  const variablesObj: Record<string, unknown> = {};

  for (const arg of field.args) {
    varDefs.push(`$${arg.name}: ${arg.typeSignature}`);
    fieldArgCalls.push(`${arg.name}: $${arg.name}`);
    variablesObj[arg.name] = createSampleValueForType(
      metadata,
      arg.namedType,
      arg.isList,
      arg.defaultValue,
    );
  }

  const varHeader = varDefs.length > 0 ? `(${varDefs.join(', ')})` : '';
  const argHeader = fieldArgCalls.length > 0 ? `(${fieldArgCalls.join(', ')})` : '';

  const subSelectionLines = buildDefaultSelectionLines(
    metadata,
    field.namedType,
    2,
    new Set([field.namedType]),
  );

  const selectionBlock =
    subSelectionLines.length > 0
      ? ` {\n${subSelectionLines.join('\n')}\n  }`
      : '';

  const query = `${operationType} ${operationName}${varHeader} {\n  ${field.name}${argHeader}${selectionBlock}\n}\n`;
  const variablesJson = JSON.stringify(variablesObj, null, 2);

  return {
    operationName,
    query,
    variablesJson,
  };
}

function buildDefaultSelectionLines(
  metadata: NormalizedGraphQLSchemaMetadata,
  typeName: string,
  indentSpaces: number,
  visited: Set<string>,
): string[] {
  const targetType = metadata.types[typeName];
  if (!targetType) return [];
  const pad = ' '.repeat(indentSpaces + 2);

  if (targetType.kind === 'OBJECT' || targetType.kind === 'INTERFACE') {
    const fields = targetType.fields ?? [];
    const leafFields = fields.filter(f => f.isLeaf && !f.isDeprecated);
    const chosenLeaves =
      leafFields.length > 0 ? leafFields.slice(0, 6) : fields.filter(f => f.isLeaf).slice(0, 3);

    const lines = chosenLeaves.map(f => `${pad}${f.name}`);
    if (lines.length > 0) return lines;

    // If an object has no direct scalars, pick the first non-visited object child
    const firstNested = fields.find(f => !f.isLeaf && !visited.has(f.namedType));
    if (firstNested) {
      const nextVisited = new Set(visited);
      nextVisited.add(firstNested.namedType);
      const childLines = buildDefaultSelectionLines(
        metadata,
        firstNested.namedType,
        indentSpaces + 2,
        nextVisited,
      );
      if (childLines.length > 0) {
        return [`${pad}${firstNested.name} {`, ...childLines, `${pad}}`];
      }
    }
    return [`${pad}__typename`];
  }

  if (targetType.kind === 'UNION') {
    const possible = targetType.possibleTypes ?? [];
    const lines: string[] = [`${pad}__typename`];
    for (const memberName of possible.slice(0, 2)) {
      const memberLines = buildDefaultSelectionLines(
        metadata,
        memberName,
        indentSpaces + 2,
        new Set([...visited, memberName]),
      );
      if (memberLines.length > 0) {
        lines.push(`${pad}... on ${memberName} {`, ...memberLines, `${pad}}`);
      }
    }
    return lines;
  }

  return [];
}

export function createSampleValueForType(
  metadata: NormalizedGraphQLSchemaMetadata,
  namedTypeName: string,
  isList: boolean,
  defaultValueJson?: string,
  depth = 0,
): unknown {
  if (defaultValueJson !== undefined) {
    try {
      return JSON.parse(defaultValueJson);
    } catch {
      // fallback to type default
    }
  }

  if (isList) {
    const single = createSampleValueForType(
      metadata,
      namedTypeName,
      false,
      undefined,
      depth + 1,
    );
    return [single];
  }

  switch (namedTypeName) {
    case 'ID':
    case 'String':
      return '';
    case 'Int':
      return 0;
    case 'Float':
      return 0;
    case 'Boolean':
      return false;
  }

  const typeMeta = metadata.types[namedTypeName];
  if (!typeMeta || depth > 2) return null;

  if (typeMeta.kind === 'ENUM') {
    return typeMeta.enumValues?.[0]?.name ?? '';
  }

  if (typeMeta.kind === 'INPUT_OBJECT') {
    const obj: Record<string, unknown> = {};
    for (const inputField of typeMeta.inputFields ?? []) {
      obj[inputField.name] = createSampleValueForType(
        metadata,
        inputField.namedType,
        inputField.isList,
        inputField.defaultValue,
        depth + 1,
      );
    }
    return obj;
  }

  return '';
}
