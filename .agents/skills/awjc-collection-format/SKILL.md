---
name: awjc-collection-format
description: "Parse, validate, interpolate {{variables}}, and serialize .awjc / .awj YAML (and JSON) API collection files in AwapiLasso while keeping secrets safe in the OS Keychain or gitignored sidecar."
---

# `.awjc` / `.awj` Collection & Variable Interpolation Workflow

## Overview
Every AwapiLasso collection is saved in a single `.awjc` (or `.awj`) file on disk, formatted in clean, deterministic YAML by default (with automatic JSON load/export support). See `docs/file-format-spec.md` for the full schema.

## Keeping Docs in Sync (mandatory when the schema changes)
Any change to the collection structure must update the docs in the same change:
1. `docs/ai-authoring-guide.md` — LLM-facing recipes, required fields, enums (auth types, body modes, operators, built-in variables), secrets rules, and pre-save checklist.
2. `docs/file-format-spec.md` — full schema reference and annotated example.
3. This skill, if the rules below change.
4. Run `npx vitest run src/shared/aiAuthoringGuide.test.ts` — it parses every `yaml` block in the authoring guide with `parseCollectionFile` and verifies the documented enum values still exist in `src/shared/collectionSchema.ts` and `src/shared/interpolation.ts`. Extend the test when you add a new enum or request type.

## Core Rules

### 1. Single-File YAML Serialization
- Use the `yaml` package with 2-space indentation and consistent key ordering so saving a collection produces minimal, clean Git diffs.
- On load, inspect the first non-whitespace character or parse via `yaml.parse()` (since YAML 1.2 is a superset of JSON, both YAML and JSON `.awjc` / `.awj` files parse seamlessly).
- Preserve all nested folders, RESTful HTTP requests, GraphQL requests, `authProfiles`, `variables`, `environments`, `captures`, and `assertions` inside the collection file.

### 2. Never Write Plaintext Secrets into `.awjc`
- Any variable or auth field marked `secret: true` (such as passwords, API keys, OAuth 2.0 `clientSecret`, and acquired OAuth 2.0 tokens) must have its plaintext `value` stripped before writing the `.awjc` YAML file to disk.
- Persist the actual secret values in `src/main/secretStore.ts` using Electron's `safeStorage` (OS Keychain) keyed by `(collectionId, scopeId, key)` or in a gitignored `<collection>.secrets.awjc` local sidecar file.

### 3. `{{variable}}` Interpolation Precedence
When resolving `{{variableName}}` across URLs, `:path` params, query params, headers, auth fields, request bodies, and GraphQL queries/variables, apply the following precedence (lowest to highest):
1. Global app variables
2. Collection-level `variables`
3. Active Environment `variables` (including hydrated secrets from `secretStore`)
4. Ancestor Folder `variables` (outermost folder to innermost folder)
5. Runtime captured variables (`captures` extracted from prior responses)
6. Built-in dynamic variables (`{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomString}}`)

Guard recursive variable expansion (e.g., `baseUrl: "{{protocol}}://{{host}}"`) with a maximum depth limit (e.g., 10 hops) and cycle detection so circular references never hang the process.
