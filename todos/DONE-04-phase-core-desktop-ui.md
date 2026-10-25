# Phase 04 — Core Desktop UI (Sidebar, Request Builder, Environments & Response Inspector)

## Objective
Build the React 19 + Monaco Editor desktop user interface for managing `.awjc` collections, folders, multi-tab requests, environments, secrets, OAuth 2.0 token acquisition, and HTTP response inspection/diffing.

---

## Tasks Checklist

- [x] **T4.1 — App Shell, Resizable Splitters, Top Toolbar & Theme System**
  - Create `src/renderer/src/context/ThemeContext.tsx` (Dark & Light themes synced with OS `nativeTheme` or user preference).
  - Create `src/renderer/src/components/ResizableSplitPane.tsx` + `ResizableSplitPane.test.tsx`:
    - Clean, custom-built draggable horizontal and vertical splitters (`cursor: col-resize` / `row-resize`, double-click to reset, min/max clamping, persisted sizes in session/settings) for:
      1. **Left Sidebar ↔ Main Workspace** (adjustable sidebar width + collapse toggle).
      2. **Request Builder (top) ↔ Response Inspector (bottom)** (or side-by-side layout toggle).
      3. **GraphQL Schema/Query Explorer (left) ↔ Monaco Query & Variables Editor (right)**.
  - Create `src/renderer/src/components/TopToolbar.tsx` + `TopToolbar.test.tsx`:
    - Active collection badge, **Environment Switcher Dropdown** (`Cmd/Ctrl+E`) with environment color indicator, **Environments & Variables Manager** button, **OAuth 2.0 Token Manager** button, and **Preferences** button (`Cmd/Ctrl+,`).

- [x] **T4.2 — Multi-Collection & History Sidebar (`Collections` | `History` switch)**
  - Create `src/renderer/src/components/CollectionSidebar.tsx` + `CollectionSidebar.test.tsx`:
    - Sidebar mode switcher (`Collections` | `History`), `New` & `Import` quick actions, and live search/filter input.
    - Nested folder/request tree with protocol/method badges (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `GQL`).
    - Context menus & actions: New HTTP Request, New GraphQL Request, New Folder, Duplicate, Rename, Delete, Save Collection (`Cmd/Ctrl+S`), Export YAML/JSON, Reveal in Finder/Explorer.

- [x] **T4.3 — Multi-Tab Request Bar**
  - Create `src/renderer/src/components/RequestTabBar.tsx` + `RequestTabBar.test.tsx`:
    - Open multiple HTTP and GraphQL requests in tabs with method/protocol badges, active tab top accent bar, dirty state indicator (`•` / `*`), `+` quick-new-tab button, Close (`Cmd/Ctrl+W`), Close Others, Close All, Reopen Closed Tab (`Cmd/Ctrl+Shift+T`), middle-click close, and drag-and-drop tab reordering.

- [x] **T4.4 — Request URL Bar & Live `{{Variable}}` Hover Inspector**
  - Create `src/renderer/src/components/RequestUrlBar.tsx` + `RequestUrlBar.test.tsx`:
    - HTTP method dropdown (standard verbs + custom verb input).
    - URL input highlighting resolved vs. unresolved `{{variables}}` and `:path` parameters.
    - Hover popover over any `{{variable}}` showing its current resolved value (masked if `secret: true` with reveal toggle), scope (`Environment`, `Collection`, `Folder`, `Captured`, `Dynamic`), and quick-edit button.
    - **Send** (`Cmd/Ctrl+Enter`) and **Cancel** buttons.

- [x] **T4.5 — Request Configuration Tabs (Params, Headers, Auth/OAuth2, Body, Captures, Assertions)**
  - `KeyValueTable.tsx` + `KeyValueTable.test.tsx`: Reusable table with enable/disable checkbox, key, value, description, secret mask toggle, delete button, and bulk key-value text mode.
  - `RequestParamsTab.tsx` + `RequestParamsTab.test.tsx`: Query Params table and `:path` Variables table synced bi-directionally with the URL bar.
  - `RequestHeadersTab.tsx` + `RequestHeadersTab.test.tsx`: Request headers with standard header autocomplete + collapsible inherited headers from parent Folder/Collection.
  - `RequestAuthTab.tsx` + `RequestAuthTab.test.tsx` & `OAuth2ConfigPanel.tsx` + `OAuth2ConfigPanel.test.tsx`:
    - Select `Inherit`, `No Auth`, `Auth Profile`, `Bearer Token`, `Basic Auth`, `API Key`, `Digest`, `AWS SigV4`, or **OAuth 2.0**.
    - In the OAuth 2.0 panel: select Grant Type (`password`, `client_credentials`, `authorization_code` + PKCE, `refresh_token`), configure `accessTokenUrl`, `clientId`, `clientSecret`, `username`, `password`, `scope`, `clientAuthMethod`, `extraParams`, click **"Get New Token"**, view token expiry countdown, and inspect decoded **JWT Header & Claims**.
  - `RequestBodyTab.tsx` + `RequestBodyTab.test.tsx`:
    - Body mode selector (`none`, `json`, `yaml`, `xml`, `text`, `form-urlencoded`, `multipart-form` with local file picker, `binary`).
    - Monaco Editor with `Prettify` button for structured text bodies.
  - `RequestCapturesTab.tsx` + `RequestCapturesTab.test.tsx` & `RequestAssertionsTab.tsx` + `RequestAssertionsTab.test.tsx`:
    - Declarative tables for extracting response values into variables and defining test assertions.

- [x] **T4.6 — Environments, Variables & Secrets Manager Modal**
  - Create `src/renderer/src/components/EnvironmentManagerModal.tsx` + `EnvironmentManagerModal.test.tsx`:
    - Create, rename, color-tag, duplicate, and delete environments (`local`, `dev`, `staging`, `prod`).
    - Edit Collection Variables and Environment Variables, toggle `secret: true` (stored securely in OS Keychain via `window.electronAPI`), and manage reusable `authProfiles`.

- [x] **T4.7 — Response Inspector & Side-by-Side Diff Viewer**
  - Create `src/renderer/src/components/ResponseInspector.tsx` + `ResponseInspector.test.tsx`:
    - Metrics bar: Status badge (`200 OK`), elapsed time (`ms`) with phase timing breakdown popover (DNS, TCP, TLS, TTFB, Download), and response size.
    - Body views: **Pretty** (Monaco Editor), **Raw**, **Preview** (sandboxed HTML `iframe` / image renderer), and **Diff** (compare against a pinned or previous response in Monaco Diff Editor).
    - Live **JSONPath Filter Bar** (`$.data.items[*]`).
    - Tabs: **Body**, **Headers**, **Cookies**, **Tests (`Pass / Fail` summary)**, and **Network / TLS Info**.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## Agent Prompt for Phase 04
```markdown
Execute Phase 04 (`todos/04-phase-core-desktop-ui.md`) following `AGENTS.md`, `docs/requirements.md`, and `.agents/skills/testing/SKILL.md`. Write React Testing Library unit tests (`*.test.tsx`) alongside every component, check off completed tasks in `todos/04-phase-core-desktop-ui.md`, and verify `pnpm run typecheck && pnpm run test && pnpm run build` pass.
```
