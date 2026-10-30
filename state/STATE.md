# STATE.md — current pointer (keep under ~60 lines)

Phase: **feed gap-fill jump fix IN PROGRESS** (branch `fix/feed-gapfill-jump`,
cut from the `polish/8-media-caps` dirty tree; do NOT merge without owner
approval; never `git push`). Visual-polish program 2026-10-29 COMPLETE
(slices 1–6, unmerged). Repair program 2026-10-25 remains COMPLETE (59/59).
Active branch: `fix/feed-gapfill-jump` (was `polish/8-media-caps`; owner
follow-up 520 caps + feed-fill underneath, untouched).
Gate (this branch): typecheck (ios+android+web) + lint clean (both rounds); targeted
suites green — round 1 (streaming-lifecycle 25; streaming + usePagedLoad +
HomeFeed + HomeFeed.live 59), round 2 (streaming-lifecycle + keys +
lifecycle 45). Full `pnpm test` NOT run — must confirm flat at
pre-existing 90 before merge. `pnpm build-web` exports;
visual/device inspection `not verified` (owner repros: Home deep-scroll +
socket-kill; rec feed hands-off through a reconnect).
Prior polish baseline (unmerged chain `p6.5-unread-counter` → `polish/1-thread-order`
→ `2-shell` → `3-widget-core` → `4-rail-editor` → `5-nav-polish` →
`polish/6-regression` → `7-feed-fill` → `8-media-caps`): typecheck + lint
clean; `pnpm test` → 302 suites / 4243 tests: 4153 pass, 90 fail — all 90
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
- Plan: `docs/visual-polish.md` (all 6 deliverables implemented, unmerged)
- Task: `docs/tasks/visual-polish.md` (all slice boxes done; owner visual checks open)
- P6.5 task: `docs/tasks/p6.5-unread-counter.md` (in progress, steps 1–4 done)
- P6.5 ADR: `docs/adr/0014-notification-unread-source.md` (accepted)
- Fix ADR: `docs/adr/0015-gapfill-keeps-mounted-pages.md` (accepted)
- Fix task: `docs/tasks/fix-feed-gapfill-jump.md` (in progress, steps 1–4 done; owner repro + full suite open)
- Latest logs: `state/logs/2026-10-29-fix-feed-gapfill-jump-2.md` (ranked-feed reroll round),
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
