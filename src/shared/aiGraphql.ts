import { buildClientSchema, parse, validate, type IntrospectionQuery } from 'graphql';
import type {
  NormalizedGraphQLField,
  NormalizedGraphQLSchemaMetadata,
  NormalizedGraphQLType,
} from './graphqlSchemaLoader';

export const MAX_SCHEMA_ROOT_FIELDS = 80;
export const MAX_SCHEMA_TYPE_NAMES = 150;
export const MAX_SCHEMA_TYPE_FIELDS = 100;
export const MAX_SCHEMA_SEARCH_HITS = 40;
export const MAX_VALIDATION_ERRORS = 20;

const BUILTIN_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

function fieldSignature(field: NormalizedGraphQLField): string {
  const args = field.args.map(a => `${a.name}: ${a.typeSignature}${a.defaultValue ? ` = ${a.defaultValue}` : ''}`);
  const deprecated = field.isDeprecated ? ' @deprecated' : '';
  return `${field.name}${args.length ? `(${args.join(', ')})` : ''}: ${field.typeSignature}${deprecated}`;
}

function describeType(type: NormalizedGraphQLType) {
  return {
    name: type.name,
    kind: type.kind,
    ...(type.description ? { description: type.description.slice(0, 300) } : {}),
    ...(type.interfaces?.length ? { implements: type.interfaces } : {}),
    ...(type.possibleTypes?.length ? { possibleTypes: type.possibleTypes } : {}),
    ...(type.fields
      ? {
          fields: type.fields.slice(0, MAX_SCHEMA_TYPE_FIELDS).map(fieldSignature),
          ...(type.fields.length > MAX_SCHEMA_TYPE_FIELDS ? { fieldsTruncated: true } : {}),
        }
      : {}),
    ...(type.inputFields
      ? { inputFields: type.inputFields.slice(0, MAX_SCHEMA_TYPE_FIELDS).map(f => `${f.name}: ${f.typeSignature}`) }
      : {}),
    ...(type.enumValues ? { enumValues: type.enumValues.map(v => v.name) } : {}),
  };
}

function rootFields(metadata: NormalizedGraphQLSchemaMetadata, typeName: string | null) {
  const fields = typeName ? (metadata.types[typeName]?.fields ?? []) : [];
  return {
    typeName,
    fields: fields.slice(0, MAX_SCHEMA_ROOT_FIELDS).map(fieldSignature),
    ...(fields.length > MAX_SCHEMA_ROOT_FIELDS ? { truncated: true } : {}),
  };
}

export interface SchemaQuery {
  typeName?: string;
  search?: string;
}

/** Compact, size-capped description of a loaded schema for the assistant (overview, one type, or a name search). */
export function describeSchemaForAi(
  metadata: NormalizedGraphQLSchemaMetadata,
  query: SchemaQuery = {},
): { ok: true; value: unknown } | { ok: false; error: string } {
  const typeName = query.typeName?.trim();
  if (typeName) {
    const type = metadata.types[typeName];
    return type
      ? { ok: true, value: describeType(type) }
      : { ok: false, error: `No type named "${typeName}". Use "search" to find type or field names.` };
  }

  const search = query.search?.trim().toLowerCase();
  if (search) {
    const hits: string[] = [];
    for (const name of metadata.typeNames) {
      const type = metadata.types[name];
      if (!type || name.startsWith('__') || BUILTIN_SCALARS.has(name)) continue;
      if (name.toLowerCase().includes(search)) hits.push(`type ${name} (${type.kind})`);
      for (const field of type.fields ?? []) {
        if (field.name.toLowerCase().includes(search)) hits.push(`${name}.${fieldSignature(field)}`);
      }
      for (const field of type.inputFields ?? []) {
        if (field.name.toLowerCase().includes(search)) hits.push(`${name}.${field.name}: ${field.typeSignature} (input)`);
      }
      if (hits.length >= MAX_SCHEMA_SEARCH_HITS) break;
    }
    return { ok: true, value: { search: query.search, hits: hits.slice(0, MAX_SCHEMA_SEARCH_HITS), truncated: hits.length >= MAX_SCHEMA_SEARCH_HITS } };
  }

  const names = metadata.typeNames.filter(n => !n.startsWith('__') && !BUILTIN_SCALARS.has(n));
  return {
    ok: true,
    value: {
      query: rootFields(metadata, metadata.queryTypeName),
      mutation: rootFields(metadata, metadata.mutationTypeName),
      subscription: rootFields(metadata, metadata.subscriptionTypeName),
      types: names.slice(0, MAX_SCHEMA_TYPE_NAMES),
      ...(names.length > MAX_SCHEMA_TYPE_NAMES ? { typesTruncated: names.length } : {}),
    },
  };
}

export interface GraphqlValidationOutcome {
  valid: boolean;
  errors: Array<{ message: string; line?: number; column?: number }>;
  operations: Array<{ type: string; name: string | null }>;
}

/** Parses and validates an operation against a loaded schema. Never throws. */
export function validateGraphqlForAi(
  introspection: IntrospectionQuery,
  query: string,
  variablesJson?: string,
): GraphqlValidationOutcome {
  const errors: GraphqlValidationOutcome['errors'] = [];
  const operations: GraphqlValidationOutcome['operations'] = [];

  if (variablesJson !== undefined && variablesJson.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(variablesJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push({ message: 'Variables must be a JSON object.' });
      }
    } catch {
      errors.push({ message: 'Variables are not valid JSON.' });
    }
  }

  let document;
  try {
    document = parse(query);
  } catch (error) {
    const gqlError = error as { message?: string; locations?: Array<{ line: number; column: number }> };
    errors.push({
      message: gqlError.message ?? 'Syntax error.',
      line: gqlError.locations?.[0]?.line,
      column: gqlError.locations?.[0]?.column,
    });
    return { valid: false, errors, operations };
  }

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition') operations.push({ type: def.operation, name: def.name?.value ?? null });
  }

  try {
    const schema = buildClientSchema(introspection);
    for (const err of validate(schema, document).slice(0, MAX_VALIDATION_ERRORS)) {
      errors.push({ message: err.message, line: err.locations?.[0]?.line, column: err.locations?.[0]?.column });
    }
  } catch (error) {
    errors.push({ message: `The loaded schema could not be used: ${error instanceof Error ? error.message : String(error)}` });
  }

  return { valid: errors.length === 0, errors, operations };
}
