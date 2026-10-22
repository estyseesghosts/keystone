# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: **P6 Wave 3.1 DONE on `main` (2026-10-22)** — both admin-insight
halves merged (masto + misskey). Next: 3.2 reports queue.
Program source of truth: `docs/clickstone.md` +
`docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`. The old V2
E6/E7 program is closed; do not reopen it from `docs/parity-gaps.md`.

## What landed (27 slices merged; Wave 0+1+2 closed earlier)

Wave 0 correctness + Wave 1 daily-driver: see prior revision (22 slices).
Wave 2: 2.1 Mastodon conversations/DM inbox (`ConversationsApi`,
`write:conversations` → `SCOPES_NOW`, inbox+thread screens;
`direct_messages` on mastodon+akkoma), 2.3 transfer UI (ADR 0004
`expo-document-picker`, 5 Misskey families real, 12 Mastodon rows
honest-disabled), 2.2 Misskey chat (`ChatApi`, rooms+stream, Misskey
`direct_messages` flipped). Login fixes: `read:conversations` dropped
(not a real Mastodon scope — 422); per-flavor scopes (ADR 0005,
Mastodon triple `read write follow` — logged-in authorize 502'd over
~512-char URLs, verified live 200 after fix).

Verification on `main`: **185 suites / 2333 tests green**;
`typecheck` (ios+android+web) + `lint` clean. Per-slice logs:
`state/logs/2026-10-22-p6.*.md`; task index `docs/tasks/README.md`.
Wave 3.1-masto: `admin_read`/`admin_write` seam in `detect.ts`,
`admin:read` in NOW (Mastodon flavor = triple + `admin:read`),
read-only `AdminInsight` screen (measures/dimensions + public fallback).
Wave 3.1-misskey: `misskey/admin.ts` (server-info/meta/queue/online-users),
+3 `read:admin:*` permissions, same screen extended by family branch.

## Next 3 steps

1. Wave 3.2: reports queue (Misskey `admin/abuse-user-reports` +
   resolve/update/forward; Mastodon `GET/POST api/v1/admin/reports` +
   notes) — display the ids 1.5 already sends. Single agent.
2. Wave 3.3 + 3.4 in parallel after 3.2 (file-disjoint); 3.5 after 3.2
   (may run alongside if file-disjoint). Wave 4 out of scope.
3. End of program: intl extract/compile + deferred locale sweep
   (fr+7 catalogs, `errors.unsupported.avatar` cleanup).

## Blockers / debts

- Rig Misskey `:3101` / Sharkey `:3102` refused; owner live-tests
  externally — do not spend a workstream on a rig. All live runs
  `not verified (owner live-tests externally)`.
- No device pass (Oppo `3B15A500TQD00000`, iOS) and no TalkBack pass.
- Owner G1–G4 visual/parity reviews still open.
- `fr`+7 catalogs still have untranslated management-screen tail; new
  Wave 0/1/2 strings English-only until the planned i18n sweep.
- `errors.unsupported.avatar` text is now false (avatar upload ships);
  remove/repurpose it in the i18n sweep.

## Links

- Program brief: `docs/clickstone.md`
- Audit: `docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`
- Tasks: `docs/tasks/README.md` (p6.0.* / p6.1.* / p6.2-conv+transfer done)
- ADRs: `docs/adr/0003-oauth-scopes-now-vs-later.md`, `0004-document-picker.md`
- Decisions: `docs/DECISIONS.md` (2026-10-22 P6 lines)
- Register: `docs/parity-gaps.md` (stale rows corrected 2026-10-22)
