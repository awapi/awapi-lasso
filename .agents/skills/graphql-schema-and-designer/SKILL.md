---
name: graphql-schema-and-designer
description: "Implement and maintain GraphQL schema discovery (live introspection + offline SDL/JSON import), interactive visual Query Designer, two-way GraphQL AST synchronization, and schema-aware Monaco editing in AwapiLasso."
---

# GraphQL Schema Discovery & Visual Query Designer Workflow

## Overview
AwapiLasso provides a complete GraphQL workflow combining **Schema Discovery**, a **Visual Point-and-Click Query Designer**, an interactive **Schema Explorer**, and a **Split Monaco Query + Variables Editor** with real-time bi-directional AST synchronization.

## Core Architecture

### 1. Schema Discovery (`src/main/graphqlIntrospection.ts` & `src/shared/graphqlSchemaLoader.ts`)
- **Live Introspection via Main Process:**
  - Execute the standard GraphQL `getIntrospectionQuery()` in the Electron Main process using `httpEngine` so it inherits the request's resolved `{{url}}`, **Auth** (including OAuth 2.0 tokens), **Headers**, and **TLS/Proxy** settings without CORS issues.
- **Offline SDL / JSON Import:**
  - Support building a `GraphQLSchema` from local `.graphql` / `.gql` SDL files (`buildSchema`) or introspection `.json` files (`buildClientSchema`) when remote introspection is disabled in production.
- **Per-Environment Schema Cache:**
  - Cache normalized introspection JSON by `(collectionId, environmentId, endpointUrl)` with `fetchedAt` metadata and schema diff detection.

### 2. Two-Way AST Synchronization (`src/shared/graphqlAstSync.ts`)
Keep all GraphQL AST transformations pure and unit-tested in `src/shared/graphqlAstSync.ts` using the official `graphql` package (`parse`, `print`, `visit`, `TypeInfo`, `visitWithTypeInfo`):

- **Designer → AST (`toggleFieldSelection`, `setFieldArgument`, `toggleVariableBinding`, `toggleInlineFragment`):**
  1. Parse the current editor text into a `DocumentNode` (or initialize an empty `query NewQuery { ... }` document if blank).
  2. Locate the active `OperationDefinitionNode` matching `operationName` (or the first operation).
  3. When checking a field path (e.g. `['inventoryItem', 'availableQuantity']`):
     - Ensure parent `FieldNode`s exist along the path.
     - If an object/interface field is newly added with no child selections, auto-select its first scalar field (preferring `id`, `name`, or the first scalar in the schema type) so the query stays valid.
  4. When unchecking a field path:
     - Remove the target `FieldNode` from its parent `SelectionSetNode` and prune empty ancestor selection sets.
  5. When promoting an argument to a `$variable`:
     - Add `$argName: ArgType` (preserving non-null `!` and list `[...]` wrappers from the schema) to `OperationDefinitionNode.variableDefinitions`.
     - Set the field's `ArgumentNode.value` to `{ kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: argName } }`.
     - Add `"argName": <defaultValue>` to the GraphQL Variables JSON object if not already present.
  6. Format back to text via `print(ast)` while preserving user aliases, directives (`@include`, `@skip`), and existing operation names.

- **AST → Designer (`extractSelectionStateFromAst`):**
  1. Parse the Monaco editor text with `parse(queryText)`.
  2. If the user is mid-keystroke and `parse` throws a `GraphQLError`, keep the last valid Designer tree state and surface the syntax error location in the editor diagnostics bar without crashing or resetting the Designer.
  3. Walk the AST with `visitWithTypeInfo` to extract selected field paths, inline fragments (`... on Type`), argument values/variable bindings, and active operation names to render the visual tree checkboxes and inputs accurately.
