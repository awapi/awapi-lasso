---
name: electron-ipc
description: "Add or modify Electron IPC channels across Main, Preload, and Renderer in AwapiLasso. Use when exposing new OS/filesystem capabilities, .awjc collection I/O, secret storage, HTTP/GraphQL/OAuth2 execution, native dialogs, menus, or window events between src/main, src/preload, and src/renderer."
---

# Electron IPC Channel Workflow

## Overview
AwapiLasso enforces strict process isolation: the Renderer (`src/renderer/`) has `nodeIntegration` disabled and `contextIsolation` enabled. It cannot access Node.js (`fs`, `path`, `net`, `tls`, `child_process`) or Electron main-process APIs directly. All cross-process communication—including `.awjc` file operations, OS Keychain secrets (`safeStorage`), and outbound HTTP / REST / GraphQL / OAuth 2.0 requests—goes through typed IPC channels bridged onto `window.electronAPI`.

## When to Use
- Adding a new `ipcMain.handle` (request/response) or `webContents.send` / `ipcMain.on` (event) channel
- Exposing a new method or event listener on `window.electronAPI`
- Sharing payload types between Main, Preload, and Renderer

## Step-by-Step Procedure

### 1. Define Shared Types (`src/shared/`)
Define non-trivial payloads and return types in `src/shared/` (e.g., `src/shared/collectionSchema.ts`, `src/shared/httpTypes.ts`, `src/shared/oauth2Types.ts`) so Main, Preload, and Renderer import the exact same TypeScript interfaces without `any`.

### 2. Implement Main Process Handler (`src/main/`)
1. Extract pure or dependency-injected business logic into a dedicated module in `src/main/` (e.g., `src/main/httpEngine.ts`, `src/main/oauth2Engine.ts`, `src/main/secretStore.ts`, `src/main/contextMenu.ts`) with a matching unit test file `src/main/<module>.test.ts`.
2. Register the handler in `src/main/main.ts` using a namespaced channel name (`<domain>:<action>`, such as `collection:open`, `collection:save`, `http:send`, `http:cancel`, `oauth2:getToken`, `secrets:set`):
   - **Request/Response:** `ipcMain.handle('domain:action', async (event, ...args) => { ... })`
   - **Main-to-Renderer Event:** `mainWindow.webContents.send('domain:event', payload)` (use `sendWhenLoaded` when sending during window startup, such as when opening a `.awjc` file via double-click).

### 3. Expose Channel in Preload Bridge (`src/preload/index.ts`)
Add the wrapper method to `electronAPI` in `src/preload/index.ts`:
- For `invoke` calls:
  ```ts
  sendHttpRequest: (req: PreparedHttpRequest) =>
    ipcRenderer.invoke('http:send', req) as Promise<HttpResponseResult>,
  ```
- For event subscriptions, return an unsubscribe function:
  ```ts
  onCollectionOpenedFromOs: (callback: (payload: OpenedCollectionPayload) => void) => {
    const listener = (_: unknown, payload: OpenedCollectionPayload) => callback(payload);
    ipcRenderer.on('collection:openedFromOs', listener);
    return () => {
      ipcRenderer.removeListener('collection:openedFromOs', listener);
    };
  },
  ```

### 4. Declare Global Window Types (`src/preload/globals.d.ts`)
Add the exact method signature and JSDoc comment to `Window['electronAPI']` in `src/preload/globals.d.ts`.

### 5. Mock in Renderer Tests & Verify
1. If `App.tsx` calls or subscribes to the new `window.electronAPI` method on mount, add a default `vi.fn()` mock for it in `beforeEach` inside `src/renderer/src/App.test.tsx`.
2. Add unit tests for both the Main module (`src/main/<module>.test.ts`) and Renderer usage (`src/renderer/src/<Component>.test.tsx`).
3. Run `pnpm run typecheck` and `pnpm run test` to validate end-to-end type safety and test coverage.

## Reference: `ai:*` channels (AI assistant)
- Request/response: `ai:getSettings`, `ai:saveSettings`, `ai:getKeyStatuses` (booleans only), `ai:setKey` / `ai:clearKey` (write-only; plaintext keys never cross IPC to the renderer), `ai:testConnection`, `ai:listModels` (model ids of the saved provider, best effort), `ai:send` (starts a turn and returns immediately), `ai:cancel`, `ai:toolResult`.
- Main → Renderer event: `ai:event` carries streamed `AiTurnEvent`s to the window that sent `ai:send` (`sendEvent(event, origin)` uses the invoke event's `sender`, falling back to the main window). A `tool-call` event asks the renderer to run a workspace tool (`src/renderer/src/aiToolHost.ts`) and reply via `ai:toolResult` with the same turn-scoped call id.
- Main-only data never crosses IPC: the `provider-content` stream event (raw provider blocks such as Claude thinking) is consumed by the agent loop, and Main-only secrets for scrubbing come from the injected `getMainSecretValues` dependency.
- Handlers live in `src/main/ai/aiIpc.ts`; the agent loop in `src/main/ai/aiService.ts`. Tool results are sanitized in the renderer (`src/shared/aiSanitize.ts`) and scrubbed again in Main. Never add a tool or channel that exposes auth configs, secret values, or API keys.

