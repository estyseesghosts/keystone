# STATE.md — current pointer (keep under ~60 lines)

Phase/slice: v1-parity gap audit COMPLETE 2026-10-20 (uncommitted).
Seven read-only subagent audits vs `~/Local Documents/Keystone` produced
`docs/parity-gaps.md` (122 rows, evidence + priority) and the resumable
program `docs/tasks/gap-closure.md` (W1–W8). Headline: the data layer is
mostly ported; gaps are capability evidence, dead wiring, routing/spec
drift and mobile platform behaviour.
Previously committed as `ffffe08d` on `p3.1-signin-functional`: v1-parity
sweep + settings tree + post detail; mobile shell fix (width breakpoints)
landed after it. Trio green (76 suites / 950 tests).
Helium visual check pending (isolated CDP unresponsive).
Gate G4: owner review — write actions NOT verified live on the rig, none on
device/web. Gate G3: owner override recorded 2026-10-20; parity tick open.
Branch: `p3.1-signin-functional` (gap work should branch `p6.0-gap-closure`).
Plan: `rn-rebuild-plan.md`. Reference: Bluesky `social-app` @ `cf16c1d` (ADR-0001).

## Next 3 steps

1. Read `docs/parity-gaps.md` + `docs/tasks/gap-closure.md`, then start
   **W1 Foundations**: capability evidence into backends/sessions, one
   route table, legacy redirects, URL-backed Network tabs. It unlocks
   edit/bookmarks/schedule/translation quotes and is the collision-free
   base for every later workstream.
2. Then W2 (media/content wiring: lightbox, video/audio, Misskey quotes,
   mentions, polls) and W3 (composer clear/close/keyboard, drafts, edit,
   schedule). One workstream per branch; land tests with each row.
3. Owner reviews stay open (G1–G4). Device runs: Android app now runs on
   the Oppo over USB adb (`3B15A500TQD00000`, 360 dp); finish sign-in and
   write-action pass against Pinetree :3000 / Akkoma :4000; iOS not run.

## Blockers

- Owner G1 + G2 + G3 (parity) + G4 reviews.
- Rig: Pinetree seed `ks1`/`password123` 401 (owner); Pinetree missing CORS
  blocks web-direct login; Misskey :3101 / Sharkey :3102 down. **Needed
  for W1 capability facts (MK15) and rig verification.**
- iOS device run not attempted. Android unblocked 2026-10-20.

## Links

- Gap register: `docs/parity-gaps.md` (backlog; §10 workstreams)
- Gap program: `docs/tasks/gap-closure.md` (W1–W8 checklists)
- Handoff prompt: `docs/handoff-gap-closure.md`
- Tasks: `docs/tasks/` (p1.1–p4.6 done + butterfly, p4.7, p5.1,
  p3.1-signin-functional; index current)
- ADRs: `docs/adr/0001-patterns-not-code.md`,
  `docs/adr/0002-butterfly-tarantula.md`
- Logs: `state/logs/2026-10-20-gap-audit.md` (latest),
  `2026-10-20-mobile-shell-layout.md`, `2026-10-20-p3.11-*`,
  `2026-10-20-p3.1-signin-functional.md`, `2026-10-20-p5.1-settings-tree.md`,
  `2026-10-21-android-build-fix.md`, `2026-10-20-parity-sweep.md`
