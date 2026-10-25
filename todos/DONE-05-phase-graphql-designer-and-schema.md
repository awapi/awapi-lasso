# Phase 05 — GraphQL Schema Discovery, Visual Query Designer & Split Editor

## Objective
Deliver first-class GraphQL support in AwapiLasso: live **Schema Discovery** via `IntrospectionQuery` (inheriting Auth/OAuth2/Environment variables), offline `.graphql` SDL / `.json` schema import, an interactive point-and-click **Visual Query Designer** with two-way AST synchronization to the **Monaco GraphQL Query & Variables** editors, and a searchable **Schema Documentation Explorer**.

---

## Tasks Checklist

- [x] **T5.1 — GraphQL Schema Loader & Main-Process Introspection Service**
  - Create `src/shared/graphqlSchemaLoader.ts` + `src/shared/graphqlSchemaLoader.test.ts`:
    - Build a `GraphQLSchema` from either standard `IntrospectionQuery` JSON (`buildClientSchema`) or `.graphql` / `.gql` SDL text (`buildSchema`).
    - Extract normalized schema metadata for the UI: root operation types (`queryType`, `mutationType`, `subscriptionType`), fields, arguments (with required/default markers), return types, input objects, enums, interfaces, unions, and `@deprecated` annotations.
  - Create `src/main/graphqlIntrospection.ts` + `src/main/graphqlIntrospection.test.ts`:
    - Execute `getIntrospectionQuery()` through `httpEngine` using the request's resolved `{{url}}`, inherited **Auth** (including OAuth 2.0 tokens), **Headers**, and **TLS/Proxy** settings.
    - Load offline `.graphql` / `.gql` SDL or `.json` introspection files from disk when live introspection is disabled.
    - Cache schemas locally per `(collectionId, environmentId, endpointUrl)` with `fetchedAt` timestamp and schema diff summary.
    - Expose IPC channels (`graphql:introspect`, `graphql:loadLocalSchema`, `graphql:getCachedSchema`).

- [x] **T5.2 — Two-Way GraphQL AST Synchronization Engine (`Query Designer` ↔ `Monaco Editor`)**
  - Create `src/shared/graphqlAstSync.ts` + `src/shared/graphqlAstSync.test.ts` (following `.agents/skills/graphql-schema-and-designer/SKILL.md`):
    - **Designer → AST (`toggleFieldSelection`, `setFieldArgument`, `setNestedArgumentValue`, `toggleVariableBinding`, `toggleInlineFragment`):**
      - Check/uncheck any root or nested field path in the operation AST (`parse` / `visit` / `print`).
      - When checking an object/interface field with no sub-selections, automatically select its primary scalar fields (`id`, `name`, or first scalar field) so the generated query is immediately valid.
      - Unchecking a field removes it and prunes empty ancestor selection sets.
      - Support literal argument editing, nested `INPUT_OBJECT` / list arguments (`where`, `orderBy`, `groupBy`, `AND` / `OR` logical condition groups), and **one-click `$variable` promotion** (adds `$argName: Type!` to `OperationDefinitionNode.variableDefinitions`, sets `argName: $argName` on the field, and populates `"argName": <default>` in the GraphQL Variables JSON).
      - Support Union & Interface inline fragments (`... on ConcreteType { field }`).
      - Preserve user comments, field aliases, directives (`@include`, `@skip`), and operation names.
    - **AST → Designer (`extractSelectionStateFromAst`):**
      - Parse the Monaco editor query text and extract checked field paths, expanded nodes, inline fragments, argument values, nested input object/list values, variable bindings, and operation names.
      - Gracefully retain the last valid Designer tree state while the user is mid-keystroke with a temporary syntax error.

- [x] **T5.3 — Interactive Visual GraphQL Query Designer Component**
  - Create `src/renderer/src/components/GraphQLQueryDesigner.tsx` + `GraphQLQueryDesigner.test.tsx`:
    - Root operation tabs (`Query` | `Mutation` | `Subscription`) and field search/filter input.
    - Unified Postman-style recursive collapsible tree of arguments (`ARG` badge) and return fields with checkboxes, return-type badges, description tooltips, and `@deprecated` warnings.
    - Dedicated icons and expandable builders for **`where`** (`Filter`), **`orderBy`** (`ArrowUpDown` with multi-rule sort items), **`groupBy`** (`Layers` with multi-enum checkboxes), and logical **`AND` / `OR` / `NOT`** condition groups (`GitBranch`), plus **`$var`** toggle buttons to bind arguments to GraphQL variables.
    - Expandable **`... on Type`** branches for Union and Interface fields.

- [x] **T5.4 — Split GraphQL Workspace & Schema Documentation Explorer**
  - Create `src/renderer/src/components/GraphQLSchemaExplorer.tsx` + `GraphQLSchemaExplorer.test.tsx`:
    - Searchable, hyperlinked type and field documentation browser with a **"Generate Starter Query / Mutation"** action button.
  - Create `src/renderer/src/components/GraphQLWorkspace.tsx` + `GraphQLWorkspace.test.tsx`:
    - Schema toolbar & actionable error banner: **Discover / Refresh Schema (`Try Again`)** button when introspection fails or has not run yet, Auto-Introspect toggle, **Load `.graphql` / `.json` File** button, schema status badge (`Loaded • 42 types`), and **Docs Explorer** drawer toggle.
    - Adjustable split panes (using `ResizableSplitPane`): **Visual Query Designer** on the left, **Monaco GraphQL Query Editor** (with Operation selector dropdown + `Prettify` button) on the right, and a collapsible/resizable **GraphQL Variables** drawer at the bottom.
    - Register schema-driven Monaco completion provider (fields, arguments, types, directives, and `{{variables}}`) and inline validation markers.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## Agent Prompt for Phase 05
```markdown
Execute Phase 05 (`todos/05-phase-graphql-designer-and-schema.md`) following `AGENTS.md`, `docs/requirements.md` (FR-4), and `.agents/skills/graphql-schema-and-designer/SKILL.md`. Write thorough unit and component tests (`*.test.ts` / `*.test.tsx`) for schema discovery, SDL loading, and two-way Query Designer <-> AST synchronization, check off completed tasks in `todos/05-phase-graphql-designer-and-schema.md`, and verify `pnpm run typecheck && pnpm run test && pnpm run build` pass.
```
