---
name: testing
description: "Write and run unit and component tests in AwapiLasso using Vitest and React Testing Library. Use when adding or modifying functions, parsers, interpolation, HTTP/OAuth2 engines, hooks, IPC handlers, or React components."
---

# Testing & Verification Workflow

## Overview
Unit tests are mandatory in AwapiLasso. Every new or modified function, `.awjc` serializer, variable interpolator, HTTP/OAuth2 helper, hook, or React component must have corresponding unit test coverage alongside the implementation file.

## When to Use
- Creating or modifying any `.ts` or `.tsx` file in `src/main/`, `src/shared/`, or `src/renderer/src/`
- Running targeted or full test suites and TypeScript typechecking
- Fixing test failures or flaky async UI assertions

## Step-by-Step Procedure

### 1. Place Test Files Alongside Implementation
Always co-locate test files next to the source file they test:
- `src/main/<name>.ts` → `src/main/<name>.test.ts`
- `src/shared/<name>.ts` → `src/shared/<name>.test.ts`
- `src/renderer/src/<Component>.tsx` → `src/renderer/src/<Component>.test.tsx`

### 2. Follow Project Testing Patterns
- **Main & Shared tests (`src/main/*.test.ts`, `src/shared/*.test.ts`):**
  - Keep core logic pure or accept dependency-injected interfaces so tests run quickly without launching a live Electron binary.
  - For HTTP engine and OAuth 2.0 tests, spin up lightweight ephemeral Node `http.createServer` instances on port `0` (`127.0.0.1`) inside the test suite to verify real headers, methods, bodies, redirects, timing, and token exchanges deterministically.
- **Renderer component tests (`src/renderer/src/*.test.tsx`):**
  - Use `@testing-library/react` (`render`, `screen`, `fireEvent`, `waitFor`, `act`).
  - Prefer `data-testid` attributes for stable element queries.
  - Mock `window.electronAPI` methods with `vi.fn()`.

### 3. Run Targeted Tests First
Run the smallest test command covering your changes from the repository root:
```bash
pnpm vitest run src/shared/<module>.test.ts
# or for renderer component tests:
pnpm vitest run src/renderer/src/<Component>.test.tsx
```

### 4. Run Full Typecheck & Test Suite Before Completing Work
```bash
pnpm run typecheck
pnpm run test
```
