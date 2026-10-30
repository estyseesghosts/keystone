# STATE.md — current pointer (keep under ~60 lines)

Phase: **like-button + picker groups merged to `main` 2026-10-30**
(`2264634` + `ae638e4` + bookkeeping; fast-forward, both branches
pruned, pushed to github). Only branch left is `main`. Tree clean.
Gate (merge): typecheck (ios+android+web) + lint clean; `pnpm test`
→ 305 suites / 4278 tests: 4188 pass, 90 fail — all 90 the pre-existing
content/linkpreview/richtext/post set (13 suites). Zero attributable
failures (one self-caught pre-merge regression fixed: provider-less
`CustomGroupsRow` crash — see merge log).
Web/device inspection `not verified` (owner checks open).
Gate (merge commit): typecheck (ios+android+web) + lint clean; `pnpm test`
→ 303 suites / 4260 tests: 4170 pass, 90 fail — all 90 the pre-existing
content/linkpreview/richtext/post set (13 suites), unchanged from the
2026-10-28 clean-tree baseline. Zero attributable failures.
`pnpm build-web` exports; visual/device inspection `not verified`.
Prior polish baseline (merged to `main` 2026-10-30 as `6f49197`): typecheck + lint
clean; `pnpm test` → 303 suites / 4260 tests: 4170 pass, 90 fail — all 90
pre-existing content/link/richtext/post failures (13 suites), unchanged
since the 2026-10-28 clean-tree verification. Zero attributable failures.
Gate baseline (final green): **292 suites / 4123 tests**, typecheck
(ios+android+web) + lint (0 errors, 0 warnings) clean. `--forceExit` kept
(`test:handles` never clean on this tree — X11.2 evidence in its log).

Owner actions (all collected in `docs/audit_20261025/device-checks.md`
+ `live-checks.md`, appendix with D1–D10/audit/app-config):
1. Run the 25 device checks + 12 rig live-checks (`:3101`/`:3102`/Mastodon
   refused to agents; `scripts/fedi-capture.ts` command in live-checks §0).
2. Decide the tracked follow-ups: X4.4-s7 revocation creds, X6.2-s6
   attemptKey, iOS MMKV backup exclusion, X9.2 `context:` sweep, X9.7 fedi
   reason-codes, X8.1 Stack mounting + fedi `log:` pass-through.
3. Release track (out of scope): signing identity, App Links/domain +
   `assetlinks.json`, `app.config.js` name/bundle identifiers.

Links:
- Plan: `docs/visual-polish.md` (all 6 deliverables implemented, merged)
- Task: `docs/tasks/visual-polish.md` (merged; owner visual checks open)
- P6.5 task: `docs/tasks/p6.5-unread-counter.md` (merged; owner visual checks open)
- P6.5 ADR: `docs/adr/0014-notification-unread-source.md` (accepted)
- Fix ADR: `docs/adr/0015-gapfill-keeps-mounted-pages.md` (accepted)
- Fix task: `docs/tasks/fix-feed-gapfill-jump.md` (merged; owner repros open)
- Latest logs: `state/logs/2026-10-30-emoji-picker-groups.md` (this slice),
  `state/logs/2026-10-30-like-button-state.md` (carried slice),
  `state/logs/2026-10-30-merge-batch.md` (the merge),
  `state/logs/2026-10-29-fix-feed-gapfill-jump*.md` (gap-fill rounds 1–2),
  `state/logs/2026-10-29-polish-*.md` (polish 1–8, one per slice)
- Repair program: `docs/audit_20261025/repair.md` + `report.md` (COMPLETE, unchanged)
- Report: `docs/audit_20261025/report.md` ("Status after repair" table)
- Latest logs: `state/logs/2026-10-25-repair25-x12.*.md`
- ADRs: `docs/adr/` (0011–0015 in program); decisions: `docs/DECISIONS.md`

Parked work: P6 Wave 3.3 user moderation (pre-program pointer; untouched).

Docs refresh 2026-10-26 (uncommitted): `docs/wiki/`, `docs/api/`,
`docs/operations/`, `docs/architecture.md`, README + setup touched.
Log: `state/logs/2026-10-26-docs-refresh.md`.
