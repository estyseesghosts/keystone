# STATE.md — current pointer (keep under ~60 lines)

Phase: **repair program 2026-10-25 COMPLETE** — 59/59 slices `done`
(`docs/audit_20261025/repair.md`; Waves 0–12, no `won't do`, tracked
follow-ups stay open, none silently dropped).
Active branch: `main` (shared-tree program; 129+ repair commits; never
`git push`ed — owner owns the remote).
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
- Plan: `docs/audit_20261025/repair.md` (all Status lines done)
- Report: `docs/audit_20261025/report.md` ("Status after repair" table)
- Latest logs: `state/logs/2026-10-25-repair25-x12.*.md`
- ADRs: `docs/adr/` (0011–0013 in program); decisions: `docs/DECISIONS.md`

Parked work: P6 Wave 3.3 user moderation (pre-program pointer; untouched).
