# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: **P6 Wave 2 in progress — 2.1 + 2.3 MERGED on `main` (2026-10-22)**.
Program source of truth: `docs/clickstone.md` +
`docs/2026-10-22-full-audit-mastodon-misskey-v1-parity/`. The old V2
E6/E7 program is closed; do not reopen it from `docs/parity-gaps.md`.

## What landed (24 slices merged; Wave 0+1 closed earlier)

Wave 0 correctness + Wave 1 daily-driver: see prior revision (22 slices).
Wave 2: 2.1 Mastodon conversations/DM inbox (`ConversationsApi`,
`read/write:conversations` → `SCOPES_NOW`, inbox+thread screens;
`direct_messages` on mastodon+akkoma), 2.3 transfer UI (ADR 0004
`expo-document-picker`, 5 Misskey families real, 12 Mastodon rows
honest-disabled, export completes via `exportCompleted`).

Verification on `main`: **176 suites / 2202 tests green**;
`typecheck` (ios+android+web) + `lint` clean. Per-slice logs:
`state/logs/2026-10-22-p6.*.md`; task index `docs/tasks/README.md`.

## Next 3 steps

1. Wave 2.2: Misskey chat (`p6.2-misskey-chat` agent running in
   background — history+rooms+stream, then flip Misskey `direct_messages`).
2. Wave 3.1: admin insight, two branches (`-masto` owns the
   admin-capability+scope seam in `detect.ts`/`oauth.ts`; `-misskey`
   after, rebase onto the seam).
3. Wave 3.2 → 3.3+3.4 → 3.5 after 3.1 lands. Wave 4 out of scope.

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
