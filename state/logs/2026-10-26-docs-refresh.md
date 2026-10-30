# 2026-10-26 — docs refresh (wiki/api/operations/README) + server-naming scrub

Branch: `main`
Goal: bring all project docs up to date via 4 subagents, then scrub Sharkey/Pinetree naming per owner.

Did:

- Fanned out 4 subagents (non-overlapping ownership):
  - wiki → `docs/wiki/` (7 pages: index, what-is, installing, using, accounts, troubleshooting, glossary)
  - api → `docs/api/` (7 pages: index, fedi-models, misskey-endpoints, mastodon-endpoints, auth-and-sessions, streaming, errors-and-retry) + surgical `api-surface.md` (30-entry permissions) / `mastoapi-contract.md` (SCOPES_NOW) fixes
  - operations → `docs/architecture.md` + `docs/operations/` (runbook, configuration, backend-rig, troubleshooting) + `docs/setup.md` scope banner (§§1–7 marked v1-stale)
  - readme → `README.md` (103 lines), `docs/README.md` (31 lines)
- Owner corrections applied on top: Sharkey removed from all new docs (dead project); Pinetree folded to "a Misskey clone" (backend-rig legacy `:3000` row); rig/wiki paragraphs now name both families incl. Mastodon `:4000`.
- `prettier --write` on 5 files whose tables my scrub misaligned; full touched set re-checked clean.

Decided:

- Historical records left untouched: `docs/DECISIONS.md` (append-only), carried specs (`quote-posts.md`, `replies.md`, `note-options.md`, `V2_FUNCTIONAL.md`), audit results — they record what was true when written.
- Code still names `sharkey`/`pinetree` flavors (`BackendId` in `packages/fedi/src/api/backend.ts:22`, `CaptureFamily` in `scripts/fedi-capture.ts:62`, flavor gates in `misskey/backend.ts`). Full removal is a code change — flagged for owner, not done here.
- `backend-rig.md` keeps one literal `--family sharkey` command (the script rejects anything else) with a note explaining it is the script's slot name.

Tests / verification:

- `npx prettier --check README.md docs/README.md docs/wiki docs/api docs/operations docs/architecture.md docs/setup.md` → all clean.
- `pnpm typecheck && pnpm lint && pnpm test` → not run (docs-only + small README/setup edits; no code touched). Note as `not verified` for the gate.
- Grep: zero `sharkey|pinetree` (case-insensitive) in `docs/wiki`, `docs/api`, `README.md`, `docs/architecture.md`; only the literal CLI flag + legacy-row note remain in `docs/operations/backend-rig.md`.

Deviations (files touched outside the agents' scope + why):

- Edited sibling agents' files (`README.md`, `backend-rig.md`, `architecture.md`, `docs/api/*`, wiki pages) — owner-directed naming scrub after all 4 agents completed; no concurrent editing.

Next:

- Owner: confirm code-flavor removal (`BackendId`/`CaptureFamily`/gates) wanted or keep as internal names.
- Commit this docs batch (currently uncommitted: 5 modified + 4 new paths).
- Run `pnpm typecheck && pnpm lint && pnpm test` gate before/after commit if a green stamp is wanted for the docs batch.
