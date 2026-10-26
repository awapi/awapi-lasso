# Phase 07 — Built-in Git Integration

## Objective
Because AwapiLasso saves every collection locally as a human-readable, deterministic `.awjc` YAML file and keeps secrets out of plaintext (in the OS Keychain or gitignored `.secrets.awjc` sidecar), collections are already Git-friendly on day one. This phase adds native in-app Git workflows directly inside AwapiLasso, scoped per collection folder.

---

## Tasks Checklist

- [x] **T7.1 — Git Repository Detection & Branch/Status Service (`src/main/gitService.ts`)**
  - Detect whether an open `.awjc` collection resides inside a Git working tree using the collection's parent folder (`path.dirname(collectionFilePath)`) as the Git working directory (`cwd`), plus `git init` support with automatic `*.secrets.awjc` / `*.secrets.awj` `.gitignore` protection.
  - Read current branch name, local branches, ahead/behind counts, and working tree status (`clean`, `modified`, `staged`, `untracked`, `conflict`, `not_a_repo`, `unsaved`) for `.awjc` files and their collection folder.
  - Verify pre-commit safety (confirm `*.secrets.awjc` is ignored and no plaintext secret markers exist).

- [x] **T7.2 — Visual `.awjc` YAML Diff & History Viewer (`src/renderer/src/components/GitSourceControlModal.tsx`)**
  - Open `HEAD` (or any selected historical commit) vs. working-copy `.awjc` YAML inside Monaco's side-by-side Diff Editor inside a movable, 8-directionally resizable, maximizable popup modal so users can review added/modified requests, headers, or environments before committing.

- [x] **T7.3 — In-App Branch Switch, Commit, Revert/Restore, Pull & Push Controls**
  - Add per-collection Git status badges on each collection card in `CollectionSidebar` and in `TopToolbar` for the active collection, opening `GitSourceControlModal` with quick branch switcher / creator, commit scope selector (`.awjc` file only by default vs. entire collection folder), commit message box, Revert/Restore with confirmation prompt, and Pull / Push / `git init` actions.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```
