# STATE.md — current pointer (keep under ~60 lines)

Phase: **batch merged to `main` 2026-10-30** (`6f49197`: P6.5 unread
badge + visual-polish 1–8 + feed gap-fill fix, two rounds). Only branch
left is `main`; all ten program branches pruned. Tree clean.
Gate (merge commit): typecheck (ios+android+web) + lint clean; `pnpm test`
→ 303 suites / 4260 tests: 4170 pass, 90 fail — all 90 the pre-existing
content/linkpreview/richtext/post set (13 suites), unchanged from the
2026-10-28 clean-tree baseline. Zero attributable failures.
`pnpm build-web` exports; visual/device inspection `not verified`
(owner repros still open: Home deep-scroll + socket-kill; rec feed
hands-off through a reconnect).
Prior polish baseline (merged to `main` 2026-10-30 as `6f49197` — chain
`p6.5-unread-counter` → `polish/1-thread-order` → `2-shell` →
`3-widget-core` → `4-rail-editor` → `5-nav-polish` →
`polish/6-regression` → `7-feed-fill` → `8-media-caps` →
`fix/feed-gapfill-jump`, all pruned): typecheck + lint
clean; `pnpm test` → 303 suites / 4260 tests: 4170 pass, 90 fail — all 90
pre-existing content/link/richtext/post failures, unchanged since the
2026-10-28 clean-tree verification. Zero program-attributable failures.
`pnpm build-web` exports; visual/device inspection `not verified`.
Prior baseline line below is stale (tree is red independent of this program).
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
- Latest logs: `state/logs/2026-10-30-merge-batch.md` (this merge),
  `state/logs/2026-10-29-fix-feed-gapfill-jump.md` (round 1: active-trim fix),
  `state/logs/2026-10-29-polish-7-feed-fill.md` (feed fill),
  `state/logs/2026-10-29-polish-*.md` (1–6, one per slice)
- Repair program: `docs/audit_20261025/repair.md` + `report.md` (COMPLETE, unchanged)
- Report: `docs/audit_20261025/report.md` ("Status after repair" table)
- Latest logs: `state/logs/2026-10-25-repair25-x12.*.md`
- ADRs: `docs/adr/` (0011–0015 in program); decisions: `docs/DECISIONS.md`

Parked work: P6 Wave 3.3 user moderation (pre-program pointer; untouched).

Docs refresh 2026-10-26 (uncommitted): `docs/wiki/`, `docs/api/`,
`docs/operations/`, `docs/architecture.md`, README + setup touched.
Log: `state/logs/2026-10-26-docs-refresh.md`.
