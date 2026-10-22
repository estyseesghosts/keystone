# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: **P6 Wave 0 + Wave 1 COMPLETE on `main` (2026-10-22)**.
Program source of truth: `docs/clickstone.md` +
`docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`. The old V2
E6/E7 program is closed; do not reopen it from `docs/parity-gaps.md`.

## What landed (22 slices, one branch each, all merged)

Wave 0 correctness: 0.1 streaming safety, 0.2 search paging, 0.3 filter
keyword preservation, 0.4 family-scoped translation gate, 0.5
SCOPES_NOW/SCOPES_LATER (ADR 0003), 0.6 import/export shapes, 0.7
Misskey mutations (folderId/edit fields/like probe/sinceId), 0.8
Misskey permission → global re-auth banner, 0.9 messaging gate.

Wave 1 daily-driver: 1.1 profile All tab, 1.2 noQuote + attach-time
sensitivity + per-tile reveal, 1.3 soft-mute badge, 1.4 domain blocks /
tag follow / featured tags, 1.5 moderator reports + `write:reports`,
1.6 lists replies_policy/exclusive + poll hide_totals, 1.7 edit history /
delete-and-redraft / alt-text update, 1.8 avatar+banner upload, 1.9
Misskey channels UI + stream, 1.10 Drive library, 1.11 notification
types + Mastodon dismiss/clear, 1.12 announcements, 1.13 legacy
`/keystone/callback` alias.

Verification on `main`: **170 suites / 2132 tests green**;
`typecheck` (ios+android+web) + `lint` clean; locale extract/compile
run. Per-slice logs: `state/logs/2026-10-22-p6.*.md`; coordinator log
`state/logs/2026-10-22-p6-wave0-1.md`; task index `docs/tasks/README.md`.

## Next 3 steps

1. Wave 2.1: Mastodon conversations/DM inbox (`/api/v1/conversations`,
   Akkoma honest gate), add the DM scope to `SCOPES_NOW`, re-auth prompt.
2. Wave 2.3: import/export UI (document-picker ADR) — data layer is
   already correct; 12 disabled transfer rows become real one family at
   a time. Export completion is the `exportCompleted` notification.
3. Wave 2.2: Misskey chat (larger; keep the 0.9 gate until then), then
   Wave 3 admin read-only (3.1 server insight, 3.2 reports queue).

## Blockers / debts

- Rig Misskey `:3101` / Sharkey `:3102` refused; no live proof for the
  new Misskey paths (channels, drive upload/detail, announcements,
  filter groups, import). External Mastodon/Sharkey testing is treated
  as done per the program brief; do not spend a workstream on it.
- No device pass (Oppo `3B15A500TQD00000`, iOS) and no TalkBack pass.
- Owner G1–G4 visual/parity reviews still open.
- `fr`+7 catalogs still have untranslated management-screen tail; new
  Wave 0/1 strings are English-only until the planned i18n sweep.
- `errors.unsupported.avatar` text is now false (avatar upload ships);
  remove/repurpose it in the i18n sweep.

## Links

- Program brief: `docs/clickstone.md`
- Audit: `docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`
- Tasks: `docs/tasks/README.md` (p6.0.* / p6.1.* done)
- ADRs: `docs/adr/0003-oauth-scopes-now-vs-later.md`
- Decisions: `docs/DECISIONS.md` (2026-10-22 P6 lines)
- Register: `docs/parity-gaps.md` (stale rows corrected 2026-10-22)
