# 2026-10-20 — repo bootstrap — agent
Branch: `main`
Goal: init git repo + long-horizon agent scaffolding per owner request.

Did:
- `git init` on `main`.
- Added `.gitignore` (node/expo/dist/secrets; `state/tmp/` ignored).
- Added `AGENTS.md` (read order, state protocol, tasks, ADRs, work rules, product/arch rules from plan §§1–4, verification, target layout).
- Scaffolded `docs/` (`README`, `DECISIONS.md` with 2 bootstrap rows, `adr/README` + `0000-template`, `tasks/README`), `state/` (`STATE.md` pointer at Phase 0 pre-sign-off, `README`).
- This log (bootstrap; no plan slice worked).

Decided:
- `AGENTS.md` (uppercase) used instead of `agents.md` — coding-agent convention; case-sensitive filesystems expect it.

Tests / verification:
- `git status` → repo initialized, untracked scaffold files present (pre-commit).
- `pnpm typecheck && pnpm lint && pnpm test` → not verified (no package.json / scaffold slice 1.1 not landed).
- Device/web runs → not verified.

Deviations:
- None (bootstrap only, no slice scope).

Next:
- Owner signs plan §7 D1–D8 → record in `docs/DECISIONS.md` (+ ADRs).
- Create `docs/tasks/p0.1-decisions-record.md`, work slice 0.1.
- Initial commit of this scaffold.
