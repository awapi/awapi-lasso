# Phase 07 — Built-in Git Integration (Future Phase)

## Objective
Because AwapiLasso saves every collection locally as a human-readable, deterministic `.awjc` YAML file and keeps secrets out of plaintext (in the OS Keychain or gitignored `.secrets.awjc` sidecar), collections are already Git-friendly on day one. This phase adds native in-app Git workflows directly inside AwapiLasso.

---

## Tasks Checklist

- [ ] **T7.1 — Git Repository Detection & Branch/Status Service (`src/main/gitService.ts`)**
  - Detect whether an open `.awjc` collection resides inside a Git working tree.
  - Read current branch name, ahead/behind counts, and working tree status (`clean`, `modified`, `untracked`) for `.awjc` files.
  - Verify pre-commit safety (confirm `*.secrets.awjc` is ignored and no plaintext secret markers exist).

- [ ] **T7.2 — Visual `.awjc` YAML Diff & History Viewer**
  - Open `HEAD` vs. working-copy `.awjc` YAML inside Monaco's side-by-side Diff Editor so users can review added/modified requests, headers, or environments before committing.

- [ ] **T7.3 — In-App Branch Switch, Commit, Pull & Push Controls**
  - Add a Git status badge in the status bar / sidebar header showing the active branch, quick branch switcher, commit message dialog for `.awjc` collection changes, and Pull / Push actions.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```
