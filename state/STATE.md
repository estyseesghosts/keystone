# STATE.md — current pointer (keep under ~60 lines)

Phase: **feat/page-editor-cards — page writer cards + formatting icon
toolbar (2026-10-31)** — implemented + gates green, merge pending owner
approval + owner visual check.Every block in the page writer is now a self-contained card (Misskey
container pattern: bordered panel, header row = kind icon + label +
collapse + block menu, padded body; sections nest cards). Text cards are
composer-style: borderless input with the formatting options as a
vector-icon row above it, shown only while that text field is focused.
"Show formatting in editor" now defaults ON (render-on-blur RichText;
explicit stored values still win — PEC-2 in DECISIONS.md).
Gate: typecheck (ios+android+web) + lint clean; `pnpm test` → 332
suites / 4518 tests: 4428 pass, 90 fail — exactly the pre-existing
content/linkpreview/richtext/post set (13 suites), flat vs baseline.
Follow-up (same branch, 2026-10-31): Antennas screen reuses the same card
chrome — create form + one card per antenna, rename/delete as inline
vector icon buttons in the card header, two-tap delete confirm in the
body (PEC-3). Page-writer settings panel is a card too (header row with
settings icon + collapse chevron, fields in the body).
Device/web visual inspection `not verified` (owner item).

Prior: **P6.5 Pages + P6.6 Drive/Clips merged to `main` 2026-10-31**.
Prior: like-button + picker groups merged 2026-10-30. `main` is the only
merged branch; `feat/page-editor-cards` is the only open branch.

Owner actions (all collected in `docs/audit_20261025/device-checks.md` +
`live-checks.md`, appendix with D1–D10/audit/app-config):
1. Visual check of the page editor cards + toolbar (this branch).
2. Run the 25 device checks + 12 rig live-checks (`:3101`/`:3102`/
   Mastodon refused to agents; `scripts/fedi-capture.ts` in live-checks §0).
3. Decide the tracked follow-ups: X4.4-s7 revocation creds, X6.2-s6
   attemptKey, iOS MMKV backup exclusion, X9.2 `context:` sweep, X9.7 fedi
   reason-codes, X8.1 Stack mounting + fedi `log:` pass-through.
4. Release track (out of scope): signing identity, App Links/domain +
   `assetlinks.json`, `app.config.js` name/bundle identifiers.

Links:
- Task: `docs/tasks/feat-page-editor-cards.md` (done, merge pending)
- DECISIONS: `docs/DECISIONS.md` PEC-1/PEC-2 (PEC-2 reverses PG-2 default)
- Latest logs: `state/logs/2026-10-31-page-settings-card.md` (settings
  card), `state/logs/2026-10-31-antennas-cards.md` (antennas follow-up),
  `state/logs/2026-10-31-page-editor-cards.md` (editor slice),
  `state/logs/2026-10-31-merge-pages-drive-clips.md`,
  `state/logs/2026-10-30-p6.6-9-integration.md`,
  `state/logs/2026-10-30-p6.5-pages-slices-3-8.md`
- P6.5 ADRs: 0014, 0015, 0016; tasks index: `docs/tasks/README.md`
- Repair program: `docs/audit_20261025/repair.md` + `report.md` (COMPLETE)
- Baseline: **292 suites / 4123 tests** green history in older logs;
  current expected red set = 90 (13 suites), unchanged since 2026-10-28.

Parked work: P6 Wave 3.3 user moderation (pre-program pointer; untouched).

Docs refresh 2026-10-26 (uncommitted): `docs/wiki/`, `docs/api/`,
`docs/operations/`, `docs/architecture.md`, README + setup touched.
Log: `state/logs/2026-10-26-docs-refresh.md`.
