import { describe, expect, it } from 'vitest';
import { loadSchemaFromSdl } from './graphqlSchemaLoader';
import {
  MAX_SCHEMA_ROOT_FIELDS,
  MAX_SCHEMA_SEARCH_HITS,
  describeSchemaForAi,
  validateGraphqlForAi,
} from './aiGraphql';

const SDL = `
  enum Role { ADMIN USER }
  input UserFilter { role: Role, name: String }
  interface Node { id: ID! }
  type User implements Node { id: ID!, name: String!, role: Role!, email: String @deprecated(reason: "x"), friends(first: Int = 10): [User!]! }
  type Query { user(id: ID!): User, users(filter: UserFilter): [User!]! }
  type Mutation { renameUser(id: ID!, name: String!): User }
`;

const bundle = loadSchemaFromSdl(SDL);

describe('describeSchemaForAi', () => {
  it('gives a compact overview with root fields and type names', () => {
    const r = describeSchemaForAi(bundle.metadata);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as { query: { fields: string[] }; mutation: { fields: string[] }; subscription: { fields: string[] }; types: string[] };
    expect(v.query.fields).toContain('user(id: ID!): User');
    expect(v.query.fields).toContain('users(filter: UserFilter): [User!]!');
    expect(v.mutation.fields).toEqual(['renameUser(id: ID!, name: String!): User']);
    expect(v.subscription.fields).toEqual([]);
    expect(v.types).toEqual(expect.arrayContaining(['User', 'Role', 'UserFilter', 'Node']));
    expect(v.types).not.toContain('String');
    expect(v.types.some(t => t.startsWith('__'))).toBe(false);
  });

  it('describes one type with args, defaults, deprecations, enums and inputs', () => {
    const user = describeSchemaForAi(bundle.metadata, { typeName: 'User' });
    expect(user.ok && (user.value as { fields: string[] }).fields).toEqual(
      expect.arrayContaining(['friends(first: Int = 10): [User!]!', 'email: String @deprecated']),
    );
    expect(user.ok && (user.value as { implements: string[] }).implements).toEqual(['Node']);
    const role = describeSchemaForAi(bundle.metadata, { typeName: 'Role' });
    expect(role.ok && (role.value as { enumValues: string[] }).enumValues).toEqual(['ADMIN', 'USER']);
    const filter = describeSchemaForAi(bundle.metadata, { typeName: 'UserFilter' });
    expect(filter.ok && (filter.value as { inputFields: string[] }).inputFields).toEqual(['role: Role', 'name: String']);
    expect(describeSchemaForAi(bundle.metadata, { typeName: 'Nope' })).toMatchObject({ ok: false });
  });

  it('searches type, field, and input-field names case-insensitively', () => {
    const r = describeSchemaForAi(bundle.metadata, { search: 'RENAME' });
    expect(r.ok && (r.value as { hits: string[] }).hits).toEqual(['Mutation.renameUser(id: ID!, name: String!): User']);
    const t = describeSchemaForAi(bundle.metadata, { search: 'filter' });
    expect(t.ok && (t.value as { hits: string[] }).hits.some(h => h.startsWith('type UserFilter'))).toBe(true);
    const inputField = describeSchemaForAi(bundle.metadata, { search: 'role' });
    expect(inputField.ok && (inputField.value as { hits: string[] }).hits).toEqual(
      expect.arrayContaining(['User.role: Role!', 'UserFilter.role: Role (input)']),
    );
  });

  it('caps the size of large schemas', () => {
    const fields = Array.from({ length: MAX_SCHEMA_ROOT_FIELDS + 30 }, (_, i) => `f${i}: Int`).join(' ');
    const big = loadSchemaFromSdl(`type Query { ${fields} }`);
    const r = describeSchemaForAi(big.metadata);
    const q = r.ok && (r.value as { query: { fields: string[]; truncated?: boolean } }).query;
    expect(q && q.fields).toHaveLength(MAX_SCHEMA_ROOT_FIELDS);
    expect(q && q.truncated).toBe(true);
    const search = describeSchemaForAi(big.metadata, { search: 'f' });
    expect(search.ok && (search.value as { hits: string[] }).hits.length).toBeLessThanOrEqual(MAX_SCHEMA_SEARCH_HITS);
  });
});

describe('validateGraphqlForAi', () => {
  it('accepts valid operations and lists them', () => {
    const r = validateGraphqlForAi(bundle.introspection, 'query Q { user(id: "1") { id name role } }', '{"a":1}');
    expect(r).toEqual({ valid: true, errors: [], operations: [{ type: 'query', name: 'Q' }] });
  });

  it('reports schema validation errors with locations', () => {
    const r = validateGraphqlForAi(bundle.introspection, '{ user(id: "1") { id nme } }');
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/nme/);
    expect(r.errors[0].line).toBe(1);
    expect(validateGraphqlForAi(bundle.introspection, '{ user { id } }').errors[0].message).toMatch(/id.*required|required/i);
  });

  it('reports syntax errors without throwing', () => {
    const r = validateGraphqlForAi(bundle.introspection, '{ user(id: "1" { id }');
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/Syntax Error/i);
    expect(r.operations).toEqual([]);
  });

  it('validates the variables JSON', () => {
    expect(validateGraphqlForAi(bundle.introspection, '{ users { id } }', '{oops').errors[0].message).toMatch(/valid JSON/);
    expect(validateGraphqlForAi(bundle.introspection, '{ users { id } }', '[1]').errors[0].message).toMatch(/object/);
    expect(validateGraphqlForAi(bundle.introspection, '{ users { id } }', '').valid).toBe(true);
  });
});
